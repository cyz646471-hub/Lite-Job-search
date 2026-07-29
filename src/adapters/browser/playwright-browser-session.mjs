import {
  assertBrowserPage,
  assertBrowserSession,
} from '../../ports/browser-session.mjs';
import { readBaiduRows } from './baidu-search-page-adapter.mjs';
import { readPublicSearchRows } from './public-search-page-adapter.mjs';
import {
  captureRenderedSnapshot,
  observeRenderedRecruitmentPage,
} from './recruitment-page-observer.mjs';

export function createPlaywrightBrowserSession(context, {
  closeContext = true,
  onClose = null,
  actionTimeoutMs = 5_000,
} = {}) {
  if (typeof context?.newPage !== 'function') {
    throw new Error('Playwright context.newPage is required');
  }
  const session = Object.freeze({
    async newPage() {
      const page = await context.newPage();
      page.setDefaultTimeout?.(Math.max(1_000, Number(actionTimeoutMs) || 5_000));
      const wrapped = Object.freeze({
        goto: (url, options) => page.goto(url, options),
        waitForTimeout: (milliseconds) => page.waitForTimeout(milliseconds),
        url: () => page.url(),
        title: () => page.title(),
        snapshot: () => captureRenderedSnapshot(page),
        readBodyText: () => page.locator('body').innerText().catch(() => ''),
        readSearchRows: (limit) => readBaiduRows(page, limit),
        readPublicSearchRows: (engine, limit) => readPublicSearchRows(page, engine, limit),
        observeCareerPage: (options) => observeRenderedRecruitmentPage(page, options),
        close: () => page.close(),
      });
      return assertBrowserPage(wrapped);
    },
    close: async () => {
      if (typeof onClose === 'function') return onClose();
      if (closeContext) return context.close();
      return undefined;
    },
  });
  return assertBrowserSession(session);
}
