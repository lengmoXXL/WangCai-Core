const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { test } = require('node:test');
const { join } = require('node:path');
const { until, withHome } = require('@lengmoxxl/wangcai-testkit');
const { plugin, press, watch } = require('./core-ui.cjs');

// The lines the hint draws for the prefixes above a binding; `Binding.desc` describes how a `desc` array writes them.

const probeEvent = 'prefix-probe';
const probeUi = `export function mount(container, context) {
  context.global.subscribe('${probeEvent}', (data) => { container.textContent = String(data); });
}
`;
const probe = plugin('prefix-probe', { 'ui.js': probeUi });
const other = plugin('prefix-other', { 'ui.js': probeUi });

// A plugin that names the same prefix init.ts does, in its own layer and its own page.
const gitter = plugin('prefix-gitter', { 'ui.js': probeUi }, {
  '<leader>gt': { event: probeEvent, data: '插件的键', desc: ['git', '状态'] },
});

const TIMEOUT = 1000;
const writeInit = (home, keys, tabs) => writeFileSync(join(home, '.config/wangcai/init.ts'), `export default {
  timeout: ${TIMEOUT},
  tabs: [${tabs.map((tab) => JSON.stringify({ id: tab.id, directory: tab.directory })).join(', ')}],
  keys: ${keys},
};
`);

const pageOf = (page, id) => page.locator(`[data-plugin="${id}"]`);
const hint = (page) => page.locator('.which-key');
const readHint = (page) => hint(page).evaluate((node) => ({
  head: node.querySelector('.which-key-head').textContent,
  group: node.querySelector('.which-key-group').hidden ? '' : node.querySelector('.which-key-group').textContent,
  rows: [...node.querySelectorAll('.which-key-row')].map((row) => [row.querySelector('kbd').textContent, row.querySelector('span').textContent]),
}));

// A window on init.ts as a case wrote it, with the focus already inside the probe's page.
const withKeys = (name, keys, tabs, body) => withHome(name, {}, async ({ home, open }) => {
  writeInit(home, keys, tabs);
  const { page, close } = await open();
  const errors = watch(page);
  await pageOf(page, probe.id).waitFor();
  await pageOf(page, probe.id).click();
  await body({ page, errors, said: (want) => until(async () => (await pageOf(page, probe.id).textContent()) === want) });
  await close();
});

test('an array names the prefixes above a binding, and a string still names only the binding', { timeout: 180000 }, () => withKeys('wangcai-prefix-array', `{
  '<leader>ga': { event: '${probeEvent}', data: '暂存了', desc: ['git', '暂存'] },
  '<leader>gc': { event: '${probeEvent}', data: '提交了', desc: ['git', '提交'] },
  '<leader>pf': { event: '${probeEvent}', data: '找到了', desc: ['文件', '按名字'] },
  '<leader>np': { event: '${probeEvent}', data: '深处', desc: '深处' },
}`, [probe], async ({ page, errors, said }) => {
  // Core names the leader through its own `<leader>w`, and each row below carries the line written for it as a prefix.
  await press(page, 'Control+Space');
  await until(async () => !(await hint(page).isHidden()));
  const root = await readHint(page);
  assert.equal(root.head, 'C-SPC');
  assert.equal(root.group, '窗口');
  assert.deepEqual(root.rows.find(([key]) => key === 'g'), ['g', 'git']);
  assert.deepEqual(root.rows.find(([key]) => key === 'p'), ['p', '文件']);
  assert.deepEqual(root.rows.find(([key]) => key === 'w'), ['w', '关标签页']);
  // A string names only its own binding, so the prefix above it stays unnamed and its row is blank.
  assert.deepEqual(root.rows.find(([key]) => key === 'n'), ['n', '']);

  await press(page, 'g');
  await until(async () => (await readHint(page)).head === 'C-SPC g');
  const git = await readHint(page);
  assert.equal(git.group, 'git');
  assert.deepEqual(git.rows, [['a', '暂存'], ['c', '提交']]);

  // The lines are labels: the key under them still runs.
  await press(page, 'a');
  await said('暂存了');
  await until(() => hint(page).isHidden());

  await press(page, 'Control+Space', 'n');
  await until(async () => (await readHint(page)).head === 'C-SPC n');
  assert.equal((await readHint(page)).group, '', 'a prefix no array names shows no line');
  assert.deepEqual((await readHint(page)).rows, [['p', '深处']]);
  assert.deepEqual(errors, []);
}));

test('a short array counts back from the binding, so it names only the nearest prefixes', { timeout: 180000 }, () => withKeys('wangcai-prefix-depth', `{
  '<leader>hw': { event: '${probeEvent}', data: '问候了', desc: ['示例', 'Hello World'] },
  '<leader>bf': { event: '${probeEvent}', data: 'fork 了', desc: ['窗口', 'worktree', 'fork'] },
}`, [probe], async ({ page, errors, said }) => {
  await press(page, 'Control+Space');
  await until(async () => !(await hint(page).isHidden()));
  const root = await readHint(page);
  // Two lines on a three-press binding name `<leader>h` and the binding, leaving the leader to Core's own line.
  assert.equal(root.group, '窗口');
  assert.deepEqual(root.rows.find(([key]) => key === 'h'), ['h', '示例']);
  // Three lines name every press, so this one names the leader too, alongside Core's line for it.
  assert.deepEqual(root.rows.find(([key]) => key === 'b'), ['b', 'worktree']);

  await press(page, 'h');
  await until(async () => (await readHint(page)).head === 'C-SPC h');
  const hello = await readHint(page);
  assert.equal(hello.group, '示例');
  assert.deepEqual(hello.rows, [['w', 'Hello World']]);
  await press(page, 'w');
  await said('问候了');
  assert.deepEqual(errors, []);
}));

test('every layer that names one prefix is shown, spelled either way, and only where it answers', { timeout: 180000 }, () => withKeys('wangcai-prefix-layers', `{
  '<C-Space>gg': { event: '${probeEvent}', data: '到顶了', desc: ['goto', '第一行'] },
}`, [probe, gitter, other], async ({ page, errors, said }) => {
  // init.ts writes the leader out and the plugin writes `<leader>`: both land on one prefix, and both lines show.
  await pageOf(page, gitter.id).click();
  await press(page, 'Control+Space', 'g');
  await until(async () => (await readHint(page)).head === 'C-SPC g');
  const both = await readHint(page);
  assert.equal(both.group, 'git · goto');
  assert.deepEqual(both.rows, [['t', '状态'], ['g', '第一行']]);
  await press(page, 'g');
  await said('到顶了');

  // The plugin's line belongs to its own page: another page sees only the line init.ts wrote.
  await pageOf(page, other.id).click();
  await press(page, 'Control+Space', 'g');
  await until(async () => (await readHint(page)).head === 'C-SPC g');
  const elsewhere = await readHint(page);
  assert.equal(elsewhere.group, 'goto');
  assert.deepEqual(elsewhere.rows, [['g', '第一行']]);
  assert.deepEqual(errors, []);
}));
