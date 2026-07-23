import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
export function canonicalDocumentUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|spm|from|source|ref|trk)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}

export function createSourceDocument(input = {}, { now = Date.now() } = {}) {
  const rawContent = typeof input.rawContent === 'string' ? input.rawContent : '';
  const canonicalUrl = canonicalDocumentUrl(input.url || input.canonicalUrl);
  const contentHash = createHash('sha256').update(rawContent || canonicalUrl).digest('hex');
  return {
    documentId: contentHash.slice(0, 32), sourceType: clean(input.sourceType) || 'aggregator', sourceName: clean(input.sourceName),
    url: clean(input.url), canonicalUrl, title: clean(input.title), publishedAt: Number(input.publishedAt) || null,
    observedAt: Number(input.observedAt) || now, fetchedAt: now, contentType: clean(input.contentType) || 'html',
    rawStoragePath: '', plainText: clean(input.plainText), contentHash, httpStatus: Number(input.httpStatus) || null,
    parserVersion: clean(input.parserVersion) || 'v1', parentDocumentId: clean(input.parentDocumentId) || null,
  };
}

export async function archiveSourceDocument(rootDir, input = {}, options = {}) {
  const document = createSourceDocument(input, options);
  const date = new Date(document.fetchedAt);
  const base = path.join(rootDir, 'data', 'cn-source-documents', String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'));
  await mkdir(base, { recursive: true });
  const extension = /json/i.test(document.contentType) ? 'json' : /pdf/i.test(document.contentType) ? 'pdf' : 'html';
  const rawPath = path.join(base, `${document.documentId}.${extension}`);
  const metaPath = path.join(base, `${document.documentId}.meta.json`);
  if (input.rawContent !== undefined) await writeFile(rawPath, String(input.rawContent), 'utf8');
  document.rawStoragePath = rawPath;
  await writeFile(metaPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return document;
}
