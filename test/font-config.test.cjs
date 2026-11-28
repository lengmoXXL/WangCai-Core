const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { previewMessage, previewUrl } = require('@lengmoxxl/sdk/bridge');
const { withHome } = require('@lengmoxxl/wangcai-testkit');
const { plugin, watch } = require('./core-ui.cjs');

const fontSchema = {
  family: { type: 'string', default: 'Menlo, monospace' },
  size: { type: 'number', default: 13 },
  lineHeight: { type: 'number', default: 1 },
};

const fontPlugin = (id, schema, config) => ({
  ...plugin(id, {
    'main.cjs': `exports.config = ${JSON.stringify({ font: schema })};
exports.activate = ({ host, ui }) => ui.handle('font', () => host.config.font);`,
    'ui.js': `export function mount(container, { host }) {
  container.dataset.font = JSON.stringify(host.config.font);
}`,
  }),
  config,
});

test('the window and plugins inherit init.ts font fields with per-plugin overrides', { timeout: 180000 }, () => withHome('wangcai-font', {
  tabs: [
    fontPlugin('inherits', fontSchema),
    fontPlugin('size-override', fontSchema, { font: { family: 42, size: 20 } }),
    fontPlugin('family-only', { family: fontSchema.family }, { font: { family: 'Menlo, monospace', size: 21 } }),
  ],
}, async ({ home, open }) => {
  const source = join(home, '.config/wangcai/init.ts');
  const font = { family: 'Georgia, serif', size: 16, lineHeight: 1.5 };
  writeFileSync(source, readFileSync(source, 'utf8').replace('export default {', `export default { font: ${JSON.stringify(font)},`));
  const { page } = await open();
  const errors = watch(page);

  for (const [id, expected] of [
    ['inherits', font],
    ['size-override', { ...font, size: 20 }],
    ['family-only', { family: 'Menlo, monospace' }],
  ]) {
    const view = page.locator(`.plugin[data-plugin="${id}"][data-font]`);
    assert.deepEqual(JSON.parse(await view.getAttribute('data-font')), expected);
    assert.deepEqual(await page.evaluate((pluginId) => window.wangcai.call('request', pluginId, 'font'), id), expected);
  }
  assert.deepEqual(await page.evaluate(() => {
    const { fontFamily, fontSize, lineHeight } = getComputedStyle(document.body);
    return [fontFamily, fontSize, lineHeight];
  }), [font.family, '16px', '24px']);

  await page.evaluate(({ previewUrl, previewMessage }) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = previewUrl;
    addEventListener('message', (event) => {
      if (event.source === frame.contentWindow && event.data === previewMessage) {
        event.source.postMessage('<!doctype html><style>html { line-height: 2 }</style><p>Preview</p>', '*');
      }
    });
    document.body.append(frame);
  }, { previewUrl, previewMessage });
  assert.deepEqual(await page.frameLocator('iframe').getByText('Preview').evaluate((element) => {
    const { fontFamily, fontSize, lineHeight } = getComputedStyle(element);
    return [fontFamily, fontSize, lineHeight];
  }), [font.family, '16px', '32px']);
  assert.deepEqual(errors, []);
}));
