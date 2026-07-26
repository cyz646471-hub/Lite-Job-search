let currentUrl = '';
const careerUrl = 'https://jobs.example.com/openings';

const tab = Object.freeze({
  async goto(url) {
    currentUrl = url;
    return Object.freeze({ status: () => 200 });
  },
  async url() {
    return currentUrl;
  },
  async title() {
    return currentUrl === careerUrl ? '示例公司招聘' : '百度搜索';
  },
  async close() {},
  playwright: Object.freeze({
    async waitForTimeout() {},
    async evaluate(callback, argument) {
      if (typeof argument === 'number') {
        return currentUrl.includes('baidu.com/s?') ? [{
          title: '示例公司招聘',
          href: careerUrl,
          snippet: '示例公司招聘职位',
          kind: 'organic',
        }] : [];
      }
      if (String(callback).includes('document.documentElement')) {
        return {
          text: '示例公司招聘职位列表 AI 产品经理',
          html: '<main>示例公司招聘职位列表 AI 产品经理</main>',
          title: '示例公司招聘',
          h1: '招聘职位',
          links: [{
            text: 'AI 产品经理',
            href: 'https://jobs.example.com/positions/ai-product-manager',
          }],
        };
      }
      return currentUrl.includes('baidu.com/s?')
        ? '示例公司招聘搜索结果'
        : '示例公司招聘职位列表 AI 产品经理';
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
