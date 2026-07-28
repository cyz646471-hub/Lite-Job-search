import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { buildControlProgress } from '../application/build-control-progress.mjs';
import { buildControlCompanyList } from '../application/build-control-company-list.mjs';
import { buildControlJobList } from '../application/build-control-job-list.mjs';
import { createControlPlaneService } from '../application/control-plane-service.mjs';
import { dashboardHtml as progressDashboardHtml } from './control-plane-dashboard.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function confirmed(request, body) {
  return request.headers['x-ljs-confirm'] === 'yes' || body?.confirm === true;
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>LJS 本地控制台</title>
  <style>
    body{font:14px/1.5 system-ui;margin:0;background:#f4f6f8;color:#17202a}
    header,main{max-width:1100px;margin:auto;padding:18px}
    nav a{margin-right:16px}section{background:white;padding:16px;margin:14px 0;border-radius:8px}
    label{display:block;margin:8px 0}input,select{width:100%;max-width:520px;padding:7px}
    button{padding:8px 14px;margin:6px 6px 6px 0}pre{white-space:pre-wrap;max-height:420px;overflow:auto}
  </style>
</head>
<body>
<header><h1>LJS 本地控制台</h1><nav>
<a href="#new">新建任务</a><a href="#status">批次与 Worker</a>
<a href="#baidu">百度人工处理</a><a href="/api/export">导出 XLSX</a>
<a href="/api/development-record">开发记录</a></nav></header>
<main>
<section id="new"><h2>新建结构化任务</h2><form id="task">
<label>地区<input name="location" value="中国大陆"></label>
<label>岗位关键词（逗号分隔）<input name="role_keywords" required></label>
<label>行业<input name="industry"></label>
<label>开始日期<input type="date" name="absolute_date_from" required></label>
<label>结束日期<input type="date" name="absolute_date_to" required></label>
<label>目标数量<input type="number" name="target_count" min="1" max="10000" value="20"></label>
<label>选择模式<select name="selection_mode">
<option>NEW_COMPANIES_ONLY</option><option>RECHECK_EXISTING_AND_NEW</option>
<option>STALE_OR_UNVERIFIED_ONLY</option></select></label>
<label>目标单位<select name="target_unit">
<option>COMPANIES_PROCESSED</option><option>COMPANIES_WITH_VERIFIED_PORTAL</option>
<option>COMPANIES_WITH_MATCHING_JOBS</option></select></label>
<label><input style="width:auto" type="checkbox" name="allow_baidu_fallback"> 允许百度作为最后补充</label>
<button>确认创建</button></form></section>
<section id="status"><h2>真实 SQLite 状态</h2><button id="refresh">刷新</button><pre id="output"></pre></section>
<section id="baidu"><h2>百度人工处理</h2>
<p>仅在人工完成验证码后确认。确认只进入待领取探针状态，不会直接关闭断路器。</p>
<button id="ack">确认已完成人工验证</button></section>
</main>
<script>
const output=document.querySelector('#output');
async function api(url,options={}){const r=await fetch(url,options);const t=await r.text();if(!r.ok)throw Error(t);return t?JSON.parse(t):null}
async function refresh(){output.textContent=JSON.stringify(await api('/api/status'),null,2)}
document.querySelector('#refresh').onclick=refresh;
document.querySelector('#task').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);const body=Object.fromEntries(f);body.role_keywords=body.role_keywords.split(',');body.target_count=Number(body.target_count);body.allow_baidu_fallback=f.has('allow_baidu_fallback');await api('/api/tasks',{method:'POST',headers:{'content-type':'application/json','x-ljs-confirm':'yes'},body:JSON.stringify(body)});await refresh()}
document.querySelector('#ack').onclick=async()=>{if(!confirm('确认已人工完成百度验证？'))return;await api('/api/providers/baidu/manual-ack',{method:'POST',headers:{'content-type':'application/json','x-ljs-confirm':'yes'},body:'{}'});await refresh()}
refresh();
</script></body></html>`;
}

export function createControlPlaneServer({
  repository,
  developmentRecordPath,
  xlsxPath = '',
  buildStudentWorkbook = null,
  buildCompanyWorkbook = null,
  workerLauncher = null,
  actor = 'local-web-user',
} = {}) {
  const service = createControlPlaneService({ repository, actor });
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(progressDashboardHtml());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        json(response, 200, service.status());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/progress') {
        json(response, 200, buildControlProgress({
          repository,
          batchId: url.searchParams.get('batch_id'),
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/progress/companies') {
        const progress = buildControlProgress({
          repository,
          batchId: url.searchParams.get('batch_id'),
        });
        json(response, 200, buildControlCompanyList({
          repository,
          batchId: progress.task?.batchId || progress.batch?.id,
          scope: url.searchParams.get('scope') || 'REMAINING',
          query: url.searchParams.get('query') || '',
          offset: url.searchParams.get('offset') || 0,
          limit: url.searchParams.get('limit') || 50,
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/progress/jobs') {
        json(response, 200, buildControlJobList({
          repository,
          query: url.searchParams.get('query') || '',
          sourceTier: url.searchParams.get('source_tier') || 'ALL',
          jobStatus: url.searchParams.get('job_status') || 'ALL',
          publicationStatus: url.searchParams.get('publication_status') || 'ALL',
          offset: url.searchParams.get('offset') || 0,
          limit: url.searchParams.get('limit') || 50,
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/tasks') {
        json(response, 200, repository.listControlTasks());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/batches') {
        json(response, 200, repository.listBatchRuns());
        return;
      }
      const batchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
      if (request.method === 'GET' && batchMatch) {
        const batchId = decodeURIComponent(batchMatch[1]);
        json(response, 200, {
          batch: repository.getBatchRun(batchId),
          items: repository.listBatchItems(batchId),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/workers') {
        json(response, 200, repository.listWorkerInstances());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/circuits') {
        json(response, 200, repository.listProviderCircuitStates());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/deferred') {
        json(response, 200, repository.listDeferredBatchItems());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/companies') {
        json(response, 200, {
          companies: repository.listCompanies(),
          portals: repository.listCareerPortals(),
          events: repository.listRecruitmentEvents(),
          jobs: repository.listJobOpenings(),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/reviews') {
        json(response, 200, repository.listReviewTasks({
          status: url.searchParams.get('status'),
          targetType: url.searchParams.get('target_type'),
          targetId: url.searchParams.get('target_id'),
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/assignments') {
        json(response, 200, repository.listJobAssignments({
          assigneeType: url.searchParams.get('assignee_type'),
          assigneeId: url.searchParams.get('assignee_id'),
          jobId: url.searchParams.get('job_id'),
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/actions') {
        json(response, 200, repository.listUserActions({
          actorId: url.searchParams.get('actor_id'),
          studentId: url.searchParams.get('student_id'),
          jobId: url.searchParams.get('job_id'),
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/development-record') {
        const text = await readFile(developmentRecordPath, 'utf8');
        response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
        response.end(text);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/export') {
        const generated = typeof buildStudentWorkbook === 'function'
          ? await buildStudentWorkbook()
          : null;
        const exportPath = generated?.outputFile || xlsxPath;
        if (!exportPath || !(await stat(exportPath).catch(() => null))) {
          json(response, 404, { status: 'NOT_CONFIGURED', reason: 'xlsx export file is not configured' });
          return;
        }
        const data = await readFile(exportPath);
        response.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${path.basename(exportPath)}"`,
          'x-ljs-row-count': String(generated?.rowCount ?? ''),
        });
        response.end(data);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/export/companies') {
        if (typeof buildCompanyWorkbook !== 'function') {
          json(response, 404, {
            status: 'NOT_CONFIGURED',
            reason: 'company collection xlsx export is not configured',
          });
          return;
        }
        const generated = await buildCompanyWorkbook();
        const data = await readFile(generated.outputFile);
        response.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${path.basename(generated.outputFile)}"`,
          'x-ljs-row-count': String(generated.rowCount),
        });
        response.end(data);
        return;
      }

      if (request.method === 'POST') {
        const body = await readJson(request);
        if (!confirmed(request, body)) {
          json(response, 409, { status: 'CONFIRMATION_REQUIRED' });
          return;
        }
        if (url.pathname === '/api/tasks') {
          json(response, 201, service.createTask(body));
          return;
        }
        if (url.pathname === '/api/reviews') {
          json(response, 201, service.createReviewTask(body));
          return;
        }
        const resolveReviewMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/resolve$/);
        if (resolveReviewMatch) {
          json(response, 200, service.resolveReviewTask(
            decodeURIComponent(resolveReviewMatch[1]),
            body,
          ));
          return;
        }
        if (url.pathname === '/api/assignments') {
          json(response, 201, service.assignJob(body));
          return;
        }
        if (url.pathname === '/api/actions') {
          json(response, 201, service.recordUserAction(body));
          return;
        }
        const stopMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/stop$/);
        if (stopMatch) {
          json(response, 200, service.stopBatch(decodeURIComponent(stopMatch[1])));
          return;
        }
        const resumeMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/resume$/);
        if (resumeMatch) {
          const batchId = decodeURIComponent(resumeMatch[1]);
          const batch = service.resumeBatch(batchId);
          const worker = workerLauncher
            ? await workerLauncher.start(batchId)
            : { status: 'NOT_CONFIGURED' };
          json(response, 200, {
            status: batch.status,
            batch,
            worker,
          });
          return;
        }
        if (url.pathname === '/api/providers/baidu/manual-ack') {
          json(response, 200, service.acknowledgeBaidu());
          return;
        }
        const providerAckMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/manual-ack$/);
        if (providerAckMatch) {
          json(response, 200, service.acknowledgeSearchProvider(
            decodeURIComponent(providerAckMatch[1]),
          ));
          return;
        }
      }
      json(response, 404, { status: 'NOT_FOUND' });
    } catch (error) {
      json(response, 400, {
        status: 'FAILED',
        error: String(error?.message || error),
      });
    }
  });
}
