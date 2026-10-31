const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { openWorkspaceMenu, until, viewTabs, withHome } = require('@lengmoxxl/wangcai-testkit');

// The plugins a case launches are mocks: the real ones live in repositories of their own. They are written under one
// directory per run, which this process removes when it ends.
let fixtures;
const plugin = (id, files, keys) => {
  fixtures ??= mkdtempSync(join(tmpdir(), 'wangcai-mock-'));
  const directory = join(fixtures, id);
  mkdirSync(directory, { recursive: true });
  // Core loads a plugin from its main.cjs, so one that only draws a view activates nothing; the keys a case gives it
  // are declared there beside `activate`.
  const main = `${files['main.cjs'] ?? 'exports.activate = () => {};\n'}${keys ? `exports.keys = ${JSON.stringify(keys)};\n` : ''}`;
  for (const [name, text] of Object.entries({ ...files, 'main.cjs': main })) writeFileSync(join(directory, name), text);
  return { id, directory };
};
process.once('exit', () => { if (fixtures) rmSync(fixtures, { recursive: true, force: true }); });

// A sidebar view that draws nothing: a case opens it to give the tab strip something to order.
const viewPlugin = (id, title, keys) => plugin(id, {
  'ui.js': `export const title = ${JSON.stringify(title)};
export function mount() {}
export function open(context) { context.host.tabs({ id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, mount: () => ({ dispose: () => {} }) }); }
`,
}, keys);

// The row a mock provider serves a workspace as; a case that seeds one gives its id, and the create path supplies the id.
const mockWorkspaceRow = (id = '') => ({ id, label: '~', machine: 'local', running: true });

// A workspace provider with no agent behind it: it serves the rows it is given and those the window makes, and a drop
// asks it for a place among them, which is the whole of what Core's sidebar reads from a provider.
const mockWorkspace = ({ id = 'workspace', rows = [], keys } = {}) => plugin(id, { 'main.cjs': `exports.activate = ({ ui }) => {
  const rows = ${JSON.stringify(rows)};
  const template = ${JSON.stringify(mockWorkspaceRow())};
  ui.handle('workspaces', () => rows);
  ui.handle('workspace-menu', () => [{ key: 'local', label: '本机' }]);
  // Core selects a row after it creates one and after a refresh, so this answers those calls where a mock has nothing to
  // select: a missing method only leaves an 'Unknown plugin method' on the console.
  ui.handle('workspace-select', () => undefined);
  ui.handle('workspace-create', () => {
    const row = { ...template, id: \`w\${rows.length + 1}\` };
    rows.push(row);
    return { id: row.id };
  });
  ui.handle('workspace-move', ({ id, before }) => {
    const at = rows.findIndex((row) => row.id === id);
    if (at < 0) return;
    const [row] = rows.splice(at, 1);
    const target = rows.findIndex((item) => item.id === before);
    if (target < 0) rows.push(row);
    else rows.splice(target, 0, row);
  });
};
` }, keys);

// What init.ts lists for a case: the mock provider, and the views a case opens beside it.
const workspaceLists = (tabs = []) => ({ workspaces: [mockWorkspace()], tabs });

// The rows a case orders: it opens as many workspaces as it needs, and waits until the list draws each row.
const workspaces = async (page, count) => {
  for (let opened = 0; opened < count; opened += 1) {
    await openWorkspaceMenu(page);
    await page.locator('#workspace-row-menu').getByRole('menuitem', { name: '新建 本机', exact: true }).click();
    await page.getByRole('tablist', { name: '工作区' }).getByRole('tab').last().waitFor();
  }
};

// Makes a group from the row menu, and names it in the dialog the group is made with.
const makeGroup = async (page, name) => {
  await openWorkspaceMenu(page);
  await page.locator('#workspace-row-menu').getByRole('menuitem', { name: '新建分组', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重命名分组' });
  const input = dialog.getByRole('textbox');
  await input.fill(name);
  await input.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
};

// The order the list draws, a group by the name on its bar and a row as 'row'.
const drawnOrder = (page) => page.locator('.workspaces').locator(':scope > :not(.workspace-line)').evaluateAll((nodes) => nodes.map((node) => node.classList.contains('workspace-group') ? node.querySelector('.workspace-group-bar .name').textContent : 'row'));

const press = async (page, ...keys) => { for (const key of keys) await page.keyboard.press(key); };

// The names on the sidebar tabs, in the order they are drawn.
const tabNames = (page) => viewTabs(page).locator('[role=tab]').allTextContents();

// Waits until a reading gives this. A click or a drop reaches the list and the record on disk through a round trip that
// the window's own drawing does not wait for, so the reading is repeated rather than the action; a reading that throws
// is repeated too, since a record being written is missing or half written for a moment. The kit's until fails with its
// own words, so a reading that never arrives is adjudicated here, with the case's message and what was read.
const untilReading = async (read, want, message) => {
  let got;
  const holds = async () => {
    try { return (got = (await read()).join()) === want.join(); } catch { return false; }
  };
  await until(holds).catch(() => {});
  assert.equal(got, want.join(), message);
};

// What the window reports while it runs: an exception the page throws, and anything it logs as an error. A mock that
// answers one method too few reaches the case as `Unknown plugin method` on the console and nowhere else, so a case that
// opens a window more than once collects into one list here and judges it at the end.
const watch = (page, errors = []) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
};

// The names on the group bars, in the order they are drawn.
const groupNames = (page) => page.locator('.workspace-group-bar').allTextContents();

// Where the window keeps the groups of this home.
const groupsFile = (home) => join(home, '.local/share/wangcai/data/core/groups.json');

// A window on the groups a case starts with, as a window that closed would have left them: they are read when the list
// is built, so they go to the file before the window starts, and the rows are made after it.
const withGroupRecords = (name, groups, rowCount, body) => withHome(name, workspaceLists(), async ({ home, open }) => {
  mkdirSync(dirname(groupsFile(home)), { recursive: true });
  const records = groups.map((group, at) => ({ ...group, id: `g${at + 1}`, collapsed: false, workspaces: [] }));
  writeFileSync(groupsFile(home), JSON.stringify(records));
  const { page } = await open();
  const errors = watch(page);
  await workspaces(page, rowCount);
  return body({ page, errors });
});

// The names of the groups the window has written down, in the order it reads them again on the next start.
const storedGroupNames = (home) => JSON.parse(readFileSync(groupsFile(home), 'utf8')).map((group) => group.name);

// The line under a group's bar, which is the first line the group holds.
const firstInsideLine = (group) => group.locator('.workspace-line').first();

// The line at an index among the list's children.
const lineAt = (page, index) => page.locator(`.workspaces > :nth-child(${index + 1})`);

// The line in front of a group, by index into the groups as Array.prototype.at reads it: 0 is the first, -1 the last.
const lineBeforeGroup = async (page, index) => {
  const at = await page.locator('.workspaces').evaluate((list, which) => {
    const group = [...list.children].filter((node) => node.classList.contains('workspace-group')).at(which);
    if (group === undefined) throw new Error(`no group at ${which}`);
    return [...list.children].indexOf(group) - 1;
  }, index);
  return lineAt(page, at);
};

// The line `step` places from a row among the list's children: -1 is the one in front of the row, 1 the one after it.
const lineBeside = async (page, row, step) => lineAt(page, await row.evaluate((element, step) => [...element.parentElement.children].indexOf(element) + step, step));

// Where a line is dropped on: its own one pixel, a little in from the left edge.
const onLine = { x: 40, y: 0 };

// The ids of the workspaces a locator matches, in the order it draws them.
const rowIds = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.dataset.workspace));

// The id of the first workspace a locator matches.
const rowId = (locator) => locator.first().evaluate((element) => element.dataset.workspace);

module.exports = {
  plugin, viewPlugin, mockWorkspaceRow, mockWorkspace, workspaceLists, workspaces, makeGroup, drawnOrder, press, tabNames, untilReading, watch,
  groupNames, withGroupRecords, storedGroupNames, firstInsideLine, lineAt, lineBeforeGroup, lineBeside, onLine, rowIds, rowId,
};
