const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openView, until, viewTabs, withHome } = require('@lengmoxxl/wangcai-testkit');
const { untilTabs, viewPlugin, watch, workspaceLists, workspaces } = require('./core-ui.cjs');

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
