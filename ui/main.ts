import type { Profile } from '@lengmoxxl/sdk';
import type { Dispose, TabRecord, UiContext } from '@lengmoxxl/sdk/channel';
import { fullscreenTopic, previewMessage, previewUrl, uiFont, type PluginInfo } from '@lengmoxxl/sdk/bridge';
import { call } from './bridge';
import { installsPage } from './installs';
import { bindKeys } from './keymap';
import { sidebarDividers } from './layout';
import { sidebarTabs } from './tabs';
import { workspaceSidebar } from './workspace-sidebar';
import type { KeymapPayload } from '../main/keymap';
import './style.css';

const root = document.getElementById('root')!;
const disposers: Dispose[] = [];
let closing = false;
window.addEventListener('beforeunload', () => {
  closing = true;
  for (const dispose of disposers.reverse()) void dispose();
});

async function start() {
  // The theme comes from the shell, not from a plugin, so it is set before anything is drawn:
  // the plugin page is styled from its first moment even when a plugin still has to be cloned and built.
  const profile = await call<Profile>('config');
  for (const [token, color] of Object.entries(profile.theme)) document.documentElement.style.setProperty(`--wc-${token}`, color);
  document.documentElement.style.setProperty('--wc-font', uiFont);
  const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
  document.documentElement.style.colorScheme = r * 299 + g * 587 + b * 114 > 128_000 ? 'light' : 'dark';
  // The window is asked once per load, and followed for every change after that.
  const applyChrome = (fullscreen: unknown) => {
    if (fullscreen === true) document.documentElement.style.setProperty('--wc-chrome', '0px');
    else document.documentElement.style.removeProperty('--wc-chrome');
  };
  window.wangcai.subscribe(fullscreenTopic, applyChrome);
  applyChrome(await call<boolean>('fullscreen'));
  root.append(installsPage());
  const main = document.createElement('main');
  main.className = 'desktop-main';
  const plugins = await call<PluginInfo[]>('plugins');
  // Nothing to load fills the pane rather than the window: the page above it is what reported the plugins
  // that are out.
  if (!plugins.length) main.textContent = '未安装插件';
  // Every bound sequence — Core's, the plugins' and init.ts's — is read once the plugins have activated, since they add
  // theirs.
  disposers.push(bindKeys(await call<KeymapPayload>('keymap')));
  const tabStrip = await sidebarTabs(root);
  // The topic Core's own `<leader>w` publishes; a plugin's binding may publish it too.
  window.wangcai.subscribe('core:close-tab', () => tabStrip.closeSelected());
  const providers = plugins.filter((plugin) => plugin.workspaces && !plugin.error).map((plugin) => plugin.id);
  const workspaceColumn = await workspaceSidebar({
    root,
    providers,
    tabs: tabStrip,
    closing: () => closing,
    disposers,
  });
  root.append(workspaceColumn.element, main, tabStrip.element);
  sidebarDividers(root, workspaceColumn.element, tabStrip.element, disposers);

  const opens = new Map<string, (record: TabRecord) => Promise<void>>();
  for (const plugin of plugins) {
    if (!plugin.error && !plugin.ui) continue;
    const container = document.createElement('section');
    container.className = 'plugin';
    container.dataset.plugin = plugin.id;
    // Focusable without a tab stop, so clicking a page puts the focus there and its local keys start working.
    container.tabIndex = -1;
    main.append(container);
    const subscriptions = new Set<() => void>();
    let stylesheet: HTMLLinkElement | undefined;
    let dispose: Dispose | undefined;
    const fail = async (error: unknown) => {
      for (const off of subscriptions) off();
      await dispose?.();
      stylesheet?.remove();
      container.hidden = false;
      container.className = 'plugin-error';
      container.textContent = `${plugin.id}: ${error instanceof Error ? error.message : String(error)}`;
    };
    try {
      if (plugin.error) throw new Error(plugin.error);
      if (plugin.css) {
        stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = plugin.css;
        const loaded = new Promise<void>((resolve, reject) => {
          stylesheet!.onload = () => resolve();
          stylesheet!.onerror = () => reject(new Error('Cannot load plugin stylesheet'));
        });
        document.head.append(stylesheet);
        await loaded;
      }
      const context: UiContext = {
        global: {
          publish: (event, data) => call('publish', event, data),
          subscribe(topic, callback) {
            const off = window.wangcai.subscribe(topic, callback as (data: unknown) => void);
            subscriptions.add(off);
            return () => { off(); subscriptions.delete(off); };
          },
        },
        ui: {
          request: (method, params) => call('request', plugin.id, method, params),
          subscribe(topic, callback) {
            const off = window.wangcai.subscribe(`${plugin.id}:${topic}`, callback as (data: unknown) => void);
            subscriptions.add(off);
            return () => { off(); subscriptions.delete(off); };
          },
        },
        host: {
          config: { ...profile, ...plugin.config },
          preview: { url: previewUrl, message: previewMessage },
          tabs: (options) => tabStrip.open(plugin.id, options),
          open: (url) => call('open', url),
        },
      };
      const module = await import(/* @vite-ignore */ plugin.ui!);
      if (module.open) container.hidden = true;
      dispose = await module.mount(container, context);
      if (module.open) {
        tabStrip.addView(module.title ?? plugin.id, () => { void module.open(context); });
        opens.set(plugin.id, async (record) => {
          try { await module.open(context, record); } catch (error) { await fail(error); }
        });
      }
      const cleanup = async () => {
        for (const off of subscriptions) off();
        await dispose?.();
        stylesheet?.remove();
        container.remove();
      };
      if (closing) await cleanup(); else disposers.push(cleanup);
    } catch (error) {
      await fail(error);
    }
  }
  await tabStrip.restore((record) => opens.get(record.plugin)?.(record));
  disposers.push(tabStrip.dispose);
}
void start().catch((error) => { root.textContent = String(error); });
