const PROFILE_CONTENTION_CODES = new Set([
  'PROFILE_IN_USE',
  'PROFILE_OWNER_UNVERIFIED',
]);

const TRANSIENT_PATTERNS = Object.freeze([
  ['PROCESS_INSPECTION_TIMEOUT', /\bETIMEDOUT\b|process inspection timeout|spawnSync powershell/i],
  ['SQLITE_BUSY', /\bSQLITE_(?:BUSY|LOCKED)\b|database is locked/i],
  ['BROWSER_DISCONNECTED', /target (?:page|context|browser) has been closed|browser.*disconnected|browser closed/i],
  ['NETWORK_TRANSIENT', /\b(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT)\b/i],
]);

const CONFIGURATION_PATTERNS = Object.freeze([
  /must be a dedicated automation profile/i,
  /input has no usable companies/i,
  /unknown control task/i,
  /are required$/i,
  /invalid .*configuration/i,
]);

function errorText(error) {
  return [
    error?.code,
    error?.causeCode,
    error?.message,
    error,
  ].filter(Boolean).join(' ');
}

export function classifyWorkerError(error) {
  const code = String(error?.code || '');
  const text = errorText(error);
  if (PROFILE_CONTENTION_CODES.has(code)) {
    return Object.freeze({
      code,
      action: 'PAUSE',
      retryable: false,
      reason: String(error?.message || error),
    });
  }
  for (const [matchedCode, pattern] of TRANSIENT_PATTERNS) {
    if (pattern.test(text)) {
      return Object.freeze({
        code: matchedCode,
        action: 'RETRY_THEN_PAUSE',
        retryable: true,
        reason: String(error?.message || error),
      });
    }
  }
  if (CONFIGURATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return Object.freeze({
      code: code || 'INVALID_CONFIGURATION',
      action: 'FAIL',
      retryable: false,
      reason: String(error?.message || error),
    });
  }
  return Object.freeze({
    code: code || 'UNEXPECTED_WORKER_ERROR',
    action: 'FAIL',
    retryable: false,
    reason: String(error?.message || error),
  });
}

export async function runWithWorkerErrorPolicy(operation, {
  maxRetries = 2,
  retryDelayMs = 2_000,
  maxRetryDelayMs = 30_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onError = async () => {},
} = {}) {
  const boundedRetries = Math.max(0, Math.min(10, Number(maxRetries) || 0));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return Object.freeze({
        status: 'SUCCEEDED',
        value: await operation({ attempt }),
        attempts: attempt,
        error: null,
      });
    } catch (error) {
      const classification = classifyWorkerError(error);
      const canRetry = classification.retryable && attempt <= boundedRetries;
      await onError({
        attempt,
        canRetry,
        classification,
        error,
      });
      if (canRetry) {
        const delay = Math.min(
          maxRetryDelayMs,
          Math.max(0, Number(retryDelayMs) || 0) * (2 ** (attempt - 1)),
        );
        if (delay > 0) await sleep(delay);
        continue;
      }
      if (classification.action === 'FAIL') throw error;
      return Object.freeze({
        status: 'PAUSED',
        value: null,
        attempts: attempt,
        error: classification,
      });
    }
  }
}
