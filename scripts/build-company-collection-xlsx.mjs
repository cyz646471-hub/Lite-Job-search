import fs from 'node:fs/promises';
import path from 'node:path';

import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const HEADERS = Object.freeze([
  '公司名称',
  '中文名',
  '英文名',
  '国家地区',
  '公司官网域名',
  '招聘入口',
  '招聘渠道',
  '来源等级',
  '页面类型',
  '核验状态',
  '可信度',
  '招聘状态',
  '已登记入口数',
  '开放招聘批次数',
  '活跃岗位数',
  '招聘类型',
  '最后检查时间',
]);

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function quoteFormula(value) {
  return String(value || '').replace(/"/g, '""');
}

export async function buildCompanyCollectionWorkbook({
  rows = [],
  outputFile,
  previewFile = null,
} = {}) {
  if (!outputFile) throw new Error('outputFile is required');
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('企业采集状态');
  sheet.showGridLines = false;
  const lastRow = Math.max(2, rows.length + 1);
  const values = rows.map((row) => [
    row.公司名称,
    row.中文名,
    row.英文名,
    row.国家地区,
    row.公司官网域名,
    row.招聘入口 ? '打开入口' : '',
    row.招聘渠道,
    row.来源等级,
    row.页面类型,
    row.核验状态,
    row.可信度,
    row.招聘状态,
    row.已登记入口数,
    row.开放招聘批次数,
    row.活跃岗位数,
    row.招聘类型,
    dateValue(row.最后检查时间),
  ]);
  sheet.getRange(`A1:Q${rows.length + 1}`).values = [HEADERS, ...values];
  sheet.getRange('A1:Q1').format = {
    fill: '#174A5B',
    font: { bold: true, color: '#FFFFFF' },
    wrapText: true,
    verticalAlignment: 'center',
    borders: { bottom: { style: 'medium', color: '#0E3440' } },
  };
  sheet.getRange(`A2:Q${lastRow}`).format = {
    wrapText: true,
    verticalAlignment: 'center',
    borders: { bottom: { style: 'thin', color: '#D7E3E8' } },
  };
  sheet.getRange(`F2:F${lastRow}`).format.font = {
    color: '#0563C1',
    underline: 'single',
  };
  sheet.getRange(`K2:O${lastRow}`).format.numberFormat = '#,##0';
  sheet.getRange(`Q2:Q${lastRow}`).format.numberFormat = 'yyyy-mm-dd hh:mm';
  sheet.getRange('A1:Q1').format.rowHeight = 30;
  sheet.getRange(`A2:Q${lastRow}`).format.rowHeight = 36;
  const widths = [22, 18, 20, 14, 30, 14, 20, 18, 16, 16, 10, 18, 14, 16, 12, 24, 20];
  for (let column = 0; column < widths.length; column += 1) {
    sheet.getRangeByIndexes(0, column, lastRow, 1).format.columnWidth = widths[column];
  }
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(1);
  if (rows.length) {
    sheet.getRange(`F2:F${rows.length + 1}`).formulas = rows.map((row) => [
      row.招聘入口
        ? `=HYPERLINK("${quoteFormula(row.招聘入口)}","打开入口")`
        : '',
    ]);
    const table = sheet.tables.add(`A1:Q${rows.length + 1}`, true, 'CompanyCollection');
    table.style = 'TableStyleMedium4';
    table.showFilterButton = true;
  }
  const inspection = await workbook.inspect({
    kind: 'table',
    range: `企业采集状态!A1:Q${Math.min(rows.length + 1, 10)}`,
    include: 'values,formulas',
    tableMaxRows: 10,
    tableMaxCols: 17,
  });
  const errors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 100 },
    summary: 'company collection workbook formula error scan',
  });
  if (/"matchCount":\s*[1-9]/.test(errors.ndjson)) {
    throw new Error('company collection workbook contains formula errors');
  }
  if (previewFile) {
    const preview = await workbook.render({
      sheetName: '企业采集状态',
      range: `A1:Q${Math.min(rows.length + 1, 20)}`,
      scale: 1,
      format: 'png',
    });
    await fs.mkdir(path.dirname(previewFile), { recursive: true });
    await fs.writeFile(previewFile, new Uint8Array(await preview.arrayBuffer()));
  }
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputFile);
  return Object.freeze({
    outputFile,
    rowCount: rows.length,
    inspection: inspection.ndjson,
    formulaErrorScan: errors.ndjson,
  });
}
