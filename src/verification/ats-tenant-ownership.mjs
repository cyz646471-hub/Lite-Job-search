import fs from 'node:fs';

const registryPath = new URL(
  '../../config/ats-tenant-ownership-v1.json',
  import.meta.url,
);

function normalizedIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.href.toLowerCase();
  } catch {
    return '';
  }
}

let cachedRecords;

export function loadAtsTenantOwnershipRegistry() {
  if (!cachedRecords) {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    cachedRecords = Object.freeze((parsed.records || []).map((record) => Object.freeze({
      ...record,
      aliases: Object.freeze(record.aliases || []),
      urlPrefixes: Object.freeze(record.urlPrefixes || []),
      officialDomains: Object.freeze(record.officialDomains || []),
    })));
  }
  return cachedRecords;
}

export function resolveAtsTenantOwnership({
  company = {},
  url = '',
  atsType = '',
} = {}) {
  const identities = new Set([
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
  ].map(normalizedIdentity).filter(Boolean));
  const targetUrl = canonicalUrl(url);
  const normalizedAts = String(atsType || '').replace(/\s+/g, '').toUpperCase();
  const record = loadAtsTenantOwnershipRegistry().find((item) => {
    const ownerNames = [item.company, ...(item.aliases || [])]
      .map(normalizedIdentity)
      .filter(Boolean);
    const ownerMatched = ownerNames.some((name) => identities.has(name));
    const atsMatched = String(item.ats || '').replace(/\s+/g, '').toUpperCase() === normalizedAts;
    const prefixMatched = item.urlPrefixes.some(
      (prefix) => targetUrl.startsWith(canonicalUrl(prefix)),
    );
    return ownerMatched && atsMatched && prefixMatched;
  });
  if (!record) return Object.freeze({ status: 'UNVERIFIED', record: null });
  return Object.freeze({
    status: 'VERIFIED',
    record,
    evidence: Object.freeze({
      tenantKey: record.tenantKey,
      provenance: record.provenance,
    }),
  });
}
