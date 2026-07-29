import { getDomain } from 'tldts';

function cleanHost(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return '';
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    return url.hostname.replace(/\.+$/, '');
  } catch {
    return '';
  }
}

export function canonicalHost(value) {
  return cleanHost(value).replace(/^www\./i, '');
}

export function officialHomepageCandidates(value) {
  const host = canonicalHost(value);
  if (!host) return Object.freeze([]);
  return Object.freeze([
    `https://${host}/`,
    `https://www.${host}/`,
    `http://${host}/`,
    `http://www.${host}/`,
  ]);
}

export function sameCanonicalHost(left, right) {
  const leftHost = canonicalHost(left);
  const rightHost = canonicalHost(right);
  if (!leftHost || !rightHost) return false;
  return (getDomain(leftHost) || leftHost) === (getDomain(rightHost) || rightHost);
}
