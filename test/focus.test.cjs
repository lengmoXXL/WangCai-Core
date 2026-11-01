const { test } = require('node:test');
const assert = require('node:assert/strict');
const { closeView, openView, viewTabs, withHome } = require('@lengmoxxl/wangcai-testkit');
const { fieldPanel, inFront, keysIn, mockWorkspace, mockWorkspaceRow, viewPlugin, watch, workspacePage } = require('./core-ui.cjs');

test('a switch hands the keys to the field of the page it switches to', { timeout: 180000 }, () => {
  const lists = {
    workspaces: [
      mockWorkspace({ rows: [mockWorkspaceRow('w1')], ui: workspacePage }),
      mockWorkspace({ id: 'other', rows: [mockWorkspaceRow('w2')], ui: workspacePage }),
    ],
    tabs: [viewPlugin('one', '第一', { draw: fieldPanel }), viewPlugin('two', '第二', { draw: fieldPanel })],
  };
  return withHome('wangcai-focus-keys', lists, async ({ open }) => {
    const { page } = await open();
    const errors = watch(page);
    await inFront(page, 'w2');
    // Clicking `w1` is a switch to the other provider: the pane in the middle comes to its page, whose field takes the
    // keys.
    await page.locator('.workspace[data-workspace="w1"]').click();
    await keysIn(page, 'workspace');
    await openView(page, '第一');
    await keysIn(page, 'one');
    await openView(page, '第二');
    await keysIn(page, 'two');
    // Switching back by its tab is a switch too.
    await viewTabs(page).filter({ has: page.getByRole('tab', { name: '第一', exact: true }) }).getByRole('tab').click();
    await keysIn(page, 'one');
    // Hiding the sidebar leaves the keys to the pane beside it, and showing it again hands them to the tab in front.
    await page.getByRole('button', { name: '切换右侧栏' }).click();
    await page.locator('.sidebar-right').waitFor({ state: 'hidden' });
    await keysIn(page, 'workspace');
    await page.getByRole('button', { name: '切换右侧栏' }).click();
    await keysIn(page, 'one');
    // A tab that closes hands them to the tab beside it, and the last one hands them back to the main pane.
    await closeView(page);
    await keysIn(page, 'two');
    await closeView(page);
    await keysIn(page, 'workspace');
    assert.deepEqual(errors, []);
  });
});

test('a sidebar toggled with no tab in it leaves the keys to the pane beside it', { timeout: 180000 }, () => {
  const lists = {
    workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1')], ui: workspacePage })],
    tabs: [],
  };
  return withHome('wangcai-focus-empty-sidebar', lists, async ({ open }) => {
    const { page } = await open();
    const errors = watch(page);
    await inFront(page, 'w1');
    const toggle = page.getByRole('button', { name: '切换右侧栏' });
    // Showing an empty sidebar and hiding it again both hand the keys to the page in the main pane.
    await toggle.click();
    await keysIn(page, 'workspace');
    await toggle.click();
    await keysIn(page, 'workspace');
    assert.deepEqual(errors, []);
  });
});
