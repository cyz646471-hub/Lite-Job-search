export async function executeVerificationTask(task, {
  directHttp,
  atsAdapter,
  playwrightFallback,
} = {}) {
  if (!task || typeof directHttp !== 'function') {
    throw new Error('task and directHttp are required');
  }
  const attempts = [];
  for (const url of task.candidates || []) {
    try {
      const direct = await directHttp(url, task);
      attempts.push({ stage: 'DIRECT_HTTP', url, status: direct?.status || 'UNKNOWN' });
      if (direct?.completed === true) {
        return Object.freeze({
          status: 'COMPLETED',
          method: 'DIRECT_HTTP',
          result: direct,
          attempts: Object.freeze(attempts),
        });
      }
      if (direct?.atsType && typeof atsAdapter === 'function') {
        const ats = await atsAdapter(url, direct, task);
        attempts.push({ stage: 'ATS_ADAPTER', url, status: ats?.status || 'UNKNOWN' });
        if (ats?.completed === true) {
          return Object.freeze({
            status: 'COMPLETED',
            method: 'ATS_ADAPTER',
            result: ats,
            attempts: Object.freeze(attempts),
          });
        }
      }
      if (direct?.requiresBrowser === true && typeof playwrightFallback === 'function') {
        const rendered = await playwrightFallback(url, task);
        attempts.push({ stage: 'PLAYWRIGHT_FALLBACK', url, status: rendered?.status || 'UNKNOWN' });
        if (rendered?.completed === true) {
          return Object.freeze({
            status: 'COMPLETED',
            method: 'PLAYWRIGHT_FALLBACK',
            result: rendered,
            attempts: Object.freeze(attempts),
          });
        }
      }
    } catch (error) {
      attempts.push({
        stage: 'DIRECT_HTTP',
        url,
        status: 'FAILED',
        reason: String(error?.message || error),
      });
    }
  }
  return Object.freeze({
    status: task.terminalAction === 'MANUAL_OFFICIAL_DISCOVERY'
      ? 'PENDING_REVIEW'
      : 'FAILED',
    method: null,
    result: null,
    attempts: Object.freeze(attempts),
  });
}
