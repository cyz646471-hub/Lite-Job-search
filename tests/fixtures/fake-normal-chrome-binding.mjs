let currentUrl = '';

const tab = Object.freeze({
  async goto(url) {
    currentUrl = url;
    return Object.freeze({ status: () => 200 });
  },
  async url() {
    return currentUrl;
  },
  async title() {
    return '百度搜索';
  },
  async close() {},
  playwright: Object.freeze({
    async waitForTimeout() {},
    async evaluate(_callback, argument) {
      if (typeof argument === 'number') return [];
      return '抱歉，没有找到与该公司招聘相关的结果。';
    },
  }),
});

export const chromeBrowserBinding = Object.freeze({
  tabs: Object.freeze({
    async new() {
      return tab;
    },
  }),
});
