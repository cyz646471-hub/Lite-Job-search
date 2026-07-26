import { assertBrowserPage, assertBrowserSession } from '../src/ports/browser-session.mjs';
import { createPlaywrightBrowserSession } from '../src/adapters/browser/playwright-browser-session.mjs';
import { observeRenderedRecruitmentPage } from '../src/adapters/browser/recruitment-page-observer.mjs';

async function captureChromeSnapshot(tab) {
  return tab.playwright.evaluate(() => ({
    text: document.body?.innerText || '',
    html: document.documentElement?.outerHTML || '',
    title: document.title || '',
    h1: document.querySelector('h1')?.innerText || '',
    links: [...document.querySelectorAll('a[href]')].map((anchor) => ({
      text: (anchor.innerText || anchor.textContent || '').trim(),
      href: anchor.href,
    })).filter((link) => link.text && link.href),
  }));
}

export function createChromeExtensionBrowser(chrome) {
  if (!chrome?.tabs?.new) {
    const error = new Error('Chrome extension browser binding is NOT_CONFIGURED');
    error.code = 'NOT_CONFIGURED';
    throw error;
  }
  let tab = null;
  const session = Object.freeze({
    async newPage() {
      tab ||= await chrome.tabs.new();
      const page = {
        goto: (url) => tab.goto(url),
        waitForTimeout: (milliseconds) => tab.playwright.waitForTimeout(milliseconds),
        url: () => tab.url(),
        title: () => tab.title(),
        snapshot: () => captureChromeSnapshot(tab),
        close: async () => {},
        readBodyText: async () => tab.playwright.evaluate(
          () => document.body?.innerText || '',
        ),
        readSearchRows: (maxResults) => tab.playwright.evaluate((limit) => (
          [...document.querySelectorAll(
            '#content_left .c-container, #content_left [class*="result"], main article',
          )]
            .map((container) => {
              const anchor = [...container.querySelectorAll('a[href]')].find((item) => {
                const title = (item.innerText || item.textContent || '').trim();
                try {
                  return title && /^https?:$/i.test(new URL(item.href).protocol);
                } catch {
                  return false;
                }
              });
              if (!anchor) return null;
              const title = (anchor.innerText || anchor.textContent || '').trim();
              const text = (container.innerText || '').trim();
              const joined = `${title} ${text} ${String(container.className || '')}`
                .toLowerCase();
              return {
                title,
                href: anchor.href,
                snippet: text.slice(0, 1_200),
                kind: /广告|推广|sponsored|advertisement|(?:^|\s)ec-/.test(joined)
                  ? 'advertisement'
                  : /新闻|转载|news/.test(joined)
                    ? 'news'
                    : 'organic',
              };
            }).filter(Boolean).slice(0, limit)
        ), maxResults),
        observeCareerPage: (options) => observeRenderedRecruitmentPage(page, options),
      };
      return assertBrowserPage(Object.freeze(page));
    },
    async close() {
      if (tab) await tab.close();
    },
  });
  return assertBrowserSession(session);
}

export async function createBrowserRuntime({
  mode = 'persistent-chrome',
  chrome = null,
  chromium = null,
  profileDir,
  headless = false,
} = {}) {
  if (mode === 'normal-chrome') {
    if (chrome) return createChromeExtensionBrowser(chrome);
    {
      const error = new Error('normal Chrome requires an extension binding');
      error.code = 'NOT_CONFIGURED';
      throw error;
    }
  }
  if (mode !== 'persistent-chrome') {
    throw new Error(`unsupported browser mode: ${mode}`);
  }
  if (typeof chromium?.launchPersistentContext !== 'function') {
    const error = new Error('persistent Chrome Playwright runtime is NOT_CONFIGURED');
    error.code = 'NOT_CONFIGURED';
    throw error;
  }
  if (!profileDir) {
    throw new Error('persistent Chrome profileDir is required');
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: headless === true,
  });
  return createPlaywrightBrowserSession(context);
}
