import { inferRecruitmentBatch } from './cn-recruitment-project.mjs';
import { parseCohortYear } from '../providers/_cn-entities.mjs';

const CITIES = ['北京', '上海', '深圳', '广州', '杭州', '成都', '武汉', '南京', '西安', '香港', '全国', '远程', '海外'];
function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function parseDate(value = '') { const match = String(value).match(/(20\d{2})[年\-/](\d{1,2})[月\-/](\d{1,2})/); return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null; }

export function extractCnFields({ title = '', plainText = '', links = [], sourceUrl = '' } = {}) {
  const text = `${title}\n${plainText}`;
  const cohortYear = parseCohortYear(text) || Number(text.match(/(20\d{2})届/)?.[1]) || null;
  const deadlineEvidence = text.match(/(?:网申|简历|申请|投递)?(?:截止时间|截止日期|截止)[：:\s]*([^\n。；]{4,40})/i)?.[0] || '';
  const deadline = parseDate(deadlineEvidence);
  const locations = CITIES.filter((city) => text.includes(city));
  const apply = links.find((item) => /立即投递|网申入口|申请岗位|招聘官网|阅读原文/i.test(item.text || ''))?.url || sourceUrl;
  const company = clean(title.match(/^([^｜|—\-]{2,40})[｜|—\-]/)?.[1] || text.match(/(?:公司名称|招聘单位)[：:\s]*([^\n，,。；]{2,50})/)?.[1] || '');
  const recruitmentType = inferRecruitmentBatch({ title, description: plainText, cohortYear });
  return { company, campaignName: clean(title), recruitmentType, cohortYear, locations, deadline, announcementUrl: sourceUrl, applyUrl: apply, positions: [], evidence: { recruitmentType: recruitmentType === '待确认批次' ? '' : recruitmentType, cohortYear: cohortYear ? `${cohortYear}届` : '', deadline: deadlineEvidence }, confidence: { recruitmentType: recruitmentType === '待确认批次' ? 0.2 : 0.9, cohortYear: cohortYear ? 0.95 : 0, deadline: deadline ? 0.9 : 0 } };
}

export function validateExtractedFields(value = {}) {
  const errors = [];
  if (!clean(value.company)) errors.push('公司名称不能为空');
  if (value.cohortYear && !/^20\d{2}$/.test(String(value.cohortYear))) errors.push('届别格式无效');
  if (value.deadline && value.publishedAt && Number(value.deadline) < Number(value.publishedAt)) errors.push('截止日期早于发布时间');
  if (value.applyUrl) { try { new URL(value.applyUrl); } catch { errors.push('投递链接无效'); } }
  if (!['提前批', '秋招', '春招', '暑期实习', '日常实习', '补录', '社招', '校招', '待确认批次'].includes(value.recruitmentType)) errors.push('招聘类型不在枚举中');
  return { valid: errors.length === 0, errors };
}

export async function enrichWithLlmExtraction(base, { extract } = {}) {
  if (typeof extract !== 'function') return { ...base, llmStatus: 'not_configured' };
  try {
    const extracted = await extract(base);
    const validation = validateExtractedFields({ ...base, ...extracted });
    return validation.valid ? { ...base, ...extracted, llmStatus: 'accepted', validation } : { ...base, llmStatus: 'review_required', validation, llmCandidate: extracted };
  } catch (error) { return { ...base, llmStatus: 'failed', llmError: error.message || String(error) }; }
}
