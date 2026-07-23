// Industry taxonomy for the jobseeker surface. Each bucket maps to a
// compact Chinese label and a deterministic id so sorting / filtering
// stays stable. Keywords are stored as both Chinese and Latin forms so
// NA ("computer software", "semiconductor") and CN ("\u5b9e\u4e60",
// "\u534a\u5bfc\u4f53") jobs land in the same bucket.
//
// Buckets are tuned for cross-region phrase coverage. Each bucket has
// required hits and anti-keywords so ambiguous listings (e.g.
// "\u4e92\u8054\u7f51\u91d1\u878d") can be classified toward the
// stronger signal. Final tie-break falls back to "interdisciplinary".

const BUCKETS = [
  { id: 'internet_ai_software', label: '\u4e92\u8054\u7f51/AI/\u8f6f\u4ef6',
    keywords: ['software', 'developer', 'product manager', 'growth', 'data scientist', 'machine learning', 'llm', 'artificial intelligence', 'ml ops', 'platform', 'backend', 'frontend', 'full stack',
      '\u4e92\u8054\u7f51', '\u4eba\u5de5\u667a\u80fd', 'AI', '\u8f6f\u4ef6', '\u7f51\u7edc\u5b89\u5168', '\u6e38\u620f', '\u5927\u6a21\u578b', '\u524d\u7aef', '\u540e\u7aef', '\u8fd0\u7ef4', '\u4ea7\u54c1\u7ecf\u7406', '\u7b97\u6cd5'],
    anti: ['semiconductor'] },
  { id: 'electronics_semiconductor', label: '\u7535\u5b50/\u534a\u5bfc\u4f53',
    keywords: ['semiconductor', 'asic', 'soc', 'fpga', 'rtl', 'verification', 'analog', 'mixed signal', 'serdes', 'cv', 'electrical engineer',
      '\u534a\u5bfc\u4f53', '\u82af\u7247', 'IC', '\u96c6\u6210\u7535\u8def', '\u6a21\u62df', '\u6570\u5b57', '\u9a8c\u8bc1', '\u5e8f\u5217', '\u5e73\u9762\u8bbe\u8ba1', '\u786c\u4ef6', '\u91cf\u4ea7', '\u9501\u76f8\u5668', 'EDA', '\u6444\u50cf\u5934', '\u5149\u5b66\u5149\u7535'] },
  { id: 'mechanical_manufacturing', label: '\u673a\u68b0\u88c5\u5907/\u667a\u80fd\u5236\u9020',
    keywords: ['mechanical', 'manufacturing', 'industrial automation', 'plc', 'cnc', 'embedded', 'iot', 'robotics', 'control system', 'production planning',
      '\u673a\u68b0', '\u5236\u9020', '\u5de5\u4e1a\u81ea\u52a8\u5316', '\u667a\u80fd\u5236\u9020', '\u673a\u7535', 'PLC', '\u5d4c\u5165\u5f0f', '\u7269\u8054\u7f51', '\u673a\u5668\u4eba'] },
  { id: 'finance_banking', label: '\u91d1\u878d/\u94f6\u884c/\u4fdd\u9669',
    keywords: ['bank', 'investment', 'finance', 'financial', 'accounting', 'accountant', 'asset management', 'risk', 'audit', 'compliance', 'quant', 'wealth', 'securities', 'private equity', 'fintech',
      '\u91d1\u878d', '\u94f6\u884c', '\u8bc1\u5238', '\u4fdd\u9669', '\u57fa\u91d1', '\u91d1\u878d\u5de5\u7a0b', '\u5b9e\u4e60\u751f\u8d22\u52a1', '\u4fdd\u9669\u7406\u8d54', '\u91d1\u878d\u8fd0\u8425'] },
  { id: 'education_training', label: '\u6559\u80b2/\u57f9\u8bad',
    keywords: ['education', 'teacher', 'tutor', 'training', 'university', 'k12', 'school', 'curriculum',
      '\u6559\u80b2', '\u6559\u5e08', '\u57f9\u8bad', '\u5b66\u6821', '\u6559\u52a1', '\u8bfe\u7a0b', '\u4e1a\u52a1', '\u8bfe\u5916\u54a8\u8be2'] },
  { id: 'biopharma_healthcare', label: '\u751f\u7269\u533b\u836f/\u533b\u7597',
    keywords: ['pharma', 'biotech', 'medical', 'clinical', 'healthcare', 'hospital', 'pharmacist', 'biology', 'research associate', 'drug development', 'regulatory',
      '\u751f\u7269', '\u533b\u836f', '\u4e34\u5e8a', '\u533b\u9662', '\u836f\u5b66', '\u836f\u7406', '\u533b\u751f', '\u533b\u7597'] },
  { id: 'state_owned_enterprise', label: '\u592e\u56fd\u4f01/\u4e8b\u4e1a\u5355\u4f4d',
    keywords: ['central', 'state-owned', 'soe', 'public institution', 'government', 'civil servant', 'research institute', '\u4e8b\u4e1a\u5355\u4f4d', '\u5904\u957f', 'sasac', '\u9662\u58eb', '\u519b\u5de5', '\u4e2d\u592e\u4f01\u4e1a',
      '\u592e\u4f01', '\u56fd\u4f01', '\u4e8b\u4e1a\u5355\u4f4d', '\u519b\u5de5', '\u4e2d\u592e\u4f01\u4e1a', '\u4e2d\u56fd\u5de5\u7a0b\u9662'] },
  { id: 'consumer_retail_ecommerce', label: '\u6d88\u8d39\u54c1/\u96f6\u552e/\u7535\u5546',
    keywords: ['consumer', 'retail', 'ecommerce', 'merchandise', 'category manager', 'cpg', 'fmcg', 'shopping', 'mall',
      '\u6d88\u8d39\u54c1', '\u96f6\u552e', '\u7535\u5546', '\u5546\u8d85', '\u8d2d\u624b', 'SKU', '\u4f9b\u5e94\u94fe', '\u8d27\u7269\u52a8\u4f4d'] },
  { id: 'auto_driving', label: '\u6c7d\u8f66/\u667a\u80fd\u9a7e\u9a76',
    keywords: ['autonomous driving', 'self-driving', 'adas', 'adas algorithm', 'automotive', 'vehicle', 'battery management',
      '\u667a\u9a7e', '\u81ea\u52a8\u9a7e\u9a76', '\u8f66\u8054\u7f51', '\u6c7d\u8f66', '\u667a\u80fd\u8f66\u8f7d', '\u7535\u6c60', '\u706b\u8f66\u5934', '\u52a8\u529b\u603b\u6210'] },
  { id: 'energy_environment', label: '\u80fd\u6e90/\u73af\u4fdd',
    keywords: ['renewable', 'solar', 'wind', 'battery', 'oil and gas', 'petrochemical', 'energy storage', 'hydrogen',
      '\u80fd\u6e90', '\u5149\u4f0f', '\u98ce\u7535', '\u7535\u6c60', '\u77f3\u5316', '\u50a8\u80fd', '\u73af\u4fdd', '\u78b3\u4e2d\u548c', '\u7535\u529b', '\u592a\u9633\u80fd', '\u6838\u80fd'] },
  { id: 'chemicals_materials', label: '\u5316\u5de5/\u6750\u6599',
    keywords: ['chemical', 'materials', 'polymer', 'ceramic', 'carbon', 'nanomaterial',
      '\u5316\u5de5', '\u6750\u6599', '\u9ad8\u5206\u5b50', '\u9676\u74f7', '\u78b3\u6750\u6599', '\u94b4\u6750', '\u6709\u673a\u5316\u5b66'] },
  { id: 'hardware_iot', label: '\u667a\u80fd\u786c\u4ef6/\u673a\u5668\u4eba/\u7269\u8054\u7f51',
    keywords: ['hardware', 'iot', 'robotics', 'drone', 'uav', 'wearable', 'embedded system', 'iot device',
      '\u667a\u80fd\u786c\u4ef6', '\u673a\u5668\u4eba', '\u65e0\u4eba\u673a', '\u53ef\u7a7f\u6234', '\u786c\u4ef6\u5de5\u7a0b', '\u5d4c\u5165\u5f0f'] },
  { id: 'transport_logistics', label: '\u4ea4\u8fd0/\u7269\u6d41',
    keywords: ['logistics', 'supply chain', 'shipping', 'freight', 'aviation', 'railway', 'port', 'trucking', 'warehouse',
      '\u4ea4\u8fd0', '\u7269\u6d41', '\u4f9b\u5e94\u94fe', '\u8239\u8236', '\u822a\u7a7a', '\u94c1\u8def', '\u6e2f\u53e3'] },
  { id: 'aerospace_defense', label: '\u9ad8\u7aef\u88c5\u5907/\u822a\u5929\u822a\u7a7a/\u519b\u5de5',
    keywords: ['aerospace', 'satellite', 'avionics', 'defense', 'radar', 'sonar', 'guidance', 'laser', 'lidar',
      '\u822a\u5929\u822a\u7a7a', '\u822a\u5929', '\u536b\u661f', '\u96f7\u8fbe', '\u519b\u5de5', '\u5bfc\u5f39'] },
  { id: 'media_advertising', label: '\u5a92\u4f53/\u5e7f\u544a/PR',
    keywords: ['media', 'advertising', 'pr', 'marketing', 'brand', 'social media', 'content', 'editor', 'writer', 'journalist', 'reporter',
      '\u5a92\u4f53', '\u5e7f\u544a', '\u516c\u5173', '\u54c1\u724c', '\u8425\u9500', '\u793e\u4ea4', '\u5185\u5bb9', '\u7f16\u8f91', '\u8bb0\u8005', '\u8be2\u95ee'] },
  { id: 'consulting_legal_audit', label: '\u54a8\u8be2/\u6cd5\u52a1/\u5ba1\u8ba1',
    keywords: ['consulting', 'legal', 'lawyer', 'paralegal', 'audit', 'tax', 'compliance', 'advisory',
      '\u54a8\u8be2', '\u6cd5\u52a1', '\u5ba1\u8ba1', '\u7a0e\u52a1', '\u5408\u89c4', '\u9879\u76ee\u54a8\u8be2', '\u7ba1\u7406\u54a8\u8be2'] },
  { id: 'interdisciplinary', label: '\u5176\u4ed6/\u8de8\u9886\u57df',
    keywords: [],
    anti: [] },
];

const BUCKETS_BY_ID = Object.fromEntries(BUCKETS.map((b) => [b.id, b]));

export const INDUSTRY_BUCKETS = BUCKETS.map((b) => ({ id: b.id, label: b.label }));

export function normalizeIndustryBucket(value) {
  if (!value) return null;
  const t = String(value).trim();
  if (BUCKETS_BY_ID[t]) return t;
  const l = t.toLowerCase().replace(/\s+/g, '_');
  if (BUCKETS_BY_ID[l]) return l;
  return null;
}

export function industryBucketLabel(bucket) {
  return (BUCKETS_BY_ID[bucket] && BUCKETS_BY_ID[bucket].label) || String(bucket || '');
}

/**
 * Score every bucket by counting keyword hits in the supplied text blob.
 * Tokens of length < 2 are dropped (mostly to keep Chinese matching
 * robust to whitespace noise). Each `anti` hit subtracts 1 so ambiguous
 * titles cannot be hijacked across regions.
 *
 * @param {string} text   title + description + platform + industry fields
 * @returns {string|null} bucket id, never undefined. Returns null when
 *                         no bucket scores above 0 (caller may default to
 *                         'interdisciplinary').
 */
export function classifyIndustryText(text = '') {
  const blob = String(text || '');
  if (!blob.trim()) return null;
  const lower = blob.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const bucket of BUCKETS) {
    let score = 0;
    for (const kw of bucket.keywords) {
      if (!kw) continue;
      if (kw.length < 2) continue;
      if (matchesKeyword(lower, kw)) score += 1;
    }
    for (const anti of bucket.anti || []) {
      if (anti && lower.includes(anti.toLowerCase())) score -= 1;
    }
    if (score > bestScore) { bestScore = score; best = bucket.id; }
  }
  return bestScore > 0 ? best : null;
}

function matchesKeyword(lower, keyword) {
  const kw = keyword.toLowerCase();
  if (/^[a-z0-9+#.]{2,3}$/.test(kw)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(lower);
  }
  return lower.includes(kw);
}

export function inferIndustryBucket(jobLike = {}) {
  const blob = [
    jobLike.title || '',
    jobLike.description || '',
    jobLike.industry || '',
    jobLike.platform || '',
    jobLike.company || '',
  ].join('\n');
  return classifyIndustryText(blob);
}
