const INDEX_HOSTS = [
  'nowcoder.com', 'yingjiesheng.com', 'shixiseng.com', 'ncss.cn', 'zhipin.com', 'liepin.com',
  'iguopin.com', 'job.mohrss.gov.cn', 'sasac.gov.cn', 'sydwgkzp.cn', 'jobonline.cn',
  'lagou.com', '51job.com', 'kanzhun.com',
  'gankinterview.com', 'gankinterview.cn', 'langlangwangshen.com', 'langlangws.com',
  'niuqizp.com', 'niuqizhipin.com', 'niuqizhipin.cn',
];

function hostMatches(host, suffix) {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function unwrapNowcoderJump(value) {
  try {
    const url = new URL(String(value || ''));
    if (hostMatches(url.hostname.toLowerCase(), 'nowcoder.com') && url.pathname === '/jump') {
      const target = url.searchParams.get('url');
      if (target) return decodeURIComponent(target);
    }
    // WeChat can insert a visible security/captcha wrapper before an official
    // article. The original article remains in target_url; retain that stable
    // official URL in exports rather than making students reopen the wrapper.
    if (hostMatches(url.hostname.toLowerCase(), 'mp.weixin.qq.com') && /wappoc_appmsgcaptcha/i.test(url.pathname)) {
      const target = url.searchParams.get('target_url') || url.searchParams.get('url');
      if (target) return decodeURIComponent(target);
    }
    return url.href;
  } catch {
    return '';
  }
}

export function classifyRecruitmentUrl(value) {
  const unwrapped = unwrapNowcoderJump(value);
  try {
    const url = new URL(unwrapped);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { url: '', channel: 'invalid', rank: 0 };
    if (url.protocol === 'http:') url.protocol = 'https:';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'mp.weixin.qq.com') return { url: url.href, channel: 'official_wechat', rank: 4 };
    if (INDEX_HOSTS.some((suffix) => hostMatches(host, suffix))) {
      return { url: url.href, channel: 'discovery_index', rank: 1 };
    }
    if (hostMatches(host, 'zhaopin.com')) {
      const delegated = host !== 'zhaopin.com' && host !== 'sou.zhaopin.com' && host !== 'jobs.zhaopin.com';
      return { url: url.href, channel: delegated ? 'delegated_official' : 'discovery_index', rank: delegated ? 3 : 1 };
    }
    const jobDetail = /(?:job|position|career|recruit|campus|join|apply)/i.test(`${host}${url.pathname}${url.hash}`);
    return { url: url.href, channel: jobDetail ? 'official_careers' : 'official_candidate', rank: jobDetail ? 5 : 2 };
  } catch {
    return { url: '', channel: 'invalid', rank: 0 };
  }
}

export function pickOfficialRecruitmentLink(values = []) {
  const candidates = values.map(classifyRecruitmentUrl).filter((item) => item.url);
  const official = candidates.filter((item) => item.rank >= 2).sort((a, b) => b.rank - a.rank)[0];
  return { primary: official || null, candidates };
}

export function isOfficialApplyChannel(channel) {
  return ['official_careers', 'official_wechat', 'delegated_official'].includes(channel);
}
