const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { test } = require('node:test');
const { join } = require('node:path');
const { openView, until, withHome, withWindow } = require('@lengmoxxl/wangcai-testkit');
const { plugin, press, untilTabs, viewPlugin, watch, workspaceLists } = require('./core-ui.cjs');

// The event a keymap binding publishes, which is what a view here says out.
const probeEvent = 'keys-probe';
// The file a plugin's view is written in, which is where `mount` is looked for.
const uiFile = 'ui.js';

// A view that says what a keymap binding published: the probe draws nothing else, so its text shows what the binding
// did.
const probeUi = `export function mount(container, context) {
  context.global.subscribe('${probeEvent}', (data) => { container.textContent = String(data); });
}
`;
const probe = plugin('keys', { [uiFile]: probeUi });

const pluginText = '插件';
// The sequence the provided plugin binds for itself, in its own layer and in init.ts, so both are kept equal here.
const providedSequence = '<leader>t';
// A plugin that arrives with a key of its own.
const provided = plugin('provided', { [uiFile]: probeUi }, {
  [providedSequence]: { event: probeEvent, data: pluginText, desc: '插件自己的键' },
});

// The timeout init.ts is given, so a case can wait past it and know a prefix has run out.
const TIMEOUT = 1000;

// init.ts as these cases write it: a fixed leader and that timeout, the plugins a case gives, and the keys and
// commands under test.
const writeInit = (home, keys, tabs, commands = '{}') => writeFileSync(join(home, '.config/wangcai/init.ts'), `export default {
  leader: ' ',
  timeout: ${TIMEOUT},
  tabs: [${tabs.map((tab) => JSON.stringify({ id: tab.id, directory: tab.directory })).join(', ')}],
  keys: ${keys},
  commands: ${commands},
};
`);

// A window's page for a plugin, which is the container its keys are pressed in and where its echo is.
const pluginPage = (page, name) => page.locator(`[data-plugin="${name}"]`);

// A window opened on init.ts as a case wrote it, with what to close it again, the page of the plugin the case reads, the
// errors it is watched for, and `said`, which waits on what that page carries. `errors` carries a list a case already keeps.
const openWindow = async (open, pluginId, errors) => {
  const { page, close } = await open();
  const next = watch(page, errors);
  const echo = pluginPage(page, pluginId);
  await echo.waitFor();
  const said = (want) => until(async () => (await echo.textContent()) === want);
  return { page, close, echo, errors: next, said };
};

// A window with the probe mounted, and the reading to wait on: the text the probe carries.
const withProbe = (prefix, { keys, commands }, body) => withHome(prefix, {}, async ({ home, open }) => {
  writeInit(home, keys, [probe], commands);
  return body(await openWindow(open, probe.id));
});

// Local bindings only answer while the focus is inside a page: `focusPage` clicks in, `leavePage` takes the focus away.
const focusPage = async (page, name) => pluginPage(page, name).click();
const leavePage = (page) => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });

// init.ts is given the space bar as its leader, which a case presses by the name the keyboard uses for it. A sequence is
// written as init.ts writes it — either a run of keys or keys spaced out — and each key is pressed on its own.
const pressedFor = (sequence) => sequence
  .replace(/<leader>/i, 'Space ')
  .split(' ')
  .filter(Boolean)
  .flatMap((key) => (key === 'Space' ? [key] : [...key]));

// The hint the keymap shows while a prefix waits for its next key.
const hint = (page) => page.locator('.which-key');

// The sequences the cases below press, which are what init.ts binds them under.
const windowSequence = '<leader>pe';
const localSequence = '<leader>lo';
const fieldSequence = '<leader>pi';

// The texts those bindings publish, and the binding texts two cases share.
const windowText = '窗口';
const localText = '局部';
const localKey = `'${localSequence}': { event: '${probeEvent}', data: '${localText}' }`;
const fieldText = '输入框';
const fieldKey = `'${fieldSequence}': { event: '${probeEvent}', data: '${fieldText}', insert: true }`;

// The command one binding of the case below runs, and the name init.ts defines it under.
const commandName = 'probe.report';
// The other two sequences of the case below.
const scriptSequence = '<leader>ps';
const commandSequence = '<leader>pc';
// What each binding of that case hands the window, which is what the case then waits to read.
const eventText = '事件到了';
const scriptText = '脚本跑到了';
const commandText = '命令跑到了';

test('keys bound in init.ts reach the window as an event, a script, or a named command', { timeout: 180000 }, () => withProbe('wangcai-keys', {
  keys: `{
    '${windowSequence}': { event: '${probeEvent}', data: '${eventText}', desc: '发事件' },
    '${scriptSequence}': { desc: '跑脚本', run: ({ publish }) => publish('${probeEvent}', '${scriptText}') },
    '${commandSequence}': { command: '${commandName}', args: '${commandText}', desc: '走 commands' },
  }`,
  commands: `{ '${commandName}': ({ args, publish }) => publish('${probeEvent}', args) }`,
}, async ({ page, errors, said }) => {
  await focusPage(page, probe.id);
  await press(page, ...pressedFor(windowSequence));
  await said(eventText);
  await press(page, ...pressedFor(scriptSequence));
  await said(scriptText);
  await press(page, ...pressedFor(commandSequence));
  await said(commandText);
  assert.deepEqual(errors, []);
}));

// Named keys are read without their case, leader included, so `q` is bound as `<Leader>q` to keep that covered.
test('a prefix waits out the timeout, and the hint lists what may follow', { timeout: 180000 }, () => {
  const singleSequence = 'g';
  const doubleSequence = 'g g';
  const quitSequence = '<Leader>q';
  const quitHint = '退出';
  // A binding that publishes its own sequence says it without the spaces; the one bound under the leader publishes its last
  // key.
  const doubleText = doubleSequence.replace(' ', '');
  const quitText = quitSequence.slice(-1);
  const keys = `{
    '${singleSequence}': { event: '${probeEvent}', data: '${singleSequence}', desc: '单独一个 g' },
    '${doubleSequence}': { event: '${probeEvent}', data: '${doubleText}', desc: '到顶部' },
    '${quitSequence}': { event: '${probeEvent}', data: '${quitText}', desc: '${quitHint}' },
  }`;
  return withProbe('wangcai-keys-prefix', { keys }, async ({ page, said, errors }) => {
    await focusPage(page, probe.id);
    await press(page, ...pressedFor(quitSequence).slice(0, 1));
    await until(async () => (await hint(page).textContent()).includes(quitHint));
    await press(page, 'Escape');
    await until(() => hint(page).isHidden());
    // Two presses in a row are `gg`; a single `g` lands only once the timeout runs out.
    await press(page, ...pressedFor(doubleSequence));
    await said(doubleText);
    await press(page, ...pressedFor(singleSequence));
    await said(singleSequence);
    assert.deepEqual(errors, []);
  });
});

// The id of the field the keys are given, which is how a case finds it again.
const fieldId = 'probe-field';
// An input the keys take for a field, placed in the probe page with the focus on it.
const focusField = async (page) => {
  await pluginPage(page, probe.id).evaluate((container, id) => {
    const field = document.createElement('input');
    field.id = id;
    container.append(field);
    field.focus();
  }, fieldId);
};

test('a field keeps its own keys, unless the binding asks for them', { timeout: 180000 }, () => withProbe('wangcai-keys-field', { keys: `{ '${windowSequence}': { event: '${probeEvent}', data: '${windowText}' }, ${fieldKey} }` }, async ({ page, echo, said, errors }) => {
  await focusField(page);
  await press(page, ...pressedFor(windowSequence));
  // The sequence broke, so its last key belongs to the field; wait past the timeout to see the window binding stay quiet.
  await new Promise((resolve) => setTimeout(resolve, TIMEOUT + 300));
  assert.equal(await echo.textContent(), '');
  assert.equal(await page.locator(`#${fieldId}`).inputValue(), pressedFor(windowSequence).at(-1));
  await press(page, ...pressedFor(fieldSequence));
  await said(fieldText);
  assert.deepEqual(errors, []);
}));

const globalText = '全局';

// The binding one case below answers wherever the focus is, and the sequence init.ts binds it under.
const globalSequence = '<leader>gl';
const globalKey = `'${globalSequence}': { event: '${probeEvent}', data: '${globalText}', global: true }`;

test('a local binding answers only inside a page, a global one wherever the focus is', { timeout: 180000 }, () => withProbe('wangcai-keys-scope', { keys: `{ ${localKey}, ${globalKey} }` }, async ({ page, echo, said, errors }) => {
  // Outside any page only the global binding answers.
  await leavePage(page);
  await press(page, ...pressedFor(globalSequence));
  await said(globalText);
  await press(page, ...pressedFor(localSequence));
  // A press is handled as it arrives, so a moment is enough to see that this one stayed quiet.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await echo.textContent(), globalText);
  // Inside the page both the local and the global binding answer.
  await focusPage(page, probe.id);
  await press(page, ...pressedFor(localSequence));
  await said(localText);
  await press(page, ...pressedFor(globalSequence));
  await said(globalText);
  assert.deepEqual(errors, []);
}));

const leaveKeys = 'Control+Shift+Q';

test(`a ${leaveKeys} leaves the field, Escapes stay in it, and a prefix waiting there does not keep the press`, { timeout: 180000 }, () => withProbe('wangcai-keys-escape', { keys: `{ ${localKey}, ${fieldKey} }` }, async ({ page, said, errors }) => {
  await focusField(page);
  const focused = () => page.evaluate(() => ({
    id: document.activeElement?.id ?? '',
    plugin: document.activeElement?.dataset?.plugin ?? '',
  }));
  // A field that is also an editor (the text page) would otherwise lose the keyboard to a reader leaving the insert mode.
  await press(page, 'Escape', 'Escape');
  assert.equal((await focused()).id, fieldId);
  // A prefix a field can answer, waiting there for its next key, does not keep this press for itself.
  await press(page, ...pressedFor(fieldSequence).slice(0, 2));
  await until(() => hint(page).isVisible());
  await press(page, leaveKeys);
  assert.equal((await focused()).plugin, probe.id);
  await until(() => hint(page).isHidden());
  await press(page, ...pressedFor(localSequence));
  await said(localText);
  assert.deepEqual(errors, []);
}));

test("a page's own binding wins over a global one on the same sequence", { timeout: 180000 }, () => withHome('wangcai-keys-priority', {}, async ({ home, open }) => {
  writeInit(home, `{ '${providedSequence}': { event: '${probeEvent}', data: '${globalText}', global: true } }`, [provided]);
  const { page, errors, said } = await openWindow(open, provided.id);
  // Outside its page the global binding answers, so park the focus outside it first.
  await leavePage(page);
  await press(page, ...pressedFor(providedSequence));
  await said(globalText);
  // Inside its page the plugin's own key wins.
  await focusPage(page, provided.id);
  await press(page, ...pressedFor(providedSequence));
  await said(pluginText);
  assert.deepEqual(errors, []);
}));

const overrideText = '配置';

test('a plugin brings its own keys, and init.ts overrides them', { timeout: 180000 }, () => withHome('wangcai-keys-plugin', { tabs: [provided] }, async ({ home, open }) => {
  // What both windows report, in one list: the second start has to be as clean as the first.
  const first = await openWindow(open, provided.id);
  await focusPage(first.page, provided.id);
  await press(first.page, ...pressedFor(providedSequence));
  await first.said(pluginText);
  await first.close();
  // The same sequence in init.ts overrides the plugin's layer.
  writeInit(home, `{ '${providedSequence}': { event: '${probeEvent}', data: '${overrideText}', desc: '覆盖插件的键' } }`, [provided]);
  const second = await openWindow(open, provided.id, first.errors);
  await focusPage(second.page, provided.id);
  await press(second.page, ...pressedFor(providedSequence));
  await second.said(overrideText);
  await second.close();
  assert.deepEqual(first.errors, []);
}));

// The default sequence that closes a tab.
const closeSequence = '<leader>w';

// The two views the tab strip is opened with.
const filesView = '文件';
const terminalView = '终端';

test(`the default ${closeSequence} closes the current tab`, { timeout: 180000 }, () => withWindow('wangcai-keys-close', workspaceLists([viewPlugin('files', filesView), viewPlugin('terminal', terminalView)]), async ({ page, errors }) => {
  await openView(page, filesView);
  await openView(page, terminalView);
  await untilTabs(page, [filesView, terminalView], 'the two views are open before a tab is closed');
  await press(page, ...pressedFor(closeSequence));
  await untilTabs(page, [filesView], 'the tab in front is the one that closes');
  assert.deepEqual(errors, []);
}));
