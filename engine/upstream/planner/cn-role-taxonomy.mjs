export const CN_ROLE_FAMILIES = Object.freeze([
  { id: 'software', label: '软件研发', searchRole: '软件开发' },
  { id: 'product', label: '产品', searchRole: '产品经理' },
  { id: 'data', label: '数据', searchRole: '数据分析' },
  { id: 'marketing', label: '市场营销', searchRole: '市场营销' },
  { id: 'management_trainee', label: '管培生', searchRole: '管培生' },
  { id: 'operations', label: '运营', searchRole: '运营' },
  { id: 'ai', label: '人工智能', searchRole: '人工智能 AI' },
  { id: 'ui_ux', label: 'UI/UX设计', searchRole: 'UI UX 设计' },
  { id: 'finance', label: '金融', searchRole: '金融' },
  { id: 'cross_border', label: '跨境电商', searchRole: '跨境电商' },
  { id: 'hardware', label: '硬件', searchRole: '硬件工程师' },
  { id: 'embedded', label: '嵌入式', searchRole: '嵌入式开发' },
  { id: 'advertising', label: '广告', searchRole: '广告策划' },
  { id: 'sales_bd', label: '销售/商务', searchRole: '销售 商务拓展' },
  { id: 'supply_chain', label: '供应链/采购', searchRole: '供应链 采购' },
  { id: 'human_resources', label: '人力资源', searchRole: '人力资源' },
  { id: 'consulting', label: '咨询', searchRole: '咨询顾问' },
  { id: 'content_media', label: '新媒体/内容', searchRole: '新媒体 内容运营' },
]);

export const DEFAULT_CN_ROLE_TARGETS = Object.freeze(CN_ROLE_FAMILIES.map((family) => family.searchRole));

const ROLE_CLASSIFIERS = Object.freeze([
  ['嵌入式', /嵌入式|单片机|固件|firmware|mcu\b/i],
  ['硬件', /硬件|电路|射频|芯片|半导体|fpga|pcb|电子工程/i],
  ['人工智能', /人工智能|机器学习|深度学习|算法工程|大模型|ai\b|aigc|nlp|计算机视觉/i],
  ['UI/UX设计', /ui\s*[/／-]?\s*ux|用户体验|交互设计|视觉设计|界面设计|产品设计师/i],
  ['跨境电商', /跨境电商|海外电商|亚马逊运营|amazon|shopee|lazada|独立站/i],
  ['广告', /广告|媒介投放|广告策划|广告优化|品牌传播|创意策划/i],
  ['市场营销', /市场营销|市场推广|营销策划|品牌营销|增长营销|市场部|marketing/i],
  ['金融', /金融|投行|证券|基金|银行|保险|量化|风控|审计|财务|会计/i],
  ['管培生', /管培生|管理培训生|management\s*trainee/i],
  ['新媒体/内容', /新媒体|内容运营|内容策划|编辑|文案|短视频|直播运营/i],
  ['运营', /运营|用户增长|社区运营|活动运营|商业化运营|策略运营/i],
  ['产品', /产品经理|产品助理|产品运营|产品策划/i],
  ['数据', /数据分析|商业分析|数据科学|数据开发|数据工程|bi\b/i],
  ['销售/商务', /销售|商务拓展|客户经理|渠道|大客户|bd\b/i],
  ['供应链/采购', /供应链|采购|物流|仓储|计划管理|质量管理/i],
  ['人力资源', /人力资源|招聘专员|hrbp|hr\b|组织发展|薪酬绩效/i],
  ['咨询', /咨询顾问|战略咨询|管理咨询|行业研究/i],
  ['软件研发', /软件|开发工程|前端|后端|客户端|测试开发|运维|云计算|java|python|golang|c\+\+|ios|android/i],
]);

export function classifyCnRoleFamily(record = {}) {
  const title = String(record.title || '');
  const titleMatch = ROLE_CLASSIFIERS.find(([, pattern]) => pattern.test(title));
  if (titleMatch) return titleMatch[0];
  const text = [record.description, record.roleCategory, ...(record.roleCategories || [])]
    .filter(Boolean).join(' ');
  return ROLE_CLASSIFIERS.find(([, pattern]) => pattern.test(text))?.[0] || '其他';
}

export function normalizeCnRoleTargets(roles = [], { includeDefaults = false } = {}) {
  const input = Array.isArray(roles) ? roles : String(roles || '').split('|');
  const values = includeDefaults ? [...input, ...DEFAULT_CN_ROLE_TARGETS] : input;
  const seen = new Set();
  return values.map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
