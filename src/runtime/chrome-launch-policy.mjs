export const FORBIDDEN_CHROME_ARGUMENTS = Object.freeze([
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu-sandbox',
  '--disable-web-security',
  '--ignore-certificate-errors',
]);

function normalizedFlag(argument) {
  return String(argument || '').trim().split('=', 1)[0].toLowerCase();
}

export function assertSafeChromeArgs(args = []) {
  if (!Array.isArray(args)) throw new TypeError('Chrome args must be an array');
  const forbidden = args
    .map((argument) => ({ argument: String(argument), flag: normalizedFlag(argument) }))
    .filter(({ flag }) => FORBIDDEN_CHROME_ARGUMENTS.includes(flag));
  if (forbidden.length) {
    const error = new Error(
      `BROWSER_UNSAFE_ARGUMENTS: ${forbidden.map(({ argument }) => argument).join(', ')}`,
    );
    error.code = 'BROWSER_UNSAFE_ARGUMENTS';
    error.forbiddenArguments = Object.freeze(forbidden.map(({ argument }) => argument));
    throw error;
  }
  return Object.freeze(args.map((argument) => String(argument)));
}

export function buildSafePersistentChromeOptions({
  channel = 'chrome',
  headless = false,
  args = [],
} = {}) {
  return Object.freeze({
    channel: String(channel || 'chrome'),
    headless: headless === true,
    chromiumSandbox: true,
    viewport: null,
    args: assertSafeChromeArgs(args),
  });
}
