import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TabRecord } from '@lengmoxxl/sdk/channel';
import { pluginScheme, previewMessage, previewScheme, previewUrl, uiFont, type WorkspaceGroup } from '../shared';
import { agentInstaller } from './agent';
import { groupsPath, loadConfig, tabsPath } from './config';
import type { Core, CoreHost } from './host';
import { paths } from './paths';
import { pluginManager } from './manager';
import { syncSources } from './resources';

// A previewed page is made of inline scripts and remote assets, which the renderer's CSP forbids; serving it
// from its own scheme gives it a policy of its own, and the sandboxed frame keeps the page off the app.
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' http: https:; style-src 'unsafe-inline' http: https: data:; img-src http: https: data: blob:; font-src http: https: data:; connect-src http: https: data:; media-src http: https: data: blob:; frame-src http: https: data: blob:; base-uri 'none'";
// Writing the page into this document, rather than setting innerHTML, is what runs its scripts. The base font
// keeps an unstyled page readable next to the editor that the same file shows in source form; document.open()
// discards the document, so the style goes in afterwards and sits first, where the page's own rules override it.
const previewDocument = () => `<!doctype html><meta charset="utf-8"><script>parent.postMessage('${previewMessage}', '*'); addEventListener('message', (event) => { document.open(); document.write(event.data); document.close(); const base = document.createElement('style'); base.textContent = ${JSON.stringify(`html { font-family: ${uiFont}; font-size: 13px; line-height: 1.6; }`)}; document.head.prepend(base); });</script>`;

/**
 * The business the shell only carries: the config init.ts holds, the plugins it lists, and the protocols and
 * channels its window answers on. Everything Electron owns — the window, the session, the system — is asked
 * for through the host, so this runs against any shell that lends it the same.
 */
export async function activate(host: CoreHost): Promise<Core> {
  Object.assign(paths, host.paths);
  const { profile, plugins: specs, network } = await loadConfig();
  // A request the app makes of its own goes through the default session, so the proxy init.ts names is set
  // before anything is fetched. Chromium has no remote-DNS scheme: its socks5 already resolves out there.
  if (network.proxy) await host.setProxy(network.proxy.replace(/^socks5h:\/\//, 'socks5://'));
  // The window opens before the plugins do: a plugin may have to be cloned and built first, and the manager
  // page reports each stage while it happens.
  mkdirSync(paths.storage, { recursive: true });
  syncSources(host.sources, paths.storage, host.version);
  const manager = pluginManager({
    resourcesDirectory: paths.resources,
    agent: agentInstaller(paths.resources, network, host.fetch),
    profile, network, specs, node: paths.node,
    broadcast: (event, data) => host.send(event, data),
  });
  // Serves a loaded plugin's files to the renderer; the directories exist once loading is done.
  host.protocol.handle(pluginScheme, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'plugins') return new Response('Not found', { status: 404 });
    const [, id, ...parts] = decodeURIComponent(url.pathname).split('/');
    const directory = (await manager.loaded()).directories.get(id);
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
  // A list the app keeps in a file of its own: read back as it was written, and replaced in one step.
  const readList = <T>(path: string) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T[] : [];
  const writeList = <T>(path: string, list: T[]) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(list, null, 2));
    renameSync(`${path}.tmp`, path);
  };
  const methods: Record<string, (...args: any[]) => unknown> = {
    publish: async (event: string, data: unknown) => (await manager.loaded()).publish(event, data),
    plugins: async () => (await manager.loaded()).plugins,
    request: async (id: string, method: string, params: unknown) => (await manager.loaded()).request(id, method, params),
    config: () => profile,
    // The window's own Core page asks the app for a rebuild, which the app reports back on its topic.
    'core-update': () => host.updateCore(),
    installs: () => manager.statuses,
    fullscreen: () => host.fullscreen(),
    // What the plugin page's update and retry entries ask for.
    install: async (ids: string[]) => {
      if (await manager.update(ids)) host.reload();
    },
    tabs: () => readList<TabRecord>(tabsPath()),
    'save-tabs': (tabs: TabRecord[]) => writeList(tabsPath(), tabs),
    groups: () => readList<WorkspaceGroup>(groupsPath()),
    'save-groups': (groups: WorkspaceGroup[]) => writeList(groupsPath(), groups),
    // A plugin hands the shell a link, not a program: the shell decides what a scheme may open.
    open: (url: string) => host.openExternal(url),
  };
  return {
    background: profile.theme.background,
    network,
    dispatch: (method: string, ...args: unknown[]) => {
      const answer = methods[method];
      if (!answer) throw new Error(`Unknown method: ${method}`);
      return answer(...args);
    },
    dispose: async () => { await (await manager.loaded()).dispose(); },
  };
}