import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

function normalizeIp(value) {
  return String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
}

export function isPrivateIpLiteral(value) {
  const host = normalizeIp(value);
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  if (family === 6) {
    if (host.startsWith('::ffff:')) return isPrivateIpLiteral(host.slice(7));
    return host === '::'
      || host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || /^fe[89ab]/.test(host);
  }
  return false;
}

export function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('only valid http(s) URLs are allowed');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('only http(s) URLs are allowed');
  }
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  const host = normalizeIp(url.hostname);
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || isPrivateIpLiteral(host)
  ) {
    throw new Error('URL must target a public host');
  }
  return url;
}

async function readBoundedBody(response, { maxBytes, controller }) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('response too large');
  }
  const chunks = [];
  let total = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      total += bytes.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new Error('response too large');
      }
      chunks.push(bytes);
    }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function pinnedHttpFetch(url, options, address) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      method: options.method,
      headers: options.headers,
      signal: options.signal,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) {
          callback(null, [{ address: address.address, family: address.family }]);
        } else {
          callback(null, address.address, address.family);
        }
      },
    }, (response) => {
      const statusCode = Number(response.statusCode);
      if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 599) {
        response.resume();
        reject(new Error(`invalid upstream HTTP status code: ${String(response.statusCode)}`));
        return;
      }
      const body = [204, 205, 304].includes(statusCode)
        ? null
        : Readable.toWeb(response);
      const headers = new Headers();
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
      }
      resolve(new Response(body, {
        status: statusCode,
        headers,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function waitForResolution(resolution, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('page fetch timeout'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('page fetch timeout'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(resolution).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

export function createPageFetcher({
  fetcher = null,
  timeoutMs = 15_000,
  maxBytes = 5 * 1024 * 1024,
  maxRedirects = 5,
  resolver = (hostname) => lookup(hostname, { all: true, verbatim: true }),
} = {}) {
  if (fetcher != null && typeof fetcher !== 'function') throw new Error('page fetcher is required');
  return async function fetchPage(rawUrl, { headers = {} } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('page fetch timeout')),
      Math.max(1, Number(timeoutMs) || 15_000),
    );
    let current = assertPublicHttpUrl(rawUrl);
    const cookiesByHost = new Map();
    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const hostname = normalizeIp(current.hostname);
        const addresses = await waitForResolution(resolver(hostname), controller.signal);
        if (
          !Array.isArray(addresses)
          || addresses.length === 0
          || addresses.some((item) => !isIP(item.address) || isPrivateIpLiteral(item.address))
        ) {
          throw new Error('URL must resolve to a public host');
        }
        const requestOptions = {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': 'Lite-Job-Search/0.2 (+public recruitment discovery)',
            ...Object.fromEntries(
              Object.entries(headers).filter(([name]) => (
                ['if-none-match', 'if-modified-since', 'accept'].includes(
                  String(name).toLowerCase(),
                )
              )),
            ),
            ...(cookiesByHost.has(hostname)
              ? { cookie: cookiesByHost.get(hostname) }
              : {}),
          },
        };
        const response = fetcher
          ? await fetcher(current, requestOptions, { pinnedAddress: addresses[0] })
          : await pinnedHttpFetch(current, requestOptions, addresses[0]);
        const setCookies = typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [];
        if (setCookies.length) {
          const currentCookies = new Map(
            String(cookiesByHost.get(hostname) || '')
              .split(/;\s*/)
              .filter(Boolean)
              .map((item) => {
                const separator = item.indexOf('=');
                return [item.slice(0, separator), item.slice(separator + 1)];
              }),
          );
          for (const header of setCookies) {
            const pair = String(header).split(';', 1)[0];
            const separator = pair.indexOf('=');
            if (separator > 0) {
              currentCookies.set(pair.slice(0, separator), pair.slice(separator + 1));
            }
          }
          cookiesByHost.set(
            hostname,
            [...currentCookies].map(([name, value]) => `${name}=${value}`).join('; '),
          );
        }
        if (response.status >= 300 && response.status < 400 && response.status !== 304) {
          const location = response.headers.get('location');
          if (!location) throw new Error('redirect response missing location');
          if (redirectCount === maxRedirects) throw new Error('too many redirects');
          current = assertPublicHttpUrl(new URL(location, current).href);
          continue;
        }
        return {
          status: response.status,
          finalUrl: current.href,
          html: await readBoundedBody(response, { maxBytes, controller }),
          headers: {
            contentType: response.headers.get('content-type') || '',
            etag: response.headers.get('etag') || '',
            lastModified: response.headers.get('last-modified') || '',
          },
        };
      }
      throw new Error('too many redirects');
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('page fetch timeout');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}
