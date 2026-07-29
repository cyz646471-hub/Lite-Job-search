import fs from 'node:fs';

const registryPath = new URL(
  '../../config/company-domain-overrides-v1.json',
  import.meta.url,
);

function normalizedIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

let cachedRecords;

export function loadCompanyDomainOverrides() {
  if (!cachedRecords) {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    cachedRecords = Object.freeze((parsed.records || []).map((record) => Object.freeze({
      ...record,
      aliases: Object.freeze(record.aliases || []),
      officialDomains: Object.freeze(record.officialDomains || []),
      rejectedOfficialDomains: Object.freeze(record.rejectedOfficialDomains || []),
      careerPortals: Object.freeze(record.careerPortals || []),
    })));
  }
  return cachedRecords;
}

export function applyCompanyDomainKnowledge(company = {}) {
  const identities = new Set([
    company.company,
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
  ].map(normalizedIdentity).filter(Boolean));
  const override = loadCompanyDomainOverrides().find((record) => (
    [record.company, ...(record.aliases || [])]
      .map(normalizedIdentity)
      .some((identity) => identities.has(identity))
  ));
  const existing = override?.replace === true
    ? []
    : company.officialDomains || company.official_domains || [];
  const officialDomains = [
    ...new Set([...(override?.officialDomains || []), ...existing].filter(Boolean)),
  ];
  return Object.freeze({
    ...company,
    aliases: Object.freeze([
      ...new Set([...(company.aliases || []), ...(override?.aliases || [])]),
    ]),
    officialDomains: Object.freeze(officialDomains),
    rejectedOfficialDomains: Object.freeze(override?.rejectedOfficialDomains || []),
    reviewedCareerPortals: Object.freeze(override?.careerPortals || []),
    officialDomain: officialDomains[0] || company.officialDomain || '',
    domainKnowledgeEvidence: override?.evidence || null,
  });
}
