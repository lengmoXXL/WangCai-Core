const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withHome, withWindow } = require('@lengmoxxl/wangcai-testkit');
const { drawnOrder, firstInsideLine, groupNames, lineAt, lineBeside, lineBeforeGroup, makeGroup, onLine, rowId, rowIds, storedGroupNames, untilReading, watch, withGroupRecords, workspaceLists, workspaces } = require('./core-ui.cjs');

test('a group is made, renamed, folded, moved and remembered', { timeout: 180000 }, () => withHome('wangcai-groups', workspaceLists(), async ({ home, open }) => {
  let { page, close } = await open();
  const errors = watch(page);
  await workspaces(page, 1);
  let groups = page.locator('.workspace-group');
  let bar = page.getByRole('button', { name: '分组 一组' });
  let menu = page.locator('#workspace-row-menu');
  let rows = page.locator('.workspaces > .workspace');
  const onlyRow = await rowId(rows.first());
  await makeGroup(page, '一组');
  await untilReading(() => rowIds(groups.locator('.workspace')), [], 'a fresh group holds nothing');
  // The group's twistie starts at the edge of a row's card.
  const leftOf = (locator) => locator.evaluate((element) => element.getBoundingClientRect().left);
  assert.ok(Math.abs((await leftOf(groups.locator('.chevron'))) - (await leftOf(rows.first()))) < 1, 'the group icon starts at the edge of a row');
  const angle = () => groups.locator('.chevron').evaluate((element) => {
    const matrix = getComputedStyle(element).transform;
    if (matrix === 'none') return 0;
    const [a, b] = matrix.match(/-?[\d.]+/g).map(Number);
    return Math.round(Math.atan2(b, a) * 180 / Math.PI);
  });
  assert.equal(await angle(), 0, 'an open group points down at the rows it holds');
  // Folding is the bar's own click, and the rows come back on the next one.
  await bar.click();
  assert.equal(await bar.getAttribute('aria-expanded'), 'false', 'a folded group says so');
  assert.equal(await angle(), -90, 'a folded group points right, at where they went');
  assert.ok(await groups.locator('.workspace-group-rows').isHidden(), 'and its rows are hidden');
  await bar.click();
  assert.equal(await bar.getAttribute('aria-expanded'), 'true', 'the next click opens it again');
  await makeGroup(page, '二组');
  await untilReading(() => groupNames(page), ['一组', '二组'], 'the second group is drawn under the first');
  // A group is dragged by its own bar onto the line above another group, and takes that place.
  await page.getByRole('button', { name: '分组 二组' }).dragTo(await lineBeforeGroup(page, 0), { targetPosition: onLine });
  await untilReading(() => groupNames(page), ['二组', '一组'], 'the dragged group moved to the line it was dropped on');
  await untilReading(() => storedGroupNames(home), ['二组', '一组'], 'the groups file holds the new order');
  // Dropping a group on the line in front of itself leaves the order of the groups alone.
  await page.getByRole('button', { name: '分组 二组' }).dragTo(await lineBeforeGroup(page, 0), { targetPosition: onLine });
  await untilReading(() => groupNames(page), ['二组', '一组'], 'the groups keep their order');
  await untilReading(() => storedGroupNames(home), ['二组', '一组'], 'and the file is left as it was');
  const deleteGroup = async (target) => {
    await target.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: '删除分组', exact: true }).click();
  };
  // The row to act on is the first one drawn, which is the one in the list or the one a group holds.
  const rowMenu = async (name) => {
    await page.getByRole('tablist', { name: '工作区' }).getByRole('tab').first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name, exact: true }).click();
  };
  await deleteGroup(page.getByRole('button', { name: '分组 二组' }));
  await untilReading(() => groupNames(page), ['一组'], 'the group that was deleted is gone and the other is left');
  // A row joins the group from its own menu, and leaves it the same way.
  await rowMenu('移入 一组');
  await untilReading(() => rowIds(groups.locator('.workspace')), [onlyRow], 'the row is drawn under the group');
  await untilReading(() => rowIds(rows), [], 'and no longer beside it');
  await rowMenu('移出分组');
  await untilReading(() => rowIds(groups.locator('.workspace')), [], 'the group is empty again');
  await untilReading(() => rowIds(rows), [onlyRow], 'and the row is back in the list');
  // Filing a row into a folded group unfolds it, so the row lands where the eye goes.
  await bar.click();
  assert.equal(await bar.getAttribute('aria-expanded'), 'false', 'the group is folded to begin with');
  await rowMenu('移入 一组');
  await untilReading(() => rowIds(groups.locator('.workspace')), [onlyRow], 'the row is filed into the folded group');
  assert.equal(await bar.getAttribute('aria-expanded'), 'true', 'and filing it in unfolds the group');
  // Renaming a group from its own menu keeps an empty name in the dialog and writes the new one down.
  await bar.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '重命名分组', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名分组' });
  const typed = rename.getByRole('textbox');
  assert.equal(await typed.inputValue(), '一组', 'the dialog opens on the name the group has');
  await typed.fill('');
  await typed.press('Enter');
  assert.equal(await rename.getByRole('alert').textContent(), '分组名称不能为空', 'an empty name is refused with a note');
  assert.ok(await rename.isVisible(), 'an empty name keeps the dialog open');
  await typed.fill('改名组');
  await typed.press('Enter');
  await rename.waitFor({ state: 'hidden' });
  await untilReading(() => storedGroupNames(home), ['改名组'], 'the new name is what the groups file holds');
  await close();
  ({ page, close } = await open());
  watch(page, errors);
  groups = page.locator('.workspace-group');
  bar = page.getByRole('button', { name: '分组 改名组' });
  menu = page.locator('#workspace-row-menu');
  rows = page.locator('.workspaces > .workspace');
  // A provider that restarts serves its rows afresh, so the two it served before are made again: the group keeps the
  // row it held, and the other one is beside it again.
  await workspaces(page, 2);
  await untilReading(() => rowIds(groups.locator('.workspace')), [onlyRow], 'the group is drawn with the row it holds');
  await untilReading(() => drawnOrder(page), ['row', '改名组'], 'and one row is left beside it, above the group');
  // A group that goes away gives its rows back to the list.
  await deleteGroup(bar);
  await untilReading(() => groupNames(page), [], 'the deleted group is gone');
  await untilReading(() => drawnOrder(page), ['row', 'row'], 'and both rows are back in the list');
  assert.deepEqual(errors, []);
}));

test('a group dropped on the line that closes the list comes last', { timeout: 180000 }, () => withWindow('wangcai-group-last', workspaceLists(), async ({ home, page, errors }) => {
  await workspaces(page, 3);
  await makeGroup(page, '甲');
  await makeGroup(page, '乙');
  await untilReading(() => groupNames(page), ['甲', '乙'], 'the groups stand in the order they were made');
  await page.getByRole('button', { name: '分组 甲' }).dragTo(page.locator('.workspaces > :last-child'), { targetPosition: onLine });
  await untilReading(() => groupNames(page), ['乙', '甲'], 'the dragged group ends the list');
  await untilReading(() => storedGroupNames(home), ['乙', '甲'], 'and the groups file holds that order');
  assert.deepEqual(errors, []);
}));

test('a group dropped on the line above a row stands after the groups at that place', { timeout: 180000 }, () => withWindow('wangcai-group-slot', workspaceLists(), async ({ page, errors }) => {
  await workspaces(page, 3);
  const rows = page.locator('.workspaces > .workspace');
  await makeGroup(page, '甲');
  await makeGroup(page, '乙');
  // Both groups are put in the same place, the one in front of the second row.
  await page.getByRole('button', { name: '分组 乙' }).dragTo(await lineBeside(page, rows.nth(1), -1), { targetPosition: onLine });
  await page.getByRole('button', { name: '分组 甲' }).dragTo(await lineBeside(page, rows.nth(1), -1), { targetPosition: onLine });
  await untilReading(() => drawnOrder(page), ['row', '乙', '甲', 'row', 'row'], 'the group put there last stands after the one already there');
  assert.deepEqual(errors, []);
}));

test('a row dropped on the line above a group stands in front of the groups there', { timeout: 180000 }, () => withWindow('wangcai-row-above-group', workspaceLists(), async ({ page, errors }) => {
  await workspaces(page, 2);
  const rows = page.locator('.workspaces > .workspace');
  await makeGroup(page, '甲');
  await makeGroup(page, '乙');
  for (const name of ['甲', '乙']) {
    await page.getByRole('button', { name: `分组 ${name}` }).dragTo(await lineBeside(page, rows.nth(1), -1), { targetPosition: onLine });
  }
  await untilReading(() => drawnOrder(page), ['row', '甲', '乙', 'row'], 'both groups stand between the two rows');
  await rows.nth(1).dragTo(await lineBeforeGroup(page, 0), { targetPosition: onLine });
  await untilReading(() => drawnOrder(page), ['row', 'row', '甲', '乙'], 'the dragged row stands in front of both groups');
  assert.deepEqual(errors, []);
}));

test('a row dropped on the line that closes the list stands after the groups there', { timeout: 180000 }, () => withWindow('wangcai-row-last', workspaceLists(), async ({ page, errors }) => {
  await workspaces(page, 2);
  const rows = page.locator('.workspaces > .workspace');
  await makeGroup(page, '甲');
  await makeGroup(page, '乙');
  await untilReading(() => drawnOrder(page), ['row', 'row', '甲', '乙'], 'both groups stand after both rows, in the order they were made');
  await rows.nth(1).dragTo(page.locator('.workspaces > :last-child'), { targetPosition: onLine });
  await untilReading(() => drawnOrder(page), ['row', '甲', '乙', 'row'], 'the dragged row stands after both groups');
  assert.deepEqual(errors, []);
}));

test('a row dropped in front of a group leaves the groups recorded elsewhere where they are', { timeout: 180000 }, () => withGroupRecords('wangcai-group-record-order', [
  // 甲 is recorded before 乙 and drawn after it: only a list that reads the records in the file order would drag 乙 to
  // the place of the drop, so the two orders are made to disagree here.
  { name: '甲', after: 2 },
  { name: '乙', after: 0 },
], 3, async ({ page, errors }) => {
  await untilReading(() => drawnOrder(page), ['乙', 'row', 'row', '甲', 'row'], 'each group stands where its record places it');
  await page.locator('.workspaces > .workspace').nth(2).dragTo(await lineBeforeGroup(page, 1), { targetPosition: onLine });
  await untilReading(() => drawnOrder(page), ['乙', 'row', 'row', 'row', '甲'], 'the row takes that place, and 乙 is left at the front');
  assert.deepEqual(errors, []);
}));

test('workspaces are dragged onto the lines of the list', { timeout: 180000 }, () => withWindow('wangcai-row-lines', workspaceLists(), async ({ page, errors }) => {
  await workspaces(page, 3);
  const rows = page.locator('.workspaces > .workspace');
  const groups = page.locator('.workspace-group');
  const kept = await rowIds(rows);
  // A row dropped on the line under itself keeps its place.
  await rows.first().dragTo(await lineBeside(page, rows.first(), 1), { targetPosition: onLine });
  await makeGroup(page, '甲');
  const first = groups.first();
  // A row dropped on the line under a group's bar joins it.
  await rows.first().dragTo(firstInsideLine(first), { targetPosition: onLine });
  await untilReading(() => rowIds(first.locator('.workspace')), [kept[0]], 'the row is drawn under the group');
  await untilReading(() => rowIds(rows), kept.slice(1), 'and left the list');
  // A second row filed the same way becomes the group's first row.
  await rows.first().dragTo(firstInsideLine(first), { targetPosition: onLine });
  await untilReading(() => rowIds(first.locator('.workspace')), [kept[1], kept[0]], 'both rows are drawn under the group, the later one first');
  await first.locator('.workspace').last().dragTo(firstInsideLine(first), { targetPosition: onLine });
  await untilReading(() => rowIds(first.locator('.workspace')), [kept[0], kept[1]], 'the row moved above the one it was dropped on');
  // The line that closes the list takes a row back out of its group.
  const out = await rowId(first.locator('.workspace'));
  await first.locator('.workspace').first().dragTo(page.locator('.workspaces > :last-child'), { targetPosition: onLine });
  await untilReading(() => rowIds(rows), [kept[2], out], 'the row left its group and stands at the end of the list');
  await untilReading(() => rowIds(first.locator('.workspace')), [kept[1]], 'the group holds the row that stayed');
  // The line at the top stands a row above every group.
  const up = await rowId(first.locator('.workspace'));
  await first.locator('.workspace').first().dragTo(lineAt(page, 0), { targetPosition: onLine });
  await untilReading(() => rowIds(rows), [up, kept[2], out], 'the row took the top of the list');
  await untilReading(() => rowIds(first.locator('.workspace')), [], 'and left the group empty');
  await untilReading(() => drawnOrder(page), ['row', '甲', 'row', 'row'], 'with the group drawn under the row that went above it');
  assert.deepEqual(errors, []);
}));

test('a workspace dropped on a line between two groups keeps that place, and one moved onto another group joins it', { timeout: 180000 }, () => withWindow('wangcai-row-between', workspaceLists(), async ({ page, errors }) => {
  await workspaces(page, 3);
  const rows = page.locator('.workspaces > .workspace');
  const groups = page.locator('.workspace-group');
  const order = await rowIds(rows);
  await makeGroup(page, '甲');
  await makeGroup(page, '乙');
  const first = groups.first();
  // The first group takes two rows, and one row is left beside the two empty groups.
  await rows.first().dragTo(firstInsideLine(first), { targetPosition: onLine });
  await rows.first().dragTo(firstInsideLine(first), { targetPosition: onLine });
  await untilReading(() => rowIds(first.locator('.workspace')), [order[1], order[0]], 'both rows are drawn under the first group');
  await untilReading(() => rowIds(rows), [order[2]], 'one row is left beside the groups');
  await untilReading(() => drawnOrder(page), ['row', '甲', '乙'], 'the row is drawn above both groups');
  // Dropping that row on the line between the two groups puts it between them.
  await rows.first().dragTo(await lineBeforeGroup(page, -1), { targetPosition: onLine });
  await untilReading(() => drawnOrder(page), ['甲', 'row', '乙'], 'the row stands between the two groups');
  await untilReading(() => rowIds(rows), [order[2]], 'and it is the row that was dragged');
  // A row dragged from one group onto the line of another group joins that group.
  const second = groups.last();
  const fromFirst = order[1];
  await first.locator('.workspace').first().dragTo(firstInsideLine(second), { targetPosition: onLine });
  await untilReading(() => rowIds(first.locator('.workspace')), [order[0]], 'the group kept the row that stayed');
  await untilReading(() => rowIds(second.locator('.workspace')), [fromFirst], 'and joined the group it was dropped on');
  assert.deepEqual(errors, []);
}));

test('a row dragged to the top of the list stands above every group', { timeout: 180000 }, () => withHome('wangcai-row-first', workspaceLists(), async ({ open }) => {
  let { page, close } = await open();
  const errors = watch(page);
  await workspaces(page, 4);
  const rows = page.locator('.workspaces > .workspace');
  const menu = page.locator('#workspace-row-menu');
  // One row per group, so three groups are drawn with a row of their own and one row is left beside them.
  for (const name of ['甲', '乙', '丙']) {
    await makeGroup(page, name);
    await rows.first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name: `移入 ${name}`, exact: true }).click();
  }
  await untilReading(() => drawnOrder(page), ['row', '甲', '乙', '丙'], 'the row left beside them is drawn above the groups');
  // Each group is dragged onto the line at the top, which is the place above the row.
  for (const name of ['甲', '乙', '丙']) {
    await page.getByRole('button', { name: `分组 ${name}` }).dragTo(lineAt(page, 0), { targetPosition: onLine });
  }
  await untilReading(() => drawnOrder(page), ['丙', '乙', '甲', 'row'], 'the three groups came above the row, the last one dropped in front');
  // Dragging that row back to the top puts it in front of all three groups.
  const loose = await rowId(rows);
  await rows.first().dragTo(lineAt(page, 0), { targetPosition: onLine });
  await untilReading(() => drawnOrder(page), ['row', '丙', '乙', '甲'], 'the row took the top of the list, above every group');
  await untilReading(() => rowIds(rows), [loose], 'and it is the row that was dragged');
  // What the window draws is what it reads again on its next start.
  await close();
  ({ page, close } = await open());
  watch(page, errors);
  // The provider restarts with no rows of its own, so the four are made again: the groups keep the ones they hold.
  await workspaces(page, 4);
  await untilReading(() => drawnOrder(page), ['row', '丙', '乙', '甲'], 'a window opened again draws the row in front of the groups');
  assert.deepEqual(errors, []);
}));

test('a row dropped on a line under two groups recorded at one place stands after both', { timeout: 180000 }, () => withGroupRecords('wangcai-group-same-place', [
  { name: '甲', after: 3 },
  { name: '乙', after: 3 },
], 3, async ({ page, errors }) => {
  await untilReading(() => drawnOrder(page), ['row', 'row', 'row', '甲', '乙'], 'both groups stand after every row, in the order they were made');
  await page.locator('.workspaces > .workspace').nth(2).dragTo(page.locator('.workspaces > :last-child'), { targetPosition: onLine });
  await untilReading(() => drawnOrder(page), ['row', 'row', '甲', '乙', 'row'], 'the row stands after both groups');
  assert.deepEqual(errors, []);
}));

test('a group recorded past the end of the list is drawn at its end', { timeout: 180000 }, () => withGroupRecords('wangcai-group-clamped', [
  // The list can be shorter than the record says, so a place no row reaches is still a record a window may hold.
  { name: '远', after: 9 },
], 3, async ({ page, errors }) => {
  await untilReading(() => drawnOrder(page), ['row', 'row', 'row', '远'], 'the group stands after every row');
  assert.deepEqual(errors, []);
}));
