const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { until, withHome } = require('@lengmoxxl/wangcai-testkit');
const { mockWorkspace, mockWorkspaceRow, plugin, press, watch } = require('./core-ui.cjs');

// The event a command says its result on, which is what the probe draws.
const probeEvent = 'commands-probe';
const probe = plugin('probe', { 'ui.js': `export function mount(container, context) {
  context.global.subscribe('${probeEvent}', (data) => { container.textContent = String(data); });
}
` });

// A provider that reports the machine of the workspace it serves, which is what a command's `machine()` reads.
const provider = mockWorkspace({
  rows: [{ ...mockWorkspaceRow('w1'), machine: '远程' }],
  active: { machine: { id: 'm1', name: '远程', host: 'dev.example' }, sessionId: 's1', workspaceId: 'w1', name: '~' },
});

// init.ts as these cases write it: a key per command, each asking for what it runs with and saying what came back.
const writeInit = (home, workspaces = []) => writeFileSync(join(home, '.config/wangcai/init.ts'), `export default {
  workspaces: [${workspaces.map((entry) => JSON.stringify({ id: entry.id, directory: entry.directory })).join(', ')}],
  tabs: [${JSON.stringify({ id: probe.id, directory: probe.directory })}],
  keys: {
    '<leader>ei': { command: 'echo', desc: '回显', global: true },
    '<leader>ep': { command: 'choose', desc: '选一个', global: true },
    '<leader>em': { command: 'where', desc: '当前机器', global: true },
  },
  commands: {
    echo: async ({ input, exec, publish }) => {
      const text = await input({ title: '回显什么', value: '默认' });
      if (text === undefined) { await publish('${probeEvent}', 'cancelled'); return; }
      const { code, stdout } = await exec(undefined, 'echo', [text]);
      await publish('${probeEvent}', code + ':' + stdout.trim());
    },
    choose: async ({ pick, exec, publish }) => {
      const item = await pick({ title: '选一个', items: ['alpha', 'beta', 'gamma'] });
      if (item === undefined) { await publish('${probeEvent}', 'cancelled'); return; }
      const { code, stdout } = await exec(undefined, 'echo', [item], { cwd: '/' });
      await publish('${probeEvent}', code + ':' + stdout.trim());
    },
    where: async ({ machine, publish }) => { await publish('${probeEvent}', machine()?.host ?? 'none'); },
  },
};
`);

// A window on that init.ts, with what a command said and the errors it is watched for.
const withCommands = (prefix, body, workspaces = []) => withHome(prefix, {}, async ({ home, open }) => {
  writeInit(home, workspaces);
  const { page } = await open();
  const errors = watch(page);
  const echo = page.locator(`[data-plugin="${probe.id}"]`);
  await echo.waitFor({ state: 'attached' });
  const said = (want) => until(async () => (await echo.textContent()) === want);
  return body({ page, errors, said });
});

test('a key asks with a field and runs what was typed on this machine', { timeout: 180000 }, () => withCommands('wangcai-key-input', async ({ page, errors, said }) => {
  await press(page, 'Control+Space', 'e', 'i');
  const dialog = page.getByRole('dialog', { name: '回显什么' });
  const field = dialog.getByRole('textbox');
  await field.waitFor();
  assert.equal(await field.inputValue(), '默认', 'the field opens on the value the ask gave');
  await field.fill('你好');
  await field.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await said('0:你好');
  assert.deepEqual(errors, []);
}));

test('a key asks with a list, and typing takes the item it leaves', { timeout: 180000 }, () => withCommands('wangcai-key-pick', async ({ page, errors, said }) => {
  await press(page, 'Control+Space', 'e', 'p');
  const dialog = page.getByRole('dialog', { name: '选一个' });
  const field = dialog.getByRole('textbox');
  await field.waitFor();
  assert.deepEqual(await dialog.getByRole('option').allTextContents(), ['alpha', 'beta', 'gamma']);
  await field.pressSequentially('bet');
  assert.deepEqual(await dialog.getByRole('option').allTextContents(), ['beta'], 'what is typed filters the list');
  await field.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await said('0:beta');
  assert.deepEqual(errors, []);
}));

test('the arrows move the list a key asks with, and Enter takes the one moved to', { timeout: 180000 }, () => withCommands('wangcai-key-arrows', async ({ page, errors, said }) => {
  await press(page, 'Control+Space', 'e', 'p');
  const dialog = page.getByRole('dialog', { name: '选一个' });
  const field = dialog.getByRole('textbox');
  await field.waitFor();
  await field.press('ArrowDown');
  assert.equal(await dialog.getByRole('option', { name: 'beta' }).getAttribute('aria-selected'), 'true');
  await field.press('Enter');
  await said('0:beta');
  assert.deepEqual(errors, []);
}));

test('an ask dismissed with Escape leaves the command nothing', { timeout: 180000 }, () => withCommands('wangcai-key-dismiss', async ({ page, errors, said }) => {
  await press(page, 'Control+Space', 'e', 'i');
  const dialog = page.getByRole('dialog', { name: '回显什么' });
  const field = dialog.getByRole('textbox');
  await field.waitFor();
  await field.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await said('cancelled');
  assert.deepEqual(errors, []);
}));

test('a command reads the machine of the workspace in front', { timeout: 180000 }, () => withCommands('wangcai-key-machine', async ({ page, errors, said }) => {
  await page.locator('.workspace[data-workspace="w1"]').waitFor();
  await press(page, 'Control+Space', 'e', 'm');
  await said('dev.example');
  assert.deepEqual(errors, []);
}, [provider]));