import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TabRecord } from '@lengmoxxl/sdk/channel';
import { contractVersion, pluginScheme, pluginsHost, previewMessage, previewScheme, previewUrl, uiFont, type WorkspaceGroup } from '@lengmoxxl/sdk/bridge';
import { agentInstaller } from './agent';
import type { Core, CoreHost } from './host';
import { loadPlugins } from './plugins';
import { syncSources } from './resources';

// A previewed page is made of inline scripts and remote assets, which the renderer's CSP forbids; serving it
// from its own scheme gives it a policy of its own, and the sandboxed frame keeps the page off the shell.
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' http: https:; style-src 'unsafe-inline' http: https: data:; img-src http: https: data: blob:; font-src http: https: data:; connect-src http: https: data:; media-src http: https: data: blob:; frame-src http: https: data: blob:; base-uri 'none'";
// Writing the page into this document, rather than setting innerHTML, is what runs its scripts. The base font
// keeps an unstyled page readable next to the editor that the same file shows in source form; document.open()
// discards the document, so the style goes in afterwards and sits first, where the page's own rules override it.
const previewDocument = () => `<!doctype html><meta charset="utf-8"><script>parent.postMessage('${previewMessage}', '*'); addEventListener('message', (event) => { document.open(); document.write(event.data); document.close(); const base = document.createElement('style'); base.textContent = ${JSON.stringify(`html { font-family: ${uiFont}; font-size: 13px; line-height: 1.6; }`)}; document.head.prepend(base); });</script>`;

/**
 * The business the shell only carries: the machines a window works on, the workspaces and tabs it shows, the
 * protocols it serves, and the methods it answers by name. The config init.ts holds and the plugins it lists are
 * the shell's to read and install, and arrive through the host. Everything Electron owns — the window, the
 * session, the system — is asked for through the host, so this runs against any shell that lends it the same.
 */
export async function activate(host: CoreHost): Promise<Core> {
  const { storage } = host.paths;
  const { profile, network } = host.config;
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
  const agents = agentInstaller(storage, network);
  // Loaded on the first ask, and again after a plugin was built anew: the window and the protocols all wait
  // for whatever set is current.
  let loading: ReturnType<typeof loadPlugins> | undefined;
  const loaded = () => loading ??= host.plugins().then((plugins) => loadPlugins({
    storageDirectory: storage,
    agents,
    profile, plugins, broadcast: host.send,
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
    ? new Response(previewDocument(), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PREVIEW_CSP } })
    : new Response('Not found', { status: 404 }));
  // A list this repo keeps in a file of its own: read back as it was written, and replaced in one step.
  const readList = <T>(path: string) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T[] : [];
  const writeList = <T>(path: string, list: T[]) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(list, null, 2));
    renameSync(`${path}.tmp`, path);
  };
  const tabsPath = join(stateDirectory, 'tabs.json');
  const groupsPath = join(stateDirectory, 'groups.json');
  const methods: Record<string, (...args: any[]) => unknown> = {
    publish: async (event: string, data: unknown) => (await loaded()).publish(event, data),
    plugins: async () => (await loaded()).plugins,
    request: async (id: string, method: string, params: unknown) => (await loaded()).request(id, method, params),
    config: () => profile,
    statuses: host.statuses,
    fullscreen: host.fullscreen,
    install: async (ids: string[]) => {
      if (!(await host.install(ids))) return;
      const previous = loading;
      loading = undefined;
      if (previous) await (await previous).dispose();
      host.reload();
    },
    tabs: () => readList<TabRecord>(tabsPath),
    'save-tabs': (tabs: TabRecord[]) => writeList(tabsPath, tabs),
    groups: () => readList<WorkspaceGroup>(groupsPath),
    'save-groups': (groups: WorkspaceGroup[]) => writeList(groupsPath, groups),
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
