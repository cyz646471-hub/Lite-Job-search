export function safeSegment(value = '') {
  return /^[A-Za-z0-9._-]+$/.test(value) && !value.includes('..');
}

export function humanizeSlug(value = '') {
  return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

export function locationText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(locationText).filter(Boolean).join(' / ');
  return [value.city, value.addressLocality, value.region, value.addressRegion, value.country, value.addressCountry, value.name]
    .filter(Boolean).join(', ');
}
