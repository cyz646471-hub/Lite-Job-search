export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function canonicalCompany(value = '') {
  return normalizeText(value)
    .replace(/\b(?:inc|incorporated|corp|corporation|company|co|ltd|limited|llc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

