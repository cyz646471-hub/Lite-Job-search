import { assertBrowserPage, assertBrowserSession } from '../src/ports/browser-session.mjs';
import { createPlaywrightBrowserSession } from '../src/adapters/browser/playwright-browser-session.mjs';
import { observeRenderedRecruitmentPage } from '../src/adapters/browser/recruitment-page-observer.mjs';
import { buildSafePersistentChromeOptions } from '../src/runtime/chrome-launch-policy.mjs';

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
      const workTab = tab;
      const page = {
        goto: (url) => workTab.goto(url),
        waitForTimeout: (milliseconds) => workTab.playwright.waitForTimeout(milliseconds),
        url: () => workTab.url(),
        title: () => workTab.title(),
        snapshot: () => captureChromeSnapshot(workTab),
        close: async () => {
          try {
            await workTab.close();
          } catch {
            // A stale or browser-interstitial tab must not poison the next company.
          } finally {
            if (tab === workTab) tab = null;
          }
        },
        readBodyText: async () => workTab.playwright.evaluate(
          () => document.body?.innerText || '',
        ),
        readSearchRows: (maxResults) => workTab.playwright.evaluate((limit) => (
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
        readPublicSearchRows: (engine, maxResults) => workTab.playwright.evaluate((input) => {
          const selectors = input.engine === 'google'
            ? '#search .MjjYud, #search .g, main .g'
            : '#content_left .c-container, #content_left [class*="result"], main article';
          return [...document.querySelectorAll(selectors)]
            .map((container) => {
              const heading = input.engine === 'google'
                ? container.querySelector('h3')
                : null;
              const anchor = input.engine === 'google'
                ? heading?.closest('a[href]')
                  || [...container.querySelectorAll('a[href]')].find((item) => item.querySelector('h3'))
                : [...container.querySelectorAll('a[href]')].find((item) => {
                  const label = (item.innerText || item.textContent || '').trim();
                  try {
                    return label && /^https?:$/i.test(new URL(item.href).protocol);
                  } catch {
                    return false;
                  }
                });
              if (!anchor) return null;
              let href = anchor.href;
              try {
                const target = new URL(href);
                if (input.engine === 'google'
                  && /(^|\.)google\./i.test(target.hostname)
                  && target.pathname === '/url') {
                  href = target.searchParams.get('q') || target.searchParams.get('url') || href;
                }
                const resolved = new URL(href);
                if (!/^https?:$/i.test(resolved.protocol)
                  || (input.engine === 'google' && /(^|\.)google\./i.test(resolved.hostname))) {
                  return null;
                }
                href = resolved.href;
              } catch {
                return null;
              }
              const title = (
                heading?.innerText
                || heading?.textContent
                || anchor.innerText
                || anchor.textContent
                || ''
              ).trim();
              if (!title) return null;
              const text = (container.innerText || '').trim();
              const joined = `${title} ${text} ${String(container.className || '')}`
                .toLowerCase();
              return {
                title,
                href,
                snippet: text.slice(0, 1_200),
                kind: /广告|推广|赞助|sponsored|advertisement|(?:^|\s)ec-/.test(joined)
                  ? 'advertisement'
                  : /新闻|转载|news/.test(joined)
                    ? 'news'
                    : 'organic',
              };
            })
            .filter(Boolean)
            .slice(0, input.limit);
        }, { engine, limit: maxResults }),
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
  args = [],
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
  const context = await chromium.launchPersistentContext(
    profileDir,
    buildSafePersistentChromeOptions({ channel: 'chrome', headless, args }),
  );
  return createPlaywrightBrowserSession(context);
}
