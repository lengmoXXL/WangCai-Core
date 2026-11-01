const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openView, until, withHome } = require('@lengmoxxl/wangcai-testkit');
const { fieldPanel, inFront, keysIn, mockWorkspace, mockWorkspaceRow, press, tabNames, untilTabs, viewPlugin, watch, workspaceLists, workspacePage } = require('./core-ui.cjs');

// The provider the key in this file names: it serves `w1` and draws a page of its own, so a case can read where the keys
// went.
const provider = () => mockWorkspace({
  rows: [mockWorkspaceRow('w1')],
  keys: { '<leader>aa': { global: true, event: 'core:show-view', data: { plugin: 'workspace' } } },
  ui: workspacePage,
});

test('a plugin key opens its view, and brings the open one to the front', { timeout: 180000 }, () => withHome('wangcai-plugin-keys', workspaceLists([
  viewPlugin('git', 'Git', { keys: { '<leader>gg': { global: true, event: 'core:show-view', data: { plugin: 'git' } } } }),
  viewPlugin('files', '文件'),
]), async ({ open }) => {
  const { page } = await open();
  const errors = watch(page);
  assert.deepEqual(await tabNames(page), [], 'nothing is open before a key is pressed');
  await press(page, 'Space', 'g', 'g');
  await untilTabs(page, ['Git'], 'the key opens the view its plugin names');
  await openView(page, '文件');
  await untilTabs(page, ['Git', '文件'], 'a view opened from the menu stands beside it');
  await press(page, 'Space', 'g', 'g');
  // The view already open comes to the front.
  await until(() => page.locator('.sidebar-panel[data-plugin=git]').isVisible());
  assert.deepEqual(await tabNames(page), ['Git', '文件'], 'no tab is added');
  assert.deepEqual(errors, []);
}));

test('a workspace provider key switches to its workspace', { timeout: 180000 }, () => {
  // Two providers, each with the row it serves, so the workspace in front belongs to one of them and the key asks for the
  // other's.
  const lists = {
    workspaces: [
      mockWorkspace({ id: 'other', rows: [mockWorkspaceRow('o1')] }),
      provider(),
    ],
    tabs: [],
  };
  return withHome('wangcai-plugin-workspace-keys', lists, async ({ open }) => {
    const { page } = await open();
    const errors = watch(page);
    await inFront(page, 'o1');
    // The key names a workspace that is not in front, so pressing it switches to that one.
    await press(page, 'Space', 'a', 'a');
    await inFront(page, 'w1');
    // The page the switch came to is what takes the keys.
    await keysIn(page, 'workspace');
    assert.deepEqual(errors, []);
  });
});

test('a key naming the workspace already in front hands the tab in front the keys', { timeout: 180000 }, () => {
  const lists = {
    workspaces: [provider()],
    // A tab of the workspace in front, so its page has something in front of it.
    tabs: [viewPlugin('view', '视图', { draw: fieldPanel })],
  };
  return withHome('wangcai-plugin-workspace-in-front', lists, async ({ open }) => {
    const { page } = await open();
    const errors = watch(page);
    await inFront(page, 'w1');
    await openView(page, '视图');
    await keysIn(page, 'view');
    // A field keeps the keys typed into it.
    await page.evaluate(() => document.activeElement?.blur());
    await press(page, 'Space', 'a', 'a');
    // Nothing switches, so the tab in front of the workspace the key names takes the keys.
    await keysIn(page, 'view');
    assert.deepEqual(errors, []);
  });
});

test('a key naming the workspace in front hands the page beside the sidebar the keys while it is hidden', { timeout: 180000 }, () => {
  const lists = {
    workspaces: [provider()],
    // A tab of the workspace in front, which is the one the sidebar hides with itself.
    tabs: [viewPlugin('view', '视图', { draw: fieldPanel })],
  };
  return withHome('wangcai-plugin-workspace-hidden-sidebar', lists, async ({ open }) => {
    const { page } = await open();
    const errors = watch(page);
    await inFront(page, 'w1');
    await openView(page, '视图');
    await page.getByRole('button', { name: '切换右侧栏' }).click();
    await page.locator('.sidebar-right').waitFor({ state: 'hidden' });
    await press(page, 'Space', 'a', 'a');
    // Nothing in the sidebar is drawn, so the page in the main pane takes the keys.
    await keysIn(page, 'workspace');
    assert.deepEqual(errors, []);
  });
});

test('a tab of a workspace that is not in front does not take the keys', { timeout: 180000 }, () => {
  const lists = {
    workspaces: [provider()],
    tabs: [viewPlugin('view', '视图', { draw: fieldPanel, workspaceId: 'elsewhere' })],
  };
  return withHome('wangcai-plugin-workspace-elsewhere-tab', lists, async ({ open }) => {
    const { page } = await open();
    const errors = watch(page);
    await inFront(page, 'w1');
    await openView(page, '视图');
    await page.locator('.sidebar-panel[data-plugin=view]').waitFor({ state: 'hidden' });
    // The tab follows another workspace, so it is not drawn: the page in the main pane takes the keys.
    await press(page, 'Space', 'a', 'a');
    await keysIn(page, 'workspace');
    assert.deepEqual(errors, []);
  });
});
