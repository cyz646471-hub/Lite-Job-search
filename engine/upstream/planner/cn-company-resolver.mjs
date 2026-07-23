// Company identity is deliberately conservative. Legal suffix removal is
// useful, while stripping business words such as “科技” is not: it can merge a
// parent and a separately recruiting subsidiary. Explicit aliases are the
// only automatic cross-name merge mechanism.
const BUILTIN_COMPANIES = Object.freeze([
  { companyId: 'tencent', canonicalName: '腾讯', aliases: ['腾讯公司', '腾讯集团', '腾讯科技有限公司', '腾讯科技（深圳）有限公司', 'Tencent'] },
  { companyId: 'bytedance', canonicalName: '字节跳动', aliases: ['北京字节跳动科技有限公司', 'ByteDance'] },
]);

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
export function normalizeCompanyAlias(value = '') {
  return clean(value).toLowerCase()
    .replace(/(?:股份有限公司|有限责任公司|有限公司|集团控股|集团公司|公司)$/g, '')
    .replace(/[\s·•（）()\-_—–|｜/\\.,，。:：]+/g, '');
}

export function resolveCompanyName(value = '', { companies = BUILTIN_COMPANIES } = {}) {
  const rawName = clean(value);
  const normalized = normalizeCompanyAlias(rawName);
  for (const company of companies) {
    const names = [company.canonicalName, ...(company.aliases || [])];
    if (names.some((name) => normalizeCompanyAlias(name) === normalized)) {
      return { companyId: company.companyId, canonicalName: company.canonicalName, rawName, matchedBy: 'known_alias', confidence: 1, reviewRequired: false };
    }
  }
  return { companyId: normalized, canonicalName: rawName, rawName, matchedBy: 'legal_suffix_normalization', confidence: rawName ? 0.8 : 0, reviewRequired: false };
}

export function companyMergeCandidate(left = {}, right = {}) {
  const a = resolveCompanyName(left.company || left.canonicalName || left);
  const b = resolveCompanyName(right.company || right.canonicalName || right);
  return { sameCompany: Boolean(a.companyId && a.companyId === b.companyId), left: a, right: b, needsReview: a.companyId === b.companyId && (a.matchedBy !== 'known_alias' || b.matchedBy !== 'known_alias') };
}

export { BUILTIN_COMPANIES };
