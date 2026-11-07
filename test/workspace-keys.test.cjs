const { test } = require('node:test');
const assert = require('node:assert/strict');
const { until, withWindow } = require('@lengmoxxl/wangcai-testkit');
const { fieldPanel, inFront, keysIn, makeGroup, mockWorkspace, mockWorkspaceRow, openView, press, rowIds, untilReading, viewPlugin, workspacePage } = require('./core-ui.cjs');

// Waits until the keys are somewhere in the workspace list.
const keysInList = (page) => until(async () => page.evaluate(() => document.activeElement?.closest('.workspaces') !== null));

// Waits until the cursor — the focus in the list — stands on this workspace.
const cursorOn = (page, id) => until(async () => page.evaluate((want) => document.activeElement?.dataset?.workspace === want, id));
// What the cursor is drawn with. The ring says where the keys are, whether or not the browser counts the press as a
// keyboard one.
const cursorOutline = (page) => page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);

test('Ctrl+h puts the keys in the workspace list and Ctrl+l hands them back', { timeout: 180000 }, () => withWindow('wangcai-focus-run', {
  workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1'), mockWorkspaceRow('w2')] })],
  tabs: [viewPlugin('terminal', '终端', { draw: fieldPanel })],
}, async ({ page, errors }) => {
  await inFront(page, 'w1');
  await openView(page, '终端');
  await keysIn(page, 'terminal');
  // The list takes the keys from a terminal, and the terminal takes them back.
  await press(page, 'Control+h');
  await keysInList(page);
  assert.equal(await cursorOutline(page), 'solid', 'the row the keys land on is drawn as the cursor');
  await inFront(page, 'w1');
  await press(page, 'Control+l');
  await keysIn(page, 'terminal');
  // A letter is the terminal's again: the list's own keys do not reach there.
  await page.keyboard.type('j');
  assert.equal(await page.locator('[data-plugin="terminal"] input').inputValue(), 'j', 'the list leaves the keys outside it alone');
  assert.deepEqual(errors, []);
}));

test('j and k move the cursor, and only l switches to the workspace', { timeout: 180000 }, () => withWindow('wangcai-workspace-keys', {
  workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1'), mockWorkspaceRow('w2')], ui: workspacePage })],
  tabs: [],
}, async ({ page, errors }) => {
  await inFront(page, 'w1');
  await press(page, 'Control+h');
  await keysInList(page);
  await cursorOn(page, 'w1');
  // j moves the cursor down, and the workspace in front does not move with it.
  await press(page, 'j');
  await cursorOn(page, 'w2');
  await inFront(page, 'w1');
  // k brings it back, and the top of the list holds it there.
  await press(page, 'k');
  await cursorOn(page, 'w1');
  await press(page, 'k');
  await cursorOn(page, 'w1');
  // l is the switch: the workspace comes forward and its page takes the keys.
  await press(page, 'j');
  await cursorOn(page, 'w2');
  await press(page, 'l');
  await inFront(page, 'w2');
  await keysIn(page, 'workspace');
  assert.deepEqual(errors, []);
}));

test('h folds the group under the cursor, and l on its bar opens it', { timeout: 180000 }, () => withWindow('wangcai-workspace-fold', {
  workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1'), mockWorkspaceRow('w2')], ui: workspacePage })],
  tabs: [],
}, async ({ page, errors }) => {
  await inFront(page, 'w1');
  // A group is made, and the first row is filed into it.
  await makeGroup(page, '一组');
  const menu = page.locator('#workspace-row-menu');
  await page.getByRole('tablist', { name: '工作区' }).getByRole('tab').first().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '移入 一组', exact: true }).click();
  await untilReading(() => rowIds(page.locator('.workspace-group .workspace')), ['w1'], 'the row is drawn under the group');
  await press(page, 'Control+h');
  await keysInList(page);
  await cursorOn(page, 'w1');
  // h folds the group the cursor is in, and the cursor goes to its bar, which is where the row went.
  const bar = page.getByRole('button', { name: '分组 一组' });
  await page.keyboard.press('h');
  await until(async () => (await bar.getAttribute('aria-expanded')) === 'false');
  assert.ok(await page.locator('.workspace-group-rows').isHidden(), 'the folded group hides its rows');
  await until(async () => page.evaluate(() => document.activeElement?.classList.contains('workspace-group-bar') === true));
  // l on the bar opens the rows, and does not switch: the workspace in front is left alone.
  await page.keyboard.press('l');
  await until(async () => (await bar.getAttribute('aria-expanded')) === 'true');
  assert.ok(await page.locator('.workspace-group-rows').isVisible(), 'the open group draws its rows');
  await inFront(page, 'w1');
  // The cursor steps into the rows the bar opened, and l switches from there.
  await page.keyboard.press('j');
  await cursorOn(page, 'w1');
  await inFront(page, 'w1');
  await page.keyboard.press('l');
  await keysIn(page, 'workspace');
  assert.deepEqual(errors, []);
}));

test('l takes the keys to the workspace page, not to the tab in front of the sidebar', { timeout: 180000 }, () => withWindow('wangcai-workspace-enter', {
  workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1'), mockWorkspaceRow('w2')], ui: workspacePage })],
  tabs: [viewPlugin('terminal', '终端', { draw: fieldPanel })],
}, async ({ page, errors }) => {
  await inFront(page, 'w1');
  await openView(page, '终端');
  await keysIn(page, 'terminal');
  // From the tab in front, Ctrl+h reaches the list, and l enters the workspace under the cursor.
  await press(page, 'Control+h');
  await keysInList(page);
  await press(page, 'j');
  await cursorOn(page, 'w2');
  await press(page, 'l');
  await inFront(page, 'w2');
  await keysIn(page, 'workspace');
  assert.deepEqual(errors, []);
}));
