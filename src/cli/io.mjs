import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeStudentWorkbook } from './student-workbook.mjs';

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else value += char;
  }
  cells.push(value);
  return cells;
}

function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((value) => value.trim());
  return lines.slice(1).map((line) => Object.fromEntries(
    parseCsvLine(line).map((value, index) => [headers[index], value]),
  ));
}

export async function readRecords(file) {
  const text = await readFile(path.resolve(file), 'utf8');
  const extension = path.extname(file).toLowerCase();
  if (extension === '.jsonl' || extension === '.ndjson') {
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  if (extension === '.csv') return parseCsv(text);
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.companies)) {
    return parsed.companies.map((record) => ({
      ...record,
      market: record.market || parsed.market || '',
    }));
  }
  return parsed.records || parsed.candidates || [parsed];
}

function csvCell(value) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatRecords(records, format = 'json') {
  if (format === 'jsonl' || format === 'ndjson') {
    return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  }
  if (format === 'csv') {
    const preferred = [
      'company',
      'market',
      'title',
      'location',
      'employmentType',
      'publishedAt',
      'companyCareerHomeUrl',
      'campaignLandingUrl',
      'jobListUrl',
      'jobDetailUrl',
      'applyUrl',
      'sourceUrl',
      'source',
      'officialIdentityConfirmed',
      'applicationActive',
    ];
    const discovered = [...new Set(records.flatMap((record) => Object.keys(record)))];
    const headers = [...preferred.filter((key) => discovered.includes(key)), ...discovered.filter((key) => !preferred.includes(key))];
    return `${headers.join(',')}\n${records.map((record) => headers.map((header) => csvCell(record[header])).join(',')).join('\n')}\n`;
  }
  return `${JSON.stringify(records, null, 2)}\n`;
}

export async function writeRecords(file, records, format = null) {
  const target = path.resolve(file);
  const selected = format || path.extname(target).slice(1).toLowerCase() || 'json';
  if (selected === 'xlsx') return writeStudentWorkbook(target, records);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, formatRecords(records, selected));
  return { output: target, format: selected, count: records.length };
}

