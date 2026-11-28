import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Machine, Profile, WorkspaceActive } from '@lengmoxxl/sdk';
import type { TabRecord } from '@lengmoxxl/sdk/channel';
import { contractVersion, pluginScheme, pluginsHost, previewMessage, previewScheme, previewUrl, uiFont, type Network, type PluginEntry, type WorkspaceGroup } from '@lengmoxxl/sdk/bridge';
import { agentInstaller } from './agent';
import { loadConfig, type CoreConfig } from './config';
import type { Core, CoreHost } from './host';
import { keymapOf, type KeyContext } from './keymap';
import { connectorOf } from './machines';
import { loadPlugins } from './plugins';
import { syncSources } from './resources';
import { themesOf } from './theme';
import type { FontConfig } from './wangcai.api';

// A previewed page is made of inline scripts and remote assets, which the renderer's CSP forbids; serving it
// from its own scheme gives it a policy of its own, and the sandboxed frame keeps the page off the shell.
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' http: https:; style-src 'unsafe-inline' http: https: data:; img-src http: https: data: blob:; font-src http: https: data:; connect-src http: https: data:; media-src http: https: data: blob:; frame-src http: https: data: blob:; base-uri 'none'";
// Writing the page into this document, rather than setting innerHTML, is what runs its scripts. The base font
// keeps an unstyled page readable next to the editor that the same file shows in source form; document.open()
// discards the document, so the style goes in afterwards and sits first, where the page's own rules override it.
const previewDocument = ({ family = uiFont, size = 13, lineHeight = 1.6 }: FontConfig = {}) => {
  // A font family is serialized inside a script element, where a closing tag would end the script.
  const fontStyle = JSON.stringify({ fontFamily: family, fontSize: `${size}px`, lineHeight: String(lineHeight) }).replaceAll('<', '\\u003c');
  return `<!doctype html><meta charset="utf-8"><script>
    parent.postMessage('${previewMessage}', '*');
    addEventListener('message', (event) => {
      document.open();
      document.write(event.data);
      document.close();
      const base = document.createElement('style');
      base.textContent = 'html {}';
      document.head.prepend(base);
      if (base.sheet) Object.assign(base.sheet.cssRules[0].style, ${fontStyle});
    });
  </script>`;
};

export async function prepare(paths: { config: string; storage: string }, networkOf: (value: unknown) => Network) {
  const { config, plugins } = await loadConfig(paths, networkOf);
  return {
    network: config.network,
    plugins: Array.from(plugins.values(), ({ id, repo, commit, directory }) => ({ id, repo, commit, directory })),
    activate: (host: CoreHost) => activate({
      ...host,
      config,
      plugins: async () => (await host.plugins()).map(({ id, directory }) => {
        const spec = plugins.get(id)!;
        return { id, directory, workspaces: spec.workspaces, config: spec.config };
      }),
    }),
  };
}

// Earlier shells call activate with the configuration they loaded themselves.
export async function activate(host: Omit<CoreHost, 'plugins'> & { config: CoreConfig; plugins(): Promise<PluginEntry[]> }): Promise<Core> {
  const { storage } = host.paths;
  const { network, font: fontInput } = host.config;
  const { family, size, lineHeight } = (fontInput ?? {}) as Record<string, unknown>;
  const fontFields: FontConfig = {};
  const fontFamily = typeof family === 'string' ? family.trim() : '';
  if (fontFamily) fontFields.family = fontFamily;
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) fontFields.size = size;
  if (typeof lineHeight === 'number' && Number.isFinite(lineHeight) && lineHeight > 0) fontFields.lineHeight = lineHeight;
  const font = Object.keys(fontFields).length ? fontFields : undefined;
  mkdirSync(storage, { recursive: true });
  const stateDirectory = join(storage, 'data/core');
  mkdirSync(stateDirectory, { recursive: true });
  // TODO: remove this migration once no data uses the old storage root.
  for (const file of ['groups.json', 'tabs.json']) {
    const legacy = join(storage, file);
    const current = join(stateDirectory, file);
    if (!existsSync(current) && existsSync(legacy)) renameSync(legacy, current);
  }
  syncSources(host.sources, storage, host.version);
  const agents = agentInstaller(storage, network, (state) => host.send('core:agent', state));
  const connectMachine = connectorOf(agents);
  // The machine of the workspace in front, which a binding reads with `machine()`: a provider reports it as the window
  // switches workspaces, and what a provider publishes passes through here on its way to the window.
  let front: Machine | undefined;
  const broadcast = (topic: string, data: unknown) => {
    if (topic === 'workspace:active') front = (data as WorkspaceActive | null)?.machine;
    host.send(topic, data);
  };
  // Loaded on the first ask, and again after a plugin was built anew: the window and the protocols all wait
  // for whatever set is current. It takes the keymap made below, whose own calls reach back through this one,
  // so either has to be usable before the other exists.
  let loading: ReturnType<typeof loadPlugins> | undefined;
  const loaded = () => loading ??= host.plugins().then((plugins) => loadPlugins({
    storageDirectory: storage,
    connect: connectMachine,
    profile, font, plugins, broadcast, keymap,
  }));
  // Serves a loaded plugin's files to the renderer; the directories exist once loading is done.
  host.protocol.handle(pluginScheme, async (request) => {
    const url = new URL(request.url);
    if (url.host !== pluginsHost) return new Response('Not found', { status: 404 });
    const [, id, ...parts] = decodeURIComponent(url.pathname).split('/');
    const directory = (await loaded()).directories.get(id);
    if (!directory) return new Response('Not found', { status: 404 });
    const path = resolve(directory, parts.join('/'));
    const local = relative(directory, path);
    if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) return new Response('Not found', { status: 404 });
    const response = await host.fetch(pathToFileURL(path).toString());
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    // A plugin's files are read from disk, so nothing about them is worth keeping: a plugin that was
    // built again under the same URL is what the next load has to see.
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  });
  host.protocol.handle(previewScheme, (request) => request.url === previewUrl
    ? new Response(previewDocument(font), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PREVIEW_CSP } })
    : new Response('Not found', { status: 404 }));
  // State this repo keeps in a file of its own: read back as it was written, and replaced in one step.
  const readJson = <T>(path: string, fallback: T): T => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : fallback;
  const writeJson = (path: string, value: unknown) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
    renameSync(`${path}.tmp`, path);
  };
  const tabsPath = join(stateDirectory, 'tabs.json');
  const groupsPath = join(stateDirectory, 'groups.json');
  const themePath = join(stateDirectory, 'theme.json');
  const themes = themesOf(host.config.theme);
  const chosen = readJson<string>(themePath, '');
  const profile: Profile = { theme: themes[chosen] ?? Object.values(themes)[0] };
  // The window and the keymap ask for the same two calls.
  const publish = async (event: string, data?: unknown) => (await loaded()).publish(event, data);
  const request = async (id: string, method: string, params?: unknown) => (await loaded()).request(id, method, params);
  // An ask a binding makes is a dialog in the window: the call waits here for the answer the window sends back, and one
  // dismissed there comes back as nothing.
  const asking = new Map<number, (value: unknown) => void>();
  let asks = 0;
  const ask = (kind: 'input' | 'pick', options: object) => new Promise<string | undefined>((resolve) => {
    const id = asks += 1;
    asking.set(id, (value) => resolve(typeof value === 'string' ? value : undefined));
    host.send('core:prompt', { id, kind, ...options });
  });
  // The window and every plugin already mounted take the new colours from this one broadcast; a plugin mounted later
  // reads them out of the profile, which is why it is the profile the switch writes rather than a copy.
  const switchTheme = async () => {
    const name = await ask('pick', { title: '主题', items: Object.keys(themes) });
    if (!name || !themes[name]) return;
    profile.theme = themes[name];
    writeJson(themePath, name);
    broadcast('theme', profile.theme);
  };
  // The keys Core binds by itself. Ctrl+h and Ctrl+l are what walks the window's three panes — the list of workspaces,
  // the page of the workspace in front, and the right sidebar's tab in front.
  const defaultKeys = {
    '<leader>w': { event: 'core:close-tab', desc: '关标签页' },
    '<C-h>': { event: 'core:focus-left', desc: '焦点左移' },
    '<C-l>': { event: 'core:focus-right', desc: '焦点右移' },
    '<leader>ut': { run: switchTheme, desc: ['界面', '主题'] },
  };
  const exec: KeyContext['exec'] = async (machine, program, args, options = {}) => {
    const node = await connectMachine(machine ?? {});
    try {
      const { code, stdout, stderr } = await node.subprocess.exec(program, args, { cwd: options.cwd ?? '/', env: options.env });
      const text = new TextDecoder();
      return { code, stdout: text.decode(stdout), stderr: text.decode(stderr) };
    } finally {
      node.disconnect();
    }
  };
  const keymap = keymapOf(host.config.keymap, {
    profile, publish, request, send: host.send, open: host.openExternal,
    machine: () => front, exec, notify: (message) => host.send('core:notify', message),
    input: (options) => ask('input', options), pick: (options) => ask('pick', options),
  }, defaultKeys);
  const methods: Record<string, (...args: any[]) => unknown> = {
    publish,
    plugins: async () => (await loaded()).plugins,
    request,
    config: () => font ? { ...profile, font } : profile,
    keymap: keymap.payload,
    key: keymap.run,
    'prompt-answer': (id: number, value: unknown) => { asking.get(id)?.(value); asking.delete(id); },
    statuses: host.statuses,
    fullscreen: host.fullscreen,
    'agent-retry': async () => {
      await agents.local();
      host.reload();
    },
    install: async (ids: string[]) => {
      if (!(await host.install(ids))) return;
      const previous = loading;
      loading = undefined;
      if (previous) await (await previous).dispose();
      host.reload();
    },
    tabs: () => readJson<TabRecord[]>(tabsPath, []),
    'save-tabs': (tabs: TabRecord[]) => writeJson(tabsPath, tabs),
    groups: () => readJson<WorkspaceGroup[]>(groupsPath, []),
    'save-groups': (groups: WorkspaceGroup[]) => writeJson(groupsPath, groups),
    open: host.openExternal,
  };
  return {
    contract: contractVersion,
    dispatch: (method: string, ...args: unknown[]) => {
      const answer = methods[method];
      if (!answer) throw new Error(`Unknown method: ${method}`);
      return answer(...args);
    },
    dispose: async () => { if (loading) await (await loading).dispose(); },
  };
}
