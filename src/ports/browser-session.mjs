export const REQUIRED_BROWSER_PAGE_METHODS = Object.freeze([
  'goto',
  'waitForTimeout',
  'url',
  'title',
  'snapshot',
  'readBodyText',
  'readSearchRows',
  'observeCareerPage',
  'close',
]);

export function assertBrowserSession(browser) {
  if (typeof browser?.newPage !== 'function') {
    throw new Error('browser.newPage is required');
  }
  if (typeof browser?.close !== 'function') {
    throw new Error('browser.close is required');
  }
  return browser;
}

export function assertBrowserPage(page) {
  for (const method of REQUIRED_BROWSER_PAGE_METHODS) {
    if (typeof page?.[method] !== 'function') {
      throw new Error(`page.${method} is required`);
    }
  }
  return page;
}
