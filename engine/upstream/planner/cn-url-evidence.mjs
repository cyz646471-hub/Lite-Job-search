import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { getDomain } from 'tldts';

const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from', 'source', 'ref', 'referrer', 'campaign', 'bd_vid']);
const AGGREGATORS = ['nowcoder.com', 'gankinterview.cn', 'langlangwangshen.com', 'langlangws.com', 'niuqizp.com', 'zhipin.com', 'liepin.com', 'zhaopin.com', 'yingjiesheng.com', 'shixiseng.com', 'wondercv.com', 'gaoxiaojob.com'];
const BLOCKED_LANDING_HOSTS = ['docs.qq.com', 'pan.baidu.com', 'weiyun.com', 'qun.qq.com', 'chat.whatsapp.com'];

function hostMatches(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
function urlOf(value, base) { try { return new URL(value, base); } catch { return null; } }

export function canonicalizeCandidateUrl(value = '', baseUrl) {
  const url = urlOf(value, baseUrl);
  if (!url || !/^https?:$/.test(url.protocol)) return '';
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.href;
}
export function registrableDomainOf(value = '') {
  const url = urlOf(value.includes('://') ? value : `https://${value}`);
  if (!url) return '';
  return getDomain(url.hostname, { allowPrivateDomains: false }) || url.hostname.toLowerCase();
}

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}

function privateIp(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  if (net.isIPv4(normalized)) return privateIpv4(normalized);
  if (net.isIPv6(normalized)) {
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return privateIpv4(mapped);
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return true;
}

export async function isPublicFetchTarget(value, { lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }) } = {}) {
  const url = urlOf(value);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return { safe: false, reasonCode: 'unsupported_protocol', addresses: [] };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return { safe: false, reasonCode: 'local_hostname', addresses: [] };
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) return { safe: false, reasonCode: 'non_standard_port', addresses: [] };
  if (net.isIP(host)) return { safe: !privateIp(host), reasonCode: privateIp(host) ? 'private_ip' : null, addresses: [host] };
  try {
    const resolved = await lookup(host);
    const addresses = (Array.isArray(resolved) ? resolved : [resolved]).map((item) => typeof item === 'string' ? item : item.address).filter(Boolean);
    if (!addresses.length || addresses.some(privateIp)) return { safe: false, reasonCode: 'dns_private_or_empty', addresses };
    return { safe: true, reasonCode: null, addresses };
  } catch { return { safe: false, reasonCode: 'dns_resolution_failed', addresses: [] }; }
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return rows[a.length][b.length];
}

export function inspectDomainRisk(value = '', { officialDomains = [], redirectChain = [], pageText = '' } = {}) {
  const url = urlOf(value);
  if (!url) return ['invalid_url'];
  const host = url.hostname.toLowerCase(), root = registrableDomainOf(url.href), signals = [];
  if (net.isIP(host)) signals.push('ip_literal_host');
  if (host.includes('xn--')) signals.push('punycode_domain');
  if (url.port && !['80', '443'].includes(url.port)) signals.push('non_standard_port');
  if ((host.match(/-/g) || []).length >= 4 || /[a-z0-9]{18,}/i.test(host.split('.')[0])) signals.push('abnormal_domain_shape');
  if (BLOCKED_LANDING_HOSTS.some((domain) => hostMatches(host, domain))) signals.push('personal_form_or_cloud_drive');
  for (const official of officialDomains) {
    const expected = registrableDomainOf(official);
    if (expected && root !== expected && levenshtein(root, expected) <= 2) signals.push('lookalike_official_domain');
  }
  const unrelated = uniqueDomains(redirectChain.map((item) => item.url || item));
  if (unrelated.length >= 4) signals.push('excessive_cross_domain_redirects');
  if (/培训费|押金|体检费|材料费|个人账户转账|加微信|QQ群|下载APK/i.test(pageText)) signals.push('payment_or_private_contact_risk');
  return [...new Set(signals)];
}

function uniqueDomains(values) { return [...new Set(values.map(registrableDomainOf).filter(Boolean))]; }
function firstMatch(html, patterns) { for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return match[1].trim(); } return ''; }

function htmlRedirect(html, currentUrl) {
  const meta = firstMatch(html, [/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*?url\s*=\s*([^"';>]+)[^"']*["'][^>]*>/i, /<meta[^>]+content=["'][^"']*?url\s*=\s*([^"';>]+)[^"']*["'][^>]+http-equiv=["']?refresh/i]);
  if (meta) return { kind: 'meta_refresh', url: canonicalizeCandidateUrl(meta, currentUrl) };
  const canonical = firstMatch(html, [/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i]);
  if (canonical) return { kind: 'canonical', url: canonicalizeCandidateUrl(canonical, currentUrl) };
  const js = firstMatch(html, [/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i, /window\.location\.replace\(\s*["']([^"']+)["']/i]);
  if (js) return { kind: 'javascript_redirect', url: canonicalizeCandidateUrl(js, currentUrl) };
  return null;
}

function pinnedHttpFetch(value, { addresses, maxBytes, timeoutMs, headers }) {
  const url = new URL(value), address = addresses.find((item) => !privateIp(item));
  if (!address) return Promise.reject(Object.assign(new Error('unsafe pinned address'), { code: 'UNSAFE_REMOTE_ADDRESS' }));
  const family = net.isIPv6(address) ? 6 : 4, transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET', headers, servername: url.hostname,
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'function') return options(null, address, family);
        return options?.all ? callback(null, [{ address, family }]) : callback(null, address, family);
      },
    }, (response) => {
      const chunks = []; let bytes = 0, settled = false;
      const fail = (error) => { if (settled) return; settled = true; response.destroy(); reject(error); };
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) return fail(Object.assign(new Error('response exceeds byte limit'), { code: 'RESPONSE_TOO_LARGE' }));
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return; settled = true;
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
          status: Number(response.statusCode || 0), url: value,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] || null },
          text: async () => body,
        });
      });
    });
    request.on('socket', (socket) => socket.once('connect', () => {
      if (privateIp(socket.remoteAddress)) request.destroy(Object.assign(new Error('unsafe remote address'), { code: 'UNSAFE_REMOTE_ADDRESS' }));
    }));
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('request timed out'), { name: 'AbortError', code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end();
  });
}

export async function resolveCandidateUrl(value, { fetcher = null, lookup, maxRedirects = 6, maxBytes = 2_000_000, timeoutMs = 12_000 } = {}) {
  let current = canonicalizeCandidateUrl(value);
  const redirectChain = current ? [{ kind: 'start', url: current }] : [];
  const seen = new Set();
  if (!current) return { status: 'REJECTED', reasonCode: 'invalid_url', finalUrl: '', redirectChain, riskSignals: ['invalid_url'] };
  const sourceHost = urlOf(current).hostname.toLowerCase();
  for (let step = 0; step <= maxRedirects; step++) {
    if (seen.has(current)) return { status: 'REJECTED', reasonCode: 'redirect_loop', finalUrl: current, redirectChain, riskSignals: inspectDomainRisk(current, { redirectChain }) };
    seen.add(current);
    const safe = await isPublicFetchTarget(current, { lookup });
    if (!safe.safe) return { status: 'REJECTED', reasonCode: safe.reasonCode, finalUrl: current, redirectChain, riskSignals: [safe.reasonCode] };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const headers = { 'user-agent': 'Mozilla/5.0 (compatible; Career-OP/1.20; public recruitment verification)', 'accept-encoding': 'identity' };
      response = fetcher
        ? await fetcher(current, { redirect: 'manual', signal: controller.signal, headers })
        : await pinnedHttpFetch(current, { addresses: safe.addresses, maxBytes, timeoutMs, headers });
    }
    catch (error) {
      clearTimeout(timer);
      const reasonCode = error?.code === 'RESPONSE_TOO_LARGE' ? 'response_too_large' : error?.code === 'UNSAFE_REMOTE_ADDRESS' ? 'dns_rebinding_or_private_peer' : error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' ? 'timeout' : 'network_error';
      return { status: reasonCode === 'response_too_large' || reasonCode === 'dns_rebinding_or_private_peer' ? 'REJECTED' : 'BLOCKED', reasonCode, finalUrl: current, redirectChain, riskSignals: reasonCode === 'dns_rebinding_or_private_peer' ? [reasonCode] : inspectDomainRisk(current, { redirectChain }) };
    }
    clearTimeout(timer);
    if (!response) return { status: 'BLOCKED', reasonCode: 'empty_response', finalUrl: current, redirectChain, riskSignals: inspectDomainRisk(current, { redirectChain }) };
    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = canonicalizeCandidateUrl(location, current);
      if (!next) return { status: 'REJECTED', reasonCode: 'invalid_redirect_target', finalUrl: current, redirectChain, riskSignals: ['invalid_redirect_target'] };
      redirectChain.push({ kind: 'http_redirect', status: response.status, url: next }); current = next; continue;
    }
    if ([401, 403, 429].includes(response.status)) return { status: 'BLOCKED', reasonCode: `http_${response.status}`, finalUrl: response.url || current, httpStatus: response.status, redirectChain, riskSignals: inspectDomainRisk(response.url || current, { redirectChain }) };
    if (response.status >= 500) return { status: 'BLOCKED', reasonCode: `http_${response.status}`, finalUrl: response.url || current, httpStatus: response.status, redirectChain, riskSignals: inspectDomainRisk(response.url || current, { redirectChain }) };
    if ([404, 410].includes(response.status)) return { status: 'REJECTED', reasonCode: `http_${response.status}`, finalUrl: response.url || current, httpStatus: response.status, redirectChain, riskSignals: inspectDomainRisk(response.url || current, { redirectChain }) };
    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > maxBytes) return { status: 'REJECTED', reasonCode: 'response_too_large', finalUrl: current, httpStatus: response.status, redirectChain, riskSignals: [] };
    const contentType = String(response.headers?.get?.('content-type') || 'text/html').toLowerCase();
    if (!/(?:text\/html|application\/(?:json|ld\+json)|text\/plain|application\/xhtml\+xml)/.test(contentType)) return { status: 'REJECTED', reasonCode: 'content_type_blocked', finalUrl: current, httpStatus: response.status, redirectChain, riskSignals: [] };
    const body = await response.text();
    if (Buffer.byteLength(body) > maxBytes) return { status: 'REJECTED', reasonCode: 'response_too_large', finalUrl: current, httpStatus: response.status, redirectChain, riskSignals: [] };
    const blocked = /验证码|访问过于频繁|安全验证|captcha|access denied|enable javascript to continue/i.test(body);
    if (blocked) return { status: 'BLOCKED', reasonCode: 'challenge_or_dynamic_block', finalUrl: response.url || current, httpStatus: response.status, redirectChain, body, riskSignals: inspectDomainRisk(response.url || current, { redirectChain, pageText: body }) };
    const redirect = htmlRedirect(body, response.url || current);
    if (redirect?.url && redirect.url !== current) { redirectChain.push(redirect); current = redirect.url; continue; }
    const finalUrl = canonicalizeCandidateUrl(response.url || current);
    const riskSignals = inspectDomainRisk(finalUrl, { redirectChain, pageText: body });
    if (AGGREGATORS.some((domain) => hostMatches(sourceHost, domain))) riskSignals.push('aggregator_source_url');
    return { status: 'RESOLVED', reasonCode: 'resolved', finalUrl, canonicalUrl: finalUrl, registrableDomain: registrableDomainOf(finalUrl), httpStatus: response.status, contentType, body, redirectChain, riskSignals: [...new Set(riskSignals)] };
  }
  return { status: 'REJECTED', reasonCode: 'too_many_redirects', finalUrl: current, redirectChain, riskSignals: inspectDomainRisk(current, { redirectChain }) };
}
