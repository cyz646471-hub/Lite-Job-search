import { locationText } from '../detail-providers/_helpers.mjs';
import { htmlToText } from '../core.mjs';

function walkJobPosting(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) for (const item of value) walkJobPosting(item, output);
  else if (typeof value === 'object') {
    const type = value['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) output.push(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walkJobPosting(child, output);
  }
  return output;
}

export function parseJobPostingJsonLd(html, originalUrl) {
  const scripts = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const posting = walkJobPosting(JSON.parse(match[1].trim()))[0];
      if (!posting) continue;
      const location = posting.jobLocation || posting.applicantLocationRequirements;
      const address = Array.isArray(location) ? location.map((item) => item?.address || item) : location?.address || location;
      const employees = posting.hiringOrganization?.numberOfEmployees;
      const companySize = typeof employees === 'number' ? employees
        : Number(employees?.value || employees?.maxValue || employees) || null;
      return {
        jobId: posting.identifier?.value || posting.identifier || '',
        title: posting.title || '',
        company: posting.hiringOrganization?.name || '',
        location: locationText(address),
        description: posting.description || '',
        postedAt: posting.datePosted || null,
        expiresAt: posting.validThrough || null,
        applyUrl: posting.url || originalUrl,
        companyWebsite: posting.hiringOrganization?.sameAs || '',
        companySize,
        sourceUrl: originalUrl,
      };
    } catch {}
  }
  return null;
}

function metaContent(html, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forward = new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escaped}["'][^>]*>`, 'i');
  return html.match(forward)?.[1] || html.match(reverse)?.[1] || '';
}

export function parseBasicJobPage(html, originalUrl) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const title = metaContent(html, 'property', 'og:title') || htmlToText(h1) || htmlToText(titleTag);
  const company = metaContent(html, 'property', 'og:site_name') || metaContent(html, 'name', 'application-name');
  const summary = metaContent(html, 'property', 'og:description') || metaContent(html, 'name', 'description');
  if (!title && !company && !summary) return null;
  return { title, company, summary, description: '', applyUrl: originalUrl, sourceUrl: originalUrl };
}
