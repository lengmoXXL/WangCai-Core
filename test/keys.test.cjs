const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { test } = require('node:test');
const { join } = require('node:path');
const { openView, until, withHome, withWindow } = require('@lengmoxxl/wangcai-testkit');
const { plugin, viewPlugin, watch, workspaceLists } = require('./core-ui.cjs');

// A view that says what a keymap binding published: the probe is the only thing it draws, so the window's text is
// what a case reads the binding by.
const probeUi = `export function mount(container, context) {
  context.global.subscribe('keys-probe', (data) => { container.textContent = String(data); });
}
`;
const probe = plugin('keys', { 'ui.js': probeUi });

// A plugin that arrives with a key of its own, the way one declares its config schema.
const provided = plugin('provided', {
  'main.cjs': `exports.activate = () => {};
exports.keys = { '<leader>t': { event: 'keys-probe', data: '插件', desc: '插件自己的键' } };
`,
  'ui.js': probeUi,
});

// The timeout init.ts is given, so a case can wait past it and know a prefix has run out.
const TIMEOUT = 1000;

// init.ts as these cases write it: a fixed leader and that timeout, the plugins a case gives, and the keys and
// commands under test.
const writeInit = (home, keys, tabs, commands = '{}') => writeFileSync(join(home, '.config/wangcai/init.ts'), `export default {
  leader: ' ',
  timeout: ${TIMEOUT},
  tabs: [${tabs.map((tab) => JSON.stringify({ id: tab.id, directory: tab.directory })).join(', ')}],
  keys: ${keys},
  commands: ${commands},
};
`);

// A window with the probe open, and the reading to wait on: the text the probe carries.
const withProbe = (prefix, { keys, commands }, body) => withHome(prefix, {}, async ({ home, open }) => {
  writeInit(home, keys, [probe], commands);
  const { page } = await open();
  const errors = watch(page);
  const echo = page.locator('[data-plugin="keys"]');
  await echo.waitFor();
  const said = (want) => until(async () => (await echo.textContent()) === want);
  return body({ page, errors, echo, said });
});

const press = async (page, ...keys) => { for (const key of keys) await page.keyboard.press(key); };

test('keys bound in init.ts reach the window as an event, a script, or a named command', { timeout: 180000 }, () => withProbe('wangcai-keys', {
  keys: `{
    '<leader>pe': { event: 'keys-probe', data: '事件到了', desc: '发事件' },
    '<leader>ps': { desc: '跑脚本', run: ({ publish }) => publish('keys-probe', '脚本跑到了') },
    '<leader>pc': { command: 'probe.report', args: '命令跑到了', desc: '走 commands' },
  }`,
  commands: `{ 'probe.report': ({ args, publish }) => publish('keys-probe', args) }`,
}, async ({ page, errors, said }) => {
  await press(page, 'Space', 'p', 'e');
  await said('事件到了');
  await press(page, 'Space', 'p', 's');
  await said('脚本跑到了');
  await press(page, 'Space', 'p', 'c');
  await said('命令跑到了');
  assert.deepEqual(errors, []);
}));

// Named keys are read without their case, leader included, so `q` is bound as `<Leader>q` to keep that covered.
test('a prefix waits out the timeout, and the hint lists what may follow', { timeout: 180000 }, () => withProbe('wangcai-keys-prefix', { keys: `{
    'g': { event: 'keys-probe', data: 'g', desc: '单独一个 g' },
    'g g': { event: 'keys-probe', data: 'gg', desc: '到顶部' },
    '<Leader>q': { event: 'keys-probe', data: 'q', desc: '退出' },
  }` }, async ({ page, said, errors }) => {
  const hint = page.locator('.which-key');
  await page.keyboard.press('Space');
  await until(async () => /退出/.test(await hint.textContent()));
  await page.keyboard.press('Escape');
  await until(() => hint.isHidden());
  // Two presses in a row are `gg`; a single `g` lands only once the timeout runs out.
  await press(page, 'g', 'g');
  await said('gg');
  await press(page, 'g');
  await said('g');
  assert.deepEqual(errors, []);
}));

test('a field keeps its own keys, unless the binding asks for them', { timeout: 180000 }, () => withProbe('wangcai-keys-field', { keys: `{
    '<leader>pe': { event: 'keys-probe', data: '窗口' },
    '<leader>pi': { event: 'keys-probe', data: '输入框', insert: true },
  }` }, async ({ page, echo, said, errors }) => {
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'probe-field';
    document.body.append(field);
    field.focus();
  });
  await press(page, 'Space', 'p', 'e');
  // The sequence broke, so `e` belongs to the field; wait past the timeout to see the window binding stay quiet.
  await new Promise((resolve) => setTimeout(resolve, TIMEOUT + 300));
  assert.equal(await echo.textContent(), '');
  assert.equal(await page.locator('#probe-field').inputValue(), 'e');
  await press(page, 'Space', 'p', 'i');
  await said('输入框');
  assert.deepEqual(errors, []);
}));

test('a plugin brings its own keys, and init.ts overrides them', { timeout: 180000 }, () => withHome('wangcai-keys-plugin', { tabs: [provided] }, async ({ home, open }) => {
  // What both windows report, in one list: the second start has to be as clean as the first.
  const first = await open();
  const errors = watch(first.page);
  const echo = first.page.locator('[data-plugin="provided"]');
  await echo.waitFor();
  await press(first.page, 'Space', 't');
  await until(async () => (await echo.textContent()) === '插件');
  await first.close();
  // The same sequence in init.ts overrides the plugin's layer.
  writeInit(home, `{ '<leader>t': { event: 'keys-probe', data: '配置', desc: '覆盖插件的键' } }`, [provided]);
  const second = await open();
  watch(second.page, errors);
  const echoed = second.page.locator('[data-plugin="provided"]');
  await echoed.waitFor();
  await press(second.page, 'Space', 't');
  await until(async () => (await echoed.textContent()) === '配置');
  await second.close();
  assert.deepEqual(errors, []);
}));

test('the default <leader>w closes the current tab', { timeout: 180000 }, () => withWindow('wangcai-keys-close', workspaceLists([viewPlugin('files', '文件'), viewPlugin('terminal', '终端')]), async ({ page, errors }) => {
  await openView(page, '文件');
  await openView(page, '终端');
  const shown = () => page.getByRole('tab').allTextContents();
  await until(async () => (await shown()).join() === '文件,终端');
  await press(page, 'Space', 'w');
  await until(async () => (await shown()).join() === '文件');
  assert.deepEqual(errors, []);
}));
