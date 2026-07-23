import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { selectBestEntryUrl } from '../core/contracts.mjs';

export const studentHeaders = [
  '公司',
  '市场',
  '招聘批次或岗位',
  '地点',
  '启动或发布时间',
  '岗位方向',
  '投递入口',
  '投递状态',
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

function applicationStatus(record) {
  if (record.applicationActive === true || record.verificationStatus === 'active_verified') return '在招';
  if (record.applicationActive === false) return '已关闭';
  if (record.verificationStatus === 'verified') return '已核验';
  return '待确认';
}

export function toStudentRow(record, defaults = {}) {
  const url = entryUrl(record);
  const roleCategories = Array.isArray(record.roleCategories)
    ? record.roleCategories.join('、')
    : record.roleCategories || record.roleCategory || '';
  return [
    text(record.company),
    text(record.market || defaults.market),
    text(record.title || record.batchName || record.recruitmentBatch),
    text(record.location),
    asDate(record.campaignStartAt || record.recruitmentStartAt || record.publishedAt || record.postedAt || record.sourceUpdatedAt),
    text(roleCategories),
    url ? { text: '查看职位并投递', url } : '',
    applicationStatus(record),
  ];
}

function spreadsheetFormulaText(value) {
  return String(value).replace(/"/g, '""');
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
    const values = rows.map((row) => row.map((cell, index) => index === 6 && cell ? cell.text : cell));
    const endRow = rows.length + 1;
    sheet.getRange(`A2:H${endRow}`).values = values;
    sheet.getRange(`G2:G${endRow}`).formulas = rows.map((row) => {
      const link = row[6];
      return [link ? `=HYPERLINK("${spreadsheetFormulaText(link.url)}","${spreadsheetFormulaText(link.text)}")` : ''];
    });
    sheet.getRange(`E2:E${endRow}`).format.numberFormat = 'yyyy-mm-dd';
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
  sheet.getRange('A:A').format.columnWidth = 20;
  sheet.getRange('B:B').format.columnWidth = 10;
  sheet.getRange('C:C').format.columnWidth = 28;
  sheet.getRange('D:D').format.columnWidth = 18;
  sheet.getRange('E:E').format.columnWidth = 15;
  sheet.getRange('F:F').format.columnWidth = 24;
  sheet.getRange('G:G').format.columnWidth = 22;
  sheet.getRange('H:H').format.columnWidth = 12;
  sheet.getRange('1:1').format.rowHeight = 28;

  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(target);
  return { output: target, format: 'xlsx', count: rows.length };
}
