const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { until, withHome } = require('@lengmoxxl/wangcai-testkit');
const { mockWorkspace, mockWorkspaceRow, openView, plugin, untilTabs, viewPlugin, viewTabs, watch, workspaceLists, workspacePage, workspaces } = require('./core-ui.cjs');

test('sidebar tabs can be dragged into a new order', { timeout: 180000 }, () => withHome('wangcai-tab-order', workspaceLists([viewPlugin('files', '文件'), viewPlugin('terminal', '终端')]), async ({ open }) => {
  let { page, close } = await open();
  const errors = watch(page);
  const tab = (name) => viewTabs(page).filter({ has: page.getByRole('tab', { name, exact: true }) });
  const dropped = () => page.locator('[data-drop]');
  await openView(page, '文件');
  await openView(page, '终端');
  await untilTabs(page, ['文件', '终端'], 'the two views are drawn in the order they were opened');
  // A tab is grabbed by its label and dropped on the one it should stand in front of; the pointer says where in that
  // tab it lets go, which is what decides the side.
  const sourceBox = await tab('文件').boundingBox();
  const targetBox = await tab('终端').boundingBox();
  await page.mouse.move(sourceBox.x + 20, sourceBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 20, targetBox.y + 18, { steps: 6 });
  await until(async () => (await dropped().count()) === 1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await until(async () => (await dropped().count()) === 0);
  await tab('终端').dragTo(tab('文件'), { targetPosition: { x: 4, y: 18 } });
  await untilTabs(page, ['终端', '文件'], 'the dropped tab takes the place it was let go on');
  await tab('终端').dragTo(tab('文件'), { targetPosition: { x: 45, y: 18 } });
  await untilTabs(page, ['文件', '终端'], 'and letting go on the other side puts it back');
  // Opening a workspace rebinds these tabs to it, which rewrites the keys they are stored under.
  await workspaces(page, 1);
  await tab('终端').dragTo(tab('文件'), { targetPosition: { x: 4, y: 18 } });
  await untilTabs(page, ['终端', '文件'], 'the order holds on the workspace the tabs were rebound to');
  await close();
  ({ page, close } = await open());
  watch(page, errors);
  await untilTabs(page, ['终端', '文件'], 'a window opened again draws the tabs in the order they were left');
  assert.deepEqual(errors, []);
}));

test('restored tabs mount when first shown and keep their state across workspace switches', { timeout: 180000 }, () => {
  const view = plugin('probe', { 'ui.js': `
export function mount() { window.tabEvents = []; }
export function open({ host }, { id, workspaceId }) {
  host.tabs({ id, title: id, workspaceId,
    onClose() { window.tabEvents.push('close:' + id); },
    mount(panel) {
      window.tabEvents.push('mount:' + id);
      panel.append(document.createElement('input'));
      return { dispose() { window.tabEvents.push('dispose:' + id); } };
    },
  });
}
` });
  const lists = { workspaces: [mockWorkspace({ rows: ['w1', 'w2'].map(mockWorkspaceRow) })], tabs: [view] };
  return withHome('wangcai-lazy-tabs', lists, async ({ home, open }) => {
    const directory = join(home, '.local/share/wangcai/data/core');
    mkdirSync(directory, { recursive: true });
    const records = join(directory, 'tabs.json');
    writeFileSync(records, JSON.stringify([
      ['first', 'w1'], ['unopened', undefined], ['other-workspace', 'w2'], ['front', 'w1'],
    ].map(([id, workspaceId]) => ({ plugin: 'probe', id, workspaceId }))));

    const { page } = await open();
    const events = () => page.evaluate(() => window.tabEvents);
    const input = page.locator('.sidebar-panel:visible input');
    await untilTabs(page, ['first', 'unopened', 'front'], 'the saved labels are restored in order');
    await input.waitFor();
    assert.deepEqual(await events(), ['mount:front']);
    await until(() => JSON.parse(readFileSync(records, 'utf8')).filter(({ id }) => id === 'unopened').map(({ workspaceId }) => workspaceId).join() === 'w1');

    await page.getByRole('tab', { name: 'first', exact: true }).click();
    await input.fill('kept');
    await page.locator('.workspace[data-workspace=w2]').click();
    await untilTabs(page, ['other-workspace'], 'the second workspace has its own tab');
    await input.waitFor();
    await page.locator('.workspace[data-workspace=w1]').click();
    assert.equal(await input.inputValue(), 'kept');
    assert.deepEqual(await events(), ['mount:front', 'mount:first', 'mount:other-workspace']);

    await page.getByRole('button', { name: '关闭 unopened', exact: true }).click();
    assert.deepEqual((await events()).slice(-3), ['mount:unopened', 'close:unopened', 'dispose:unopened']);
  });
});

test('a failed selection during restore leaves the other tabs usable', { timeout: 180000 }, () => {
  const view = plugin('broken', { 'ui.js': `
export function mount() {}
export function open({ host }, { id }) {
  host.tabs({ id, title: id,
    onClose() { if (id === 'broken') throw new Error('close failed'); },
    mount(panel) {
      const child = document.createTextNode(id);
      panel.append(child);
      return {
        dispose() { panel.removeChild(child); document.body.dataset.disposedTab = id; },
        onSelect() { if (id === 'broken') throw new Error('selection failed'); },
      };
    },
  });
}
` });
  return withHome('wangcai-tab-restore-error', workspaceLists([view]), async ({ home, open }) => {
    const directory = join(home, '.local/share/wangcai/data/core');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'tabs.json'), JSON.stringify(['good', 'broken'].map((id) => ({ plugin: 'broken', id }))));

    const { page } = await open();
    const panel = page.locator('.sidebar-panel:visible');
    await panel.getByText('broken: selection failed', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'good', exact: true }).click();
    assert.equal(await panel.innerText(), 'good');
    await page.getByRole('button', { name: '关闭 broken', exact: true }).click();
    await untilTabs(page, ['good'], 'the failed tab can still dispose its content');
    assert.equal(await page.locator('body').getAttribute('data-disposed-tab'), 'broken');
  });
});

test('late restorations keep saved order while new tabs can open and save', { timeout: 180000 }, () => {
  const workspace = plugin('workspace', { 'ui.js': workspacePage, 'main.cjs': `
exports.activate = ({ ui }) => {
  let rows = ${JSON.stringify(['empty', 'w1', 'w2', 'w3', 'w4'].map(mockWorkspaceRow))};
  ui.handle('workspaces', () => rows);
  ui.handle('workspace-select', () => {});
  ui.handle('workspace-close', ({ id }) => { rows = rows.filter(row => row.id !== id); });
};
` });
  const view = plugin('probe', { 'ui.js': `
export const title = '探针';
export function mount() { window.mounts = []; }
export function open({ host }, record) {
  const id = record?.id ?? window.openId ?? 'new';
  const register = () => host.tabs({ id, title: id, workspaceId: record?.workspaceId, mount(panel) {
    window.mounts.push(id);
    const input = document.createElement('input');
    panel.append(input);
    return {
      dispose() {},
      onSelect() { if (id === 'first-in-workspace') input.focus(); },
    };
  } });
  if (id === 'waiting') return new Promise(resolve => {
    window.finishRestore = () => { register(); resolve(); };
  });
  if (record && id !== 'front') { (window.restoreTab ??= {})[id] = register; return; }
  register();
}
` });
  return withHome('wangcai-late-tabs', { workspaces: [workspace], tabs: [view] }, async ({ home, open }) => {
    const directory = join(home, '.local/share/wangcai/data/core');
    mkdirSync(directory, { recursive: true });
    const records = join(directory, 'tabs.json');
    writeFileSync(records, JSON.stringify([
      ['waiting', 'w1'], ['late', 'w1'], ['front', 'w1'], ['removed', 'w2'], ['first-in-workspace', 'w3'], ['while-hidden', 'w4'],
    ].map(([id, workspaceId]) => ({ plugin: 'probe', id, workspaceId }))));

    const { page } = await open();
    const sidebar = page.locator('.sidebar-right');
    await page.locator('.sidebar-tab').first().waitFor({ state: 'attached' });
    assert.equal(await sidebar.isVisible(), true);
    assert.equal(await viewTabs(page).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.mounts), []);

    await page.locator('.workspace[data-workspace=w1]').click();
    await untilTabs(page, ['front'], 'a plugin awaiting a reply does not hold up the visible tab');
    await page.locator('.workspace[data-workspace=w2]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '关闭工作区', exact: true }).click();
    await until(() => !JSON.parse(readFileSync(records, 'utf8')).some(({ id }) => id === 'removed'));
    await openView(page, '探针');
    const input = page.locator('.sidebar-panel:visible input');
    await until(() => JSON.parse(readFileSync(records, 'utf8')).some(({ id }) => id === 'new'));
    await page.evaluate(() => { window.openId = 'late'; });
    await openView(page, '探针');
    await untilTabs(page, ['late', 'front', 'new'], 'an explicit open can claim a tab whose restore is pending');
    await input.fill('kept');
    assert.deepEqual(await page.evaluate(() => window.mounts), ['front', 'new', 'late']);

    await page.evaluate(() => { window.restoreTab.late(); window.restoreTab.removed(); window.finishRestore(); });
    await untilTabs(page, ['waiting', 'late', 'front', 'new'], 'late headers go into their saved places');
    assert.equal(await page.locator('.sidebar-tab').count(), 4);
    assert.deepEqual(await page.evaluate(() => window.mounts), ['front', 'new', 'late']);
    assert.equal(await input.inputValue(), 'kept');
    assert.equal(await input.evaluate((element) => document.activeElement === element), true);

    await page.locator('.workspace[data-workspace=w3]').click();
    const mainInput = page.locator('.desktop-main [data-plugin=workspace] input');
    await mainInput.fill('still typing');
    await mainInput.evaluate((element) => element.addEventListener('blur', () => { element.dataset.blurred = ''; }, { once: true }));
    await page.evaluate(() => window.restoreTab['first-in-workspace']());
    await untilTabs(page, ['first-in-workspace'], 'the first delayed tab becomes visible in its workspace');
    assert.equal(await mainInput.evaluate((element) => document.activeElement === element), true);
    assert.equal(await mainInput.getAttribute('data-blurred'), null);

    await page.locator('.workspace[data-workspace=w4]').click();
    const toggle = page.getByRole('button', { name: '切换右侧栏' });
    await toggle.click();
    await page.evaluate(() => window.restoreTab['while-hidden']());
    assert.equal(await sidebar.isVisible(), false);
    const mounts = ['front', 'new', 'late', 'first-in-workspace'];
    assert.deepEqual(await page.evaluate(() => window.mounts), mounts);
    await toggle.click();
    await untilTabs(page, ['while-hidden'], 'opening the sidebar reveals the delayed tab');
    assert.deepEqual(await page.evaluate(() => window.mounts), [...mounts, 'while-hidden']);
  });
});
