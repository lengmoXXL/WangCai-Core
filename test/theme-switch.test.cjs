const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { until, withHome, withWindow } = require('@lengmoxxl/wangcai-testkit');
const { inFront, mockWorkspace, mockWorkspaceRow, press, watch } = require('./core-ui.cjs');

// What the window is painted in, read back off the tokens and the rows rather than from the payload that set them.
const painted = (page) => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const token = (name) => cs.getPropertyValue(`--wc-${name}`).trim();
  const row = document.querySelector('.workspace');
  return {
    background: token('background'), surface: token('surface'), accent: token('accent'), yellow: token('yellow'),
    scheme: document.documentElement.style.colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    rowColor: row ? getComputedStyle(row).color : '',
  };
});

const openPicker = async (page) => {
  await press(page, 'Escape', 'Control+Space', 'u', 't');
  await page.locator('.prompt-scrim:not([hidden])').waitFor();
};

const takeTheme = async (page, name) => {
  await page.locator('.prompt-list button', { hasText: name }).first().click();
  await page.locator('.prompt-scrim').waitFor({ state: 'hidden' });
};

test('the window switches theme and keeps the choice', { timeout: 240000 }, () => withWindow('wangcai-theme-switch', {
  workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1'), mockWorkspaceRow('w2')] })],
}, async ({ page, errors, home }) => {
  await inFront(page, 'w1');
  const dark = await painted(page);
  assert.equal(dark.background, '#191a1b');
  assert.equal(dark.scheme, 'dark');

  await openPicker(page);
  const names = await page.locator('.prompt-list button').allTextContents();
  assert.deepEqual(names, ['WangCai', 'GitHub'], 'only the two that ship');
  await takeTheme(page, 'GitHub');
  await until(async () => (await painted(page)).background === '#ffffff');
  const light = await painted(page);
  assert.equal(light.surface, '#f6f8fa');
  assert.equal(light.accent, '#0969da');
  assert.equal(light.scheme, 'light', 'the browser widgets follow the background');
  assert.equal(light.bodyBg, 'rgb(255, 255, 255)', 'the pane is painted white, not just the token');
  assert.notEqual(light.rowColor, dark.rowColor, 'a row styled from the tokens follows on its own');
  assert.equal(JSON.parse(readFileSync(join(home, '.local/share/wangcai/data/core/theme.json'), 'utf8')), 'GitHub');

  // The choice outlives the load.
  await page.reload();
  await inFront(page, 'w1');
  const reloaded = await painted(page);
  assert.equal(reloaded.background, '#ffffff', 'the choice was remembered');
  assert.equal(reloaded.scheme, 'light');

  await openPicker(page);
  await takeTheme(page, 'WangCai');
  await until(async () => (await painted(page)).background === '#191a1b');
  assert.equal((await painted(page)).scheme, 'dark');
  assert.deepEqual(errors, []);
}));

test('init.ts patches a built-in and adds a theme of its own', { timeout: 240000 }, () => withHome('wangcai-theme-custom', {
  workspaces: [mockWorkspace({ rows: [mockWorkspaceRow('w1')] })],
}, async ({ home, open }) => {
  const path = join(home, '.config/wangcai/init.ts');
  const written = readFileSync(path, 'utf8');
  writeFileSync(path, written.replace('export default {', `export default {
  theme: { GitHub: { accent: '#0a3069' }, Solarized: { background: '#002b36', foreground: '#839496', accent: '#268bd2' } },`));
  const { page } = await open();
  const errors = watch(page);
  await inFront(page, 'w1');

  await openPicker(page);
  const names = await page.locator('.prompt-list button').allTextContents();
  assert.deepEqual(names, ['WangCai', 'GitHub', 'Solarized'], 'the built-ins keep their order, the new one comes after');
  await takeTheme(page, 'GitHub');
  await until(async () => (await painted(page)).background === '#ffffff');
  assert.equal((await painted(page)).accent, '#0a3069', 'the patch landed on the built-in');
  assert.equal((await painted(page)).surface, '#f6f8fa', 'and left the tokens it did not name');

  await openPicker(page);
  await takeTheme(page, 'Solarized');
  await until(async () => (await painted(page)).background === '#002b36');
  const own = await painted(page);
  assert.equal(own.accent, '#268bd2');
  assert.equal(own.yellow, '#e5c07b', 'a token the new theme left out keeps the dark palette it started from');
  assert.deepEqual(errors, []);
}));
