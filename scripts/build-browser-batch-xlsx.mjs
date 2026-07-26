import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const HEADERS = Object.freeze([
  '公司名称',
  '公司类型',
  '公司简介',
  '来源等级',
  '招聘批次',
  '届次',
  '开始时间',
  '截止时间',
  '地区',
  '开放岗位',
  '投递链接',
  '招聘状态',
  '最后核验时间',
]);

function parseArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    args[key] = key === 'preview' ? true : argv[++index];
  }
  return args;
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function quoteFormula(value) {
  return String(value || '').replace(/"/g, '""');
}

export async function buildStudentApplicationWorkbook({
  rows = [],
  outputFile,
  previewFile = null,
} = {}) {
  if (!outputFile) throw new Error('outputFile is required');
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('投递清单');
  sheet.showGridLines = false;
  const lastRow = Math.max(2, rows.length + 1);
  const values = rows.map((row) => [
    row.公司名称,
    row.公司类型,
    row.公司简介,
    row.来源等级,
    row.招聘批次,
    row.届次,
    dateValue(row.开始时间),
    dateValue(row.截止时间),
    row.地区,
    row.开放岗位,
    row.投递链接 ? '查看并投递' : '',
    row.招聘状态,
    dateValue(row.最后核验时间),
  ]);
  sheet.getRange(`A1:M${rows.length + 1}`).values = [HEADERS, ...values];
  sheet.getRange('A1:M1').format = {
    fill: '#1F4E78',
    font: { bold: true, color: '#FFFFFF' },
    wrapText: true,
    verticalAlignment: 'center',
  };
  sheet.getRange(`A2:M${lastRow}`).format = {
    wrapText: true,
    verticalAlignment: 'center',
    borders: {
      bottom: { style: 'thin', color: '#D9E2F3' },
    },
  };
  sheet.getRange(`G2:H${lastRow}`).format.numberFormat = 'yyyy-mm-dd';
  sheet.getRange(`M2:M${lastRow}`).format.numberFormat = 'yyyy-mm-dd';
  sheet.getRange(`K2:K${lastRow}`).format.font = {
    color: '#0563C1',
    underline: 'single',
  };
  sheet.getRange('A1:M1').format.rowHeight = 28;
  sheet.getRange(`A2:M${lastRow}`).format.rowHeight = 48;
  const widths = [22, 18, 28, 16, 22, 10, 14, 14, 20, 42, 16, 12, 18];
  for (let column = 0; column < widths.length; column++) {
    sheet.getRangeByIndexes(0, column, lastRow, 1).format.columnWidth = widths[column];
  }
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(1);
  if (rows.length) {
    const table = sheet.tables.add(`A1:M${rows.length + 1}`, true, 'StudentApplications');
    table.style = 'TableStyleMedium2';
    table.showFilterButton = true;
  }

  if (previewFile) {
    const preview = await workbook.render({
      sheetName: '投递清单',
      range: `A1:M${Math.min(rows.length + 1, 20)}`,
      scale: 1,
      format: 'png',
    });
    await fs.mkdir(path.dirname(previewFile), { recursive: true });
    await fs.writeFile(previewFile, new Uint8Array(await preview.arrayBuffer()));
  }
  if (rows.length) {
    sheet.getRange(`K2:K${rows.length + 1}`).formulas = rows.map((row) => [
      row.投递链接
        ? `=HYPERLINK("${quoteFormula(row.投递链接)}","查看并投递")`
        : '',
    ]);
  }
  const inspection = await workbook.inspect({
    kind: 'table',
    range: `投递清单!A1:M${Math.min(rows.length + 1, 10)}`,
    include: 'values,formulas',
    tableMaxRows: 10,
    tableMaxCols: 13,
  });
  const errors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 100 },
    summary: 'student workbook formula error scan',
  });
  if (/"matchCount":\s*[1-9]/.test(errors.ndjson)) {
    throw new Error('student workbook contains formula errors');
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

async function runCli() {
  const args = parseArgs(globalThis.process?.argv?.slice(2));
  if (args.help || !args.input || !args.output) {
    globalThis.process.stdout.write(
      'Usage: node scripts/build-browser-batch-xlsx.mjs --input outputs/student-application-rows.json --output outputs/student-applications.xlsx [--preview]\n',
    );
    return args.help ? 0 : 2;
  }
  const inputFile = path.resolve(args.input);
  const outputFile = path.resolve(args.output);
  const rows = JSON.parse(await fs.readFile(inputFile, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('student projection input must be an array');
  const previewFile = args.preview
    ? outputFile.replace(/\.xlsx$/i, '.preview.png')
    : null;
  const result = await buildStudentApplicationWorkbook({
    rows,
    outputFile,
    previewFile,
  });
  globalThis.process.stdout.write(`${JSON.stringify({
    status: 'COMPLETE',
    outputFile: result.outputFile,
    rowCount: result.rowCount,
    previewFile,
  })}\n`);
  return 0;
}

if (globalThis.process?.argv?.[1]
  && path.resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then((code) => {
    globalThis.process.exitCode = code;
  }).catch((error) => {
    globalThis.process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      reasonCode: 'xlsx_export_failed',
      error: String(error?.message || error),
    })}\n`);
    globalThis.process.exitCode = 1;
  });
}
