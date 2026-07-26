import {
  assertBrowserPage,
  assertBrowserSession,
} from '../../ports/browser-session.mjs';
import { readBaiduRows } from './baidu-search-page-adapter.mjs';
import {
  captureRenderedSnapshot,
  observeRenderedRecruitmentPage,
} from './recruitment-page-observer.mjs';

export function createPlaywrightBrowserSession(context) {
  if (typeof context?.newPage !== 'function') {
    throw new Error('Playwright context.newPage is required');
  }
  const session = Object.freeze({
    async newPage() {
      const page = await context.newPage();
      const wrapped = Object.freeze({
        goto: (url, options) => page.goto(url, options),
        waitForTimeout: (milliseconds) => page.waitForTimeout(milliseconds),
        url: () => page.url(),
        title: () => page.title(),
        snapshot: () => captureRenderedSnapshot(page),
        readBodyText: () => page.locator('body').innerText().catch(() => ''),
        readSearchRows: (limit) => readBaiduRows(page, limit),
        observeCareerPage: (options) => observeRenderedRecruitmentPage(page, options),
        close: () => page.close(),
      });
      return assertBrowserPage(wrapped);
    },
    close: () => context.close(),
  });
  return assertBrowserSession(session);
}
