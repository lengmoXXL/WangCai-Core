const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openView, until, withHome } = require('@lengmoxxl/wangcai-testkit');
const { mockWorkspace, mockWorkspaceRow, press, tabNames, untilTabs, viewPlugin, watch, workspaceLists } = require('./core-ui.cjs');

test('a plugin key opens its view, and brings the open one to the front', { timeout: 180000 }, () => withHome('wangcai-plugin-keys', workspaceLists([
  viewPlugin('git', 'Git', { '<leader>gg': { global: true, event: 'core:show-view', data: { plugin: 'git' } } }),
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
      mockWorkspace({ rows: [mockWorkspaceRow('w1')], keys: { '<leader>aa': { global: true, event: 'core:show-view', data: { plugin: 'workspace' } } } }),
    ],
    tabs: [],
  };
  return withHome('wangcai-plugin-workspace-keys', lists, async ({ open }) => {
    const { page } = await open();
    const errors = watch(page);
    const inFront = (id) => page.locator(`.workspace[aria-selected=true][data-workspace=${id}]`).waitFor();
    await inFront('o1');
    await press(page, 'Space', 'a', 'a');
    await inFront('w1');
    assert.deepEqual(errors, []);
  });
});
