export function dashboardHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>LJS 招聘数据采集进度</title>
  <style>
    :root{--ink:#132238;--muted:#667085;--line:#dce3ea;--paper:#fff;--bg:#f3f6f8;--green:#17845b;--blue:#2459d3;--amber:#b35c00;--red:#c43737;--shadow:0 12px 32px rgba(25,42,70,.08)}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
    header{background:#132238;color:#fff}.shell{max-width:1180px;margin:auto;padding:0 24px}.topbar{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:20px}
    .brand{display:flex;align-items:center;gap:12px}.brand-mark{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#fff;color:#132238;font-weight:800}.brand h1{font-size:17px;margin:0}.brand p{margin:1px 0 0;color:#b9c6d7;font-size:12px}
    .live{display:flex;align-items:center;gap:8px;color:#dce6f2;font-size:13px}.dot{width:8px;height:8px;border-radius:50%;background:#45d196;box-shadow:0 0 0 5px rgba(69,209,150,.14)}.dot.warn{background:#f8b84e}.dot.bad{background:#f16b6b}
    main{padding:28px 24px 56px}.toolbar{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:18px}.toolbar h2{margin:0;font-size:24px}.toolbar p{margin:4px 0 0;color:var(--muted)}
    button,.button{border:1px solid var(--line);background:var(--paper);color:var(--ink);padding:9px 14px;border-radius:9px;cursor:pointer;text-decoration:none;font:inherit}.primary{background:var(--blue);color:#fff;border-color:var(--blue)}
    .hero{background:linear-gradient(135deg,#fff,#f7faff);border:1px solid var(--line);box-shadow:var(--shadow);padding:24px;border-radius:16px;margin-bottom:18px}.hero-head{display:flex;justify-content:space-between;gap:20px}.eyebrow{color:var(--blue);font-size:11px;font-weight:700;letter-spacing:.12em}.hero h3{margin:5px 0 3px;font-size:20px}.meta{color:var(--muted);font-size:12px}.percent{font-size:34px;font-weight:760}
    .progress-track{height:14px;border-radius:99px;background:#e7ecf1;overflow:hidden;margin:20px 0 9px}.progress-fill{height:100%;width:0;background:linear-gradient(90deg,#2459d3,#31a17a);transition:width .6s}.progress-caption{display:flex;justify-content:space-between;color:var(--muted);font-size:12px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.card,.panel{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:17px}.card{min-height:112px}.card .label,.sub{color:var(--muted);font-size:12px}.card .value{font-size:27px;font-weight:720;margin-top:8px}.value.green{color:var(--green)}.value.red{color:var(--red)}.value.amber{color:var(--amber)}
    .grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:18px}.panel{margin-bottom:18px}.panel h3{font-size:15px;margin:0 0 14px}.status-row{display:grid;grid-template-columns:minmax(0,130px) minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid #eef1f4}.status-row>*{min-width:0;overflow-wrap:anywhere}.status-row:last-child{border-bottom:0}.status-row span:first-child{color:var(--muted)}
    .badge{display:inline-flex;padding:3px 8px;border-radius:99px;font-size:11px;font-weight:650;background:#e8eefc;color:var(--blue)}.badge.good{background:#e4f4ed;color:var(--green)}.badge.warn{background:#fff1dc;color:var(--amber)}.badge.bad{background:#fdeaea;color:var(--red)}
    table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding:8px}td{border-bottom:1px solid #eef1f4;padding:9px 8px}.empty{color:var(--muted);padding:16px 0}
    details{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-top:18px}summary{cursor:pointer;font-weight:650}.advanced{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px}.advanced label{display:block;margin:9px 0;color:var(--muted)}input,select{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;margin-top:4px}pre{white-space:pre-wrap;max-height:280px;overflow:auto;background:#111d2d;color:#dce6f2;padding:14px;border-radius:10px}
    .error{display:none;background:#fdeaea;color:#8f2424;border:1px solid #f2bcbc;padding:12px 14px;border-radius:10px;margin-bottom:16px}
    @media(max-width:850px){.cards{grid-template-columns:repeat(2,1fr)}.grid,.advanced{grid-template-columns:1fr}.topbar,.toolbar,.hero-head{align-items:flex-start;flex-direction:column}.topbar{padding:16px 0}}
    @media(max-width:480px){.shell,main{padding-left:14px;padding-right:14px}.card{padding:14px}.card .value{font-size:23px}}
  </style>
</head>
<body>
<header><div class="shell topbar">
  <div class="brand"><div class="brand-mark">LJS</div><div><h1>招聘数据采集进度</h1><p>SQLite 实时状态 · 官方验证优先</p></div></div>
  <div class="live"><span id="live-dot" class="dot"></span><span id="live-text">正在连接本地 Worker</span></div>
</div></header>
<main class="shell">
  <div id="error" class="error"></div>
  <div class="toolbar"><div><h2>全量补齐看板</h2><p id="updated">等待第一次刷新</p></div><div><button id="refresh">立即刷新</button> <a class="button" href="/api/export">下载最终 XLSX</a></div></div>
  <section class="hero">
    <div class="hero-head"><div><div class="eyebrow">CURRENT BATCH</div><h3 id="batch-name">尚未选择批次</h3><div id="batch-meta" class="meta">—</div></div><div id="percent" class="percent">0%</div></div>
    <div class="progress-track"><div id="progress-fill" class="progress-fill"></div></div>
    <div class="progress-caption"><span id="progress-text">0 / 0 已处理</span><span id="eta">ETA 暂不可用</span></div>
  </section>
  <section class="cards">
    <article class="card"><div class="label">流水线成功</div><div id="succeeded" class="value green">0</div><div class="sub">已完成验证与写入流程</div></article>
    <article class="card"><div class="label">明确失败</div><div id="failed" class="value red">0</div><div class="sub">保留原因，可断点重试</div></article>
    <article class="card"><div class="label">剩余公司</div><div id="remaining" class="value amber">0</div><div id="remaining-sub" class="sub">含尚未装载的公司</div></article>
    <article class="card"><div class="label">正式岗位记录</div><div id="jobs" class="value">0</div><div id="quality-sub" class="sub">0 个 VERIFIED 门户</div></article>
  </section>
  <div class="grid">
    <div><section class="panel"><h3>Worker 活动</h3><div id="worker"></div></section><section class="panel"><h3>最近失败公司</h3><div id="recent-failures"></div></section></div>
    <div><section class="panel"><h3>队列构成</h3><div id="queue"></div></section><section class="panel"><h3>失败原因</h3><div id="failure-reasons"></div></section><section class="panel"><h3>搜索引擎熔断</h3><div id="circuits"></div></section></div>
  </div>
  <details><summary>高级控制与原始状态</summary><div class="advanced">
    <section><h3>新建结构化任务</h3><form id="task">
      <label>地区<input name="location" value="中国大陆"></label><label>岗位关键词（逗号分隔）<input name="role_keywords" required></label><label>行业<input name="industry"></label>
      <label>开始日期<input type="date" name="absolute_date_from" required></label><label>结束日期<input type="date" name="absolute_date_to" required></label><label>目标数量<input type="number" name="target_count" min="1" max="10000" value="20"></label>
      <label>选择模式<select name="selection_mode"><option>NEW_COMPANIES_ONLY</option><option>RECHECK_EXISTING_AND_NEW</option><option>STALE_OR_UNVERIFIED_ONLY</option></select></label>
      <label>目标单位<select name="target_unit"><option>COMPANIES_PROCESSED</option><option>COMPANIES_WITH_VERIFIED_PORTAL</option><option>COMPANIES_WITH_MATCHING_JOBS</option></select></label>
      <label><input style="width:auto" type="checkbox" name="allow_baidu_fallback"> 允许公共搜索补充</label><button class="primary">确认创建</button>
    </form></section>
    <section><h3>人工验证与诊断</h3><p>仅在人完成安全验证后确认；确认不会直接关闭断路器。</p><button id="ack-google">确认已完成 Google 验证</button> <button id="ack-baidu">确认已完成百度验证</button><p><a href="/api/development-record">开发记录</a></p><pre id="raw"></pre></section>
  </div></details>
</main>
<script>
const el=(id)=>document.getElementById(id);
const fmt=(n)=>new Intl.NumberFormat('zh-CN').format(Number(n)||0);
const healthLabels={HEALTHY:'正常运行',STALE:'心跳超时',NOT_STARTED:'尚未启动',EXITED:'已退出',CRASHED:'异常退出'};
const duration=(seconds)=>{if(seconds==null)return '暂不可用';if(seconds<3600)return Math.ceil(seconds/60)+' 分钟';if(seconds<86400)return (seconds/3600).toFixed(1)+' 小时';return (seconds/86400).toFixed(1)+' 天'};
const dt=(value)=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
const escapeHtml=(value)=>String(value??'—').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
async function api(url,options={}){const response=await fetch(url,options);const text=await response.text();if(!response.ok)throw Error(text);return text?JSON.parse(text):null}
function row(label,value){return '<div class="status-row"><span>'+escapeHtml(label)+'</span><strong>'+value+'</strong></div>'}
function badge(value,kind=''){return '<span class="badge '+kind+'">'+escapeHtml(value)+'</span>'}
function render(data){
  const p=data.progress||{};const worker=data.worker;const health=worker?.health;
  el('batch-name').textContent=data.task?.roleKeywords?.join(' / ')||data.batch?.id||'无活动批次';
  el('batch-meta').textContent=(data.batch?.id||'—')+' · '+(data.batch?.status||data.status)+' · '+(data.task?.dateFrom||'—')+' 至 '+(data.task?.dateTo||'—');
  el('percent').textContent=(p.percent||0).toFixed(2)+'%';el('progress-fill').style.width=(p.percent||0)+'%';
  el('progress-text').textContent=fmt(p.processed)+' / '+fmt(p.target)+' 已处理';
  el('eta').textContent='观测速度 '+(data.timing?.companiesPerHour??'—')+' 家/小时 · ETA '+duration(data.timing?.etaSeconds);
  el('succeeded').textContent=fmt(p.succeeded);el('failed').textContent=fmt(p.failed);el('remaining').textContent=fmt(p.remaining);
  el('remaining-sub').textContent='运行中 '+fmt(p.running)+' · 已装载待处理 '+fmt(p.pendingMaterialized)+' · 尚未装载 '+fmt(p.notMaterialized);
  el('jobs').textContent=fmt(data.quality?.jobOpenings);el('quality-sub').textContent=fmt(data.quality?.verifiedPortals)+' 个 VERIFIED 门户 · '+fmt(data.quality?.recruitmentEvents)+' 个招聘事件';
  el('worker').innerHTML=worker?row('健康状态',badge(healthLabels[health]||health,health==='HEALTHY'?'good':health==='STALE'||health==='CRASHED'?'bad':'warn'))+row('进程',escapeHtml((healthLabels[worker.state]||worker.state)+' · PID '+worker.pid))+row('当前公司',escapeHtml(worker.currentCompany))+row('上个完成',escapeHtml(worker.lastCompletedCompany))+row('最近心跳',escapeHtml(dt(worker.heartbeatAt)+'（'+fmt(worker.heartbeatAgeSeconds)+' 秒前）'))+(worker.lastError?row('最近错误',escapeHtml(worker.lastError)):''):'<div class="empty">当前没有 Worker 记录。</div>';
  el('queue').innerHTML=row('目标',fmt(p.target))+row('已物化',fmt(p.materialized))+row('成功',fmt(p.succeeded))+row('失败',fmt(p.failed))+row('延后',fmt(p.deferred))+row('运行中',fmt(p.running))+row('尚未装载',fmt(p.notMaterialized));
  el('failure-reasons').innerHTML=data.failureReasons?.length?data.failureReasons.slice(0,8).map((x)=>row(x.reason,fmt(x.count))).join(''):'<div class="empty">暂无失败原因。</div>';
  el('circuits').innerHTML=data.circuits?.length?data.circuits.map((x)=>row(x.provider,badge(x.state,x.state==='CLOSED'?'good':x.state==='OPEN'?'bad':'warn')+(x.reasonCode?' · '+escapeHtml(x.reasonCode):''))).join(''):'<div class="empty">当前没有搜索引擎熔断记录。</div>';
  el('recent-failures').innerHTML=data.recentFailures?.length?'<table><thead><tr><th>公司</th><th>原因</th><th>尝试</th><th>时间</th></tr></thead><tbody>'+data.recentFailures.map((x)=>'<tr><td>'+escapeHtml(x.company)+'</td><td>'+escapeHtml(x.reason)+'</td><td>'+fmt(x.attemptCount)+'</td><td>'+escapeHtml(dt(x.completedAt))+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">暂无失败记录。</div>';
  el('updated').textContent='数据更新时间 '+dt(data.updatedAt)+' · 页面刷新 '+dt(data.generatedAt);el('raw').textContent=JSON.stringify(data,null,2);
  const healthy=health==='HEALTHY';el('live-dot').className='dot '+(healthy?'':health==='STALE'?'bad':'warn');el('live-text').textContent=healthy?'Worker 正常运行':health==='STALE'?'Worker 心跳已过期':'Worker 当前未运行';
}
async function refresh(){try{el('error').style.display='none';render(await api('/api/progress'))}catch(error){el('error').textContent='读取进度失败：'+error.message;el('error').style.display='block';el('live-dot').className='dot bad';el('live-text').textContent='状态读取失败'}}
el('refresh').onclick=refresh;
el('task').onsubmit=async(event)=>{event.preventDefault();const form=new FormData(event.target);const body=Object.fromEntries(form);body.role_keywords=body.role_keywords.split(',');body.target_count=Number(body.target_count);body.allow_baidu_fallback=form.has('allow_baidu_fallback');await api('/api/tasks',{method:'POST',headers:{'content-type':'application/json','x-ljs-confirm':'yes'},body:JSON.stringify(body)});await refresh()};
async function acknowledge(provider){if(!confirm('确认已人工完成 '+provider+' 安全验证？'))return;await api('/api/providers/'+provider+'/manual-ack',{method:'POST',headers:{'content-type':'application/json','x-ljs-confirm':'yes'},body:'{}'});await refresh()}
el('ack-google').onclick=()=>acknowledge('google');el('ack-baidu').onclick=()=>acknowledge('baidu');refresh();setInterval(refresh,10000);
</script>
</body></html>`;
}
