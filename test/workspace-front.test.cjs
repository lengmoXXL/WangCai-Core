const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withWindow } = require('@lengmoxxl/wangcai-testkit');
const { inFront, mockWorkspace, mockWorkspaceRow } = require('./core-ui.cjs');

// What a provider reports when a workspace comes to the front: a command opens one, or a plugin switches, without the
// list being clicked at all.
const report = (page, id) => page.evaluate((workspaceId) => window.wangcai.call('publish', 'workspace:active', {
  machine: { id: 'local', name: '本机', host: 'local' }, sessionId: 's1', workspaceId, name: '~',
}), id);

test('the row in front is the one the provider reports, not the one last clicked', { timeout: 180000 }, () => withWindow('wangcai-front-report', {
  workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1'), mockWorkspaceRow('w2')] })],
  tabs: [],
}, async ({ page, errors }) => {
  await inFront(page, 'w1');
  await report(page, 'w2');
  await inFront(page, 'w2');
  // A click still chooses, and the report that answers it names the row already in front.
  await page.locator('.workspace[data-workspace="w1"]').click();
  await inFront(page, 'w1');
  await report(page, 'w1');
  await inFront(page, 'w1');
  assert.deepEqual(errors, []);
}));

test('a workspace opened outside the list comes to the front', { timeout: 180000 }, () => withWindow('wangcai-front-opened', {
  workspaces: [mockWorkspace()],
  tabs: [],
}, async ({ page, errors }) => {
  const created = await page.evaluate(async () => window.wangcai.call('request', 'workspace', 'workspace-create', { key: 'local' }));
  // The rows are asked for again and the front is reported right behind it, so the report can arrive before the rows.
  await page.evaluate(() => window.wangcai.call('publish', 'workspaces', null));
  await report(page, created.id);
  await inFront(page, created.id);
  assert.deepEqual(errors, []);
}));
