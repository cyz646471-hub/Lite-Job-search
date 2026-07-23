import { archiveSourceDocument } from './cn-source-document-store.mjs';
import { parseContentDocument } from './cn-content-parser.mjs';
import { extractCnFields, validateExtractedFields } from './cn-field-extractor.mjs';

export const GOVERNMENT_DOMAIN_ALLOWLIST = Object.freeze(['gov.cn', 'mohrss.gov.cn', 'sasac.gov.cn', 'iguopin.com', 'ncss.cn']);
export function allowedGovernmentUrl(value = '') { try { const host = new URL(value).hostname.toLowerCase(); return GOVERNMENT_DOMAIN_ALLOWLIST.some((domain) => host === domain || host.endsWith(`.${domain}`)); } catch { return false; } }

export class SourceAdapter {
  constructor({ id, sourceType = 'aggregator', sourceName = '', discover = async () => [] } = {}) { this.id = id; this.sourceType = sourceType; this.sourceName = sourceName || id; this.discover = discover; }
  async fetch(url, { fetcher = fetch, rootDir, now = Date.now() } = {}) {
    const response = await fetcher(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Career-OP/1.20)' } });
    const rawContent = await response.text();
    const contentType = response.headers.get('content-type') || 'text/html';
    const document = await archiveSourceDocument(rootDir, { url: response.url || url, sourceType: this.sourceType, sourceName: this.sourceName, rawContent, contentType, httpStatus: response.status }, { now });
    return { document, rawContent, contentType };
  }
  async parse(fetched) {
    const parsed = parseContentDocument({ rawContent: fetched.rawContent, contentType: fetched.contentType, url: fetched.document.url });
    const fields = extractCnFields({ title: parsed.title, plainText: parsed.plainText, links: parsed.links, sourceUrl: fetched.document.url });
    const validation = validateExtractedFields(fields);
    return [{ recordType: 'discovery_lead', sourceType: this.sourceType, source: this.sourceName, sourceDocumentId: fetched.document.documentId, ...fields, validation }];
  }
}

export class UniversitySourceAdapter extends SourceAdapter {
  constructor(config = {}) { super({ ...config, sourceType: 'university', sourceName: config.schoolName || config.sourceName }); this.config = config; }
}
export class GovernmentSourceAdapter extends SourceAdapter {
  constructor(config = {}) { super({ ...config, sourceType: 'government', sourceName: config.sourceName }); }
  async fetch(url, options = {}) { if (!allowedGovernmentUrl(url)) throw new Error('government adapter rejected URL outside allowlist'); return super.fetch(url, options); }
}
