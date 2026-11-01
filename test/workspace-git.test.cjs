const { test } = require('node:test');
const assert = require('node:assert/strict');
const { until, withHome } = require('@lengmoxxl/wangcai-testkit');
const { rowId, watch, workspaceLists, workspaces } = require('./core-ui.cjs');

test('a workspace row says what git makes of it', { timeout: 180000 }, () => withHome('wangcai-workspace-git', workspaceLists(), async ({ open }) => {
  const { page } = await open();
  const errors = watch(page);
  await workspaces(page, 1);
  const row = page.locator('.workspaces > .workspace').first();
  const id = await rowId(row);
  const cell = row.locator('.git');
  assert.ok(await cell.isHidden(), 'a workspace whose repository nobody reported says nothing');
  // What a provider reports arrives on the bus, so it is published the way one would.
  const publish = (git) => page.evaluate(({ id, git }) => window.wangcai.call('publish', 'workspace-git', { id, git }), { id, git });
  const waiting = { branch: 'main', ahead: 3, behind: 2, dirty: true };
  const drawn = async () => {
    await publish(waiting);
    await until(async () => (await cell.textContent()) === '↓2↑3*');
  };
  await drawn();
  assert.equal(await cell.getAttribute('title'), 'main · 2 个提交待拉取 · 3 个提交待推送 · 有未提交的修改');
  // A workspace git says is no repository hides the cell again.
  await publish(null);
  await until(() => cell.isHidden());
  await drawn();
  // So does a quiet repository.
  await publish({ branch: 'main', ahead: 0, behind: 0, dirty: false });
  await until(() => cell.isHidden());
  assert.deepEqual(errors, []);
}));
