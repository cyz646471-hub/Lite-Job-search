import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { selectBestEntryUrl } from '../core/contracts.mjs';

export const studentHeaders = [
  '公司名称',
  '公司类型（模型判断）',
  '开放批次',
  '开放岗位',
  '地区',
  '开始时间',
  '截止时间',
  '投递链接',
];

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function asDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date;
}

function entryUrl(record) {
  const entryType = text(record.entryType);
  const hasOfficialReportEntry = entryType.startsWith('official_')
    || entryType === '官方招聘站或受委托 ATS'
    || entryType === '企业官方招聘公告（公众号）';
  return selectBestEntryUrl(record)?.url
    || (hasOfficialReportEntry ? record.recruitmentEntryUrl : '')
    || '';
}

function companyType(record) {
  const prediction = record.companyTypePrediction || record.companyTypeAssessment || {};
  const label = text(prediction.label || prediction.type || record.companyType);
  const confidence = Number(prediction.confidence ?? record.companyTypeConfidence);
  if (label && Number.isFinite(confidence) && confidence >= 0.8) return label;
  return '待确认';
}

function recruitmentBatch(record) {
  const batch = text(
    record.recruitmentBatch
    || record.batchName
    || record.recruitmentType
    || record.recruitmentTypes?.[0],
  );
  if (!batch) return '待确认';
  const cohortYear = text(record.cohortYear);
  if (!cohortYear || batch.includes(cohortYear)) return batch;
  return `${cohortYear}届${batch}`;
}

function locations(record) {
  if (Array.isArray(record.locations)) return record.locations.map(text).filter(Boolean).join('、');
  return text(record.location);
}

function deadline(record) {
  const value = asDate(record.closesAt || record.expiresAt || record.deadline);
  if (value) return value;
  if (
    record.deadlineType === 'until_filled'
    || /招满|until.?filled/i.test(text(record.deadline))
  ) return '招满即止';
  return '未披露';
}

export function toStudentRow(record, defaults = {}) {
  const url = entryUrl(record);
  return [
    text(record.company || record.companyName || defaults.company),
    companyType(record),
    recruitmentBatch(record),
    text(record.title || record.positionTitle || record.roleTitle),
    locations(record),
    asDate(
      record.publishedAt
      || record.postedAt
      || record.campaignStartAt
      || record.recruitmentStartAt
      || record.sourceUpdatedAt,
    ) || '未披露',
    deadline(record),
    url ? { text: '查看岗位并投递', url } : '',
  ];
}

function spreadsheetFormulaText(value) {
  return String(value).replace(/"/g, '""');
}

export function studentHyperlinkFormula(link) {
  if (!link?.url) return '';
  const url = spreadsheetFormulaText(link.url);
  const label = spreadsheetFormulaText(link.text || '查看岗位并投递');
  return `=IFERROR(HYPERLINK("${url}","${label}"),"${label}")`;
}

async function loadArtifactTool() {
  try {
    return await import('@oai/artifact-tool');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('XLSX export requires the Codex Desktop spreadsheet runtime (@oai/artifact-tool). Run this workflow inside Codex Desktop or configure that runtime before exporting.');
    }
    throw error;
  }
}

export async function writeStudentWorkbook(file, records, defaults = {}) {
  const { SpreadsheetFile, Workbook } = await loadArtifactTool();
  const rows = records.map((record) => toStudentRow(record, defaults));
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('投递清单');
  sheet.showGridLines = false;

  sheet.getRange('A1:H1').values = [studentHeaders];
  if (rows.length) {
    const values = rows.map((row) => row.map((cell, index) => index === 7 && cell ? cell.text : cell));
    const endRow = rows.length + 1;
    sheet.getRange(`A2:H${endRow}`).values = values;
    sheet.getRange(`H2:H${endRow}`).formulas = rows.map((row) => {
      const link = row[7];
      return [studentHyperlinkFormula(link)];
    });
    sheet.getRange(`F2:G${endRow}`).format.numberFormat = 'yyyy-mm-dd';
    sheet.getRange(`2:${endRow}`).format.rowHeight = 30;
    sheet.tables.add(`A1:H${endRow}`, true, 'StudentApplications');
  }

  sheet.freezePanes.freezeRows(1);
  sheet.getRange('A1:H1').format = {
    fill: '#1F4E78',
    font: { bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
  };
  sheet.getRange(`A1:H${Math.max(rows.length + 1, 2)}`).format.verticalAlignment = 'center';
  sheet.getRange(`A1:H${Math.max(rows.length + 1, 2)}`).format.wrapText = true;
  if (rows.length) sheet.getRange(`H2:H${rows.length + 1}`).format.wrapText = false;
  sheet.getRange('A:A').format.columnWidth = 22;
  sheet.getRange('B:B').format.columnWidth = 20;
  sheet.getRange('C:C').format.columnWidth = 18;
  sheet.getRange('D:D').format.columnWidth = 30;
  sheet.getRange('E:E').format.columnWidth = 20;
  sheet.getRange('F:G').format.columnWidth = 15;
  sheet.getRange('H:H').format.columnWidth = 22;
  sheet.getRange('1:1').format.rowHeight = 28;

  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(target);
  return { output: target, format: 'xlsx', count: rows.length };
}
