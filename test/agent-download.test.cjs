const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { until, withHome } = require('@lengmoxxl/wangcai-testkit');
const { plugin, watch } = require('./core-ui.cjs');

// A plugin that asks for a machine and nothing else: what stops it is the download.
const ask = plugin('ask', { 'main.cjs': 'exports.activate = (context) => { void context.connect({}).catch(() => {}); };\n' });

test('a download that fails says so in the corner of the pane, and the retry starts it over', { timeout: 180000 }, () => withHome('wangcai-agent-download', {}, async ({ home, env, open }) => {
  // The window reads the environment it is launched with, so the agent the checkout already built is dropped before it
  // opens: this case is about the download, and its network is a port nothing listens on.
  delete env.WANGCAI_AGENT_SOURCE;
  writeFileSync(join(home, '.config/wangcai/init.ts'), `export default {
  network: { proxy: 'http://127.0.0.1:1' },
  tabs: [{ id: ${JSON.stringify(ask.id)}, directory: ${JSON.stringify(ask.directory)} }],
};
`);
  const { page } = await open();
  const errors = watch(page);
  const chip = page.locator('.agent-download');
  await until(async () => (await chip.getAttribute('data-stage')) === 'failed');
  assert.equal(await chip.locator('span').first().textContent(), '下载 wangcai 失败');
  assert.ok(await chip.locator('button').isVisible());
  // The press starts the download again: it reports that it is under way before the same failure returns, and the
  // button is handed back pressable once it does.
  const stages = await page.evaluate(() => new Promise((resolve) => {
    const element = document.querySelector('.agent-download');
    const seen = [];
    const timer = setTimeout(() => resolve(seen), 30000);
    new MutationObserver(() => {
      seen.push(element.dataset.stage);
      if (seen.length === 2) {
        clearTimeout(timer);
        resolve(seen);
      }
    }).observe(element, { attributes: true, attributeFilter: ['data-stage'] });
    element.querySelector('button').click();
  }));
  assert.deepEqual(stages, ['downloading', 'failed']);
  await until(() => chip.locator('button').isEnabled());
  assert.deepEqual(errors, []);
}));