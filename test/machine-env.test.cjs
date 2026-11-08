const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { until, withWindow } = require('@lengmoxxl/wangcai-testkit');
const { plugin } = require('./core-ui.cjs');

// A machine's variables are handed to each command rather than to the node it runs out of, so this plugin asks for
// both kinds of command — a process and a session — and writes what they report where the case can read it.
const probeMain = String.raw`
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

exports.activate = (context) => {
  const file = join(context.host.dataDirectory, 'env.json');
  const directory = join(context.host.dataDirectory, 'workspace');
  mkdirSync(directory, { recursive: true });
  const read = async (node, script, options) => new TextDecoder().decode((await node.subprocess.exec('/bin/sh', ['-c', script], options)).stdout);
  void (async () => {
    const results = {};
    try {
      const node = await context.connect({ env: { WANGCAI_PROBE: '$HOME/probe', PATH: '$HOME/.local/bin:$PATH' } });
      results.home = await read(node, 'printf %s "$HOME"', { cwd: '/' });
      results.probe = await read(node, 'printf %s "$WANGCAI_PROBE"', { cwd: '/' });
      results.path = await read(node, 'printf %s "$PATH"', { cwd: '/' });
      // What one command is told is that command's own.
      results.caller = await read(node, 'printf %s "$WANGCAI_PROBE"', { cwd: '/', env: { WANGCAI_PROBE: 'caller' } });
      // The same host again, asking for something else: a node that kept the first machine's variables would answer
      // with them here.
      const later = await context.connect({ env: { WANGCAI_PROBE: 'later' } });
      results.later = await read(later, 'printf %s "$WANGCAI_PROBE"', { cwd: '/' });
      const bare = await context.connect({});
      results.bare = await read(bare, 'printf %s "$WANGCAI_PROBE"', { cwd: '/' });
      // A session, which is where an agent runs: its shell writes what it was given into a file, since a terminal's
      // own echo would show the command rather than what it expands to.
      const said = join(context.host.dataDirectory, 'session.txt');
      const session = await node.pty.create({ rows: 24, cols: 80 }, { cwd: directory });
      const terminal = await node.pty.attach(session.id);
      await terminal.write('echo "$WANGCAI_PROBE" > "' + said + '"\r');
      const deadline = Date.now() + 30000;
      while (!existsSync(said) && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 100));
      results.session = existsSync(said) ? readFileSync(said, 'utf8').trim() : '';
      await node.pty.close(session.id);
    } catch (error) {
      results.error = String(error && error.message || error);
    }
    writeFileSync(file, JSON.stringify(results));
  })();
};
`;

const probe = plugin('probe', { 'main.cjs': probeMain });

test('a machine hands its variables to each command, not to the node', { timeout: 180000 }, () => withWindow('wangcai-machine-env', { tabs: [probe] }, async ({ home, errors }) => {
  const state = join(home, '.local/share/wangcai/data', probe.id);
  const file = join(state, 'env.json');
  await until(() => existsSync(file));
  const results = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(results.error, undefined);
  // `$HOME` in a value is the node's, which is where its commands run.
  assert.ok(results.home);
  assert.equal(results.probe, `${results.home}/probe`);
  assert.ok(results.path.startsWith(`${results.home}/.local/bin:`), results.path);
  assert.equal(results.caller, 'caller');
  // A second machine on the same host has what it asked for, and only its own commands see it.
  assert.equal(results.later, 'later');
  assert.equal(results.bare, '', 'a node that keeps no machine\'s variables answers an empty bare command');
  assert.equal(results.session, `${results.home}/probe`);
  assert.deepEqual(errors, []);
}));