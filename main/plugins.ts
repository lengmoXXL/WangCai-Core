import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { compileFunction } from 'node:vm';
import type { Machine, Profile } from '@lengmoxxl/sdk';
import type { Dispose, MainContext } from '@lengmoxxl/sdk/channel';
import { pluginsUrl, type PluginEntry, type PluginInfo } from '@lengmoxxl/sdk/bridge';
import type { Agents } from './agent';
import { connect } from './machines';
import type { Keymap } from './keymap';

// An 'array' leaf takes whatever list init.ts holds and leaves its entries to the plugin to check.
function resolveConfig(schema: unknown, values: unknown): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (typeof schema !== 'object' || schema === null) return settings;
  const given = (typeof values === 'object' && values !== null ? values : {}) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(schema as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const declared = entry as { type?: unknown; default?: unknown };
    if (typeof declared.type === 'string') {
      const matches = declared.type === 'array' ? Array.isArray(given[key]) : typeof given[key] === declared.type;
      const value = matches ? given[key] : declared.default;
      if (value !== undefined) settings[key] = value;
      continue;
    }
    const nested = resolveConfig(entry, given[key]);
    if (Object.keys(nested).length) settings[key] = nested;
  }
  return settings;
}

export async function loadPlugins(options: {
  storageDirectory: string; agents: Agents; profile: Profile;
  plugins: PluginEntry[]; broadcast: (event: string, data: unknown) => void;
  keymap: Pick<Keymap, 'add' | 'clear'>;
}) {
  const { storageDirectory, agents, profile, plugins: installed, broadcast, keymap } = options;
  const connectMachine = async (machine: Pick<Machine, 'host' | 'env'>, signal?: AbortSignal) => connect(machine.host
    ? { type: 'ssh', host: machine.host, agent: agents.ssh, env: machine.env, signal }
    : { type: 'local', binary: await agents.local(), env: machine.env, signal });
  const infos: PluginInfo[] = [];
  const directories = new Map<string, string>();
  const handlers = new Map<string, Map<string, (params: any) => unknown>>();
  const disposers: Dispose[] = [];
  const channels = new Set<Map<string, Set<(data: any) => void | Promise<void>>>>();
  async function publish(event: string, data: unknown) {
    broadcast(event, data);
    await Promise.all([...channels].flatMap((subscriptions) => [...subscriptions.get(event) ?? []].map(async (callback) => {
      try { await callback(data); } catch (error) { console.error(`Plugin event ${event}:`, error); }
    })));
  }
  // Plugins mount in id order, not in the order init.ts lists them: a plugin publishes events as it
  // mounts, so what one plugin observes must not depend on the config file.
  for (const entry of [...installed].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = entry.id;
    const info: PluginInfo = { id, config: {} };
    infos.push(info);
    const methods = new Map<string, (params: any) => unknown>();
    handlers.set(id, methods);
    const subscriptions = new Map<string, Set<(data: any) => void | Promise<void>>>();
    channels.add(subscriptions);
    try {
      const directory = entry.directory;
      const filename = join(directory, 'main.cjs');
      if (!existsSync(filename)) throw new Error('Plugin is not installed');
      if (existsSync(join(directory, 'ui.js'))) {
        info.ui = `${pluginsUrl}${encodeURIComponent(id)}/ui.js`;
        if (existsSync(join(directory, 'ui.css'))) info.css = `${pluginsUrl}${encodeURIComponent(id)}/ui.css`;
      }
      const module = { exports: {} as { activate(context: MainContext): void | Dispose | Promise<void | Dispose>; config?: unknown; keys?: unknown } };
      compileFunction(readFileSync(filename, 'utf8'), ['require', 'module', 'exports', '__filename', '__dirname'], { filename })
        .call(module.exports, createRequire(filename), module, module.exports, filename, dirname(filename));
      const settings = resolveConfig(module.exports.config, entry.config);
      info.config = settings;
      info.workspaces = entry.workspaces;
      const dataDirectory = join(storageDirectory, 'data', id);
      mkdirSync(dataDirectory, { recursive: true });
      const context: MainContext = {
        connect: connectMachine,
        global: {
          publish,
          subscribe(topic, callback) {
            let callbacks = subscriptions.get(topic);
            if (!callbacks) subscriptions.set(topic, callbacks = new Set());
            callbacks.add(callback);
            return () => { callbacks.delete(callback); };
          },
        },
        ui: {
          publish: (topic, data) => { broadcast(`${id}:${topic}`, data); },
          handle(topic, handler) {
            if (topic.includes(':')) throw new Error(`Plugin method names cannot contain ":": ${topic}`);
            if (methods.has(topic)) throw new Error(`Duplicate plugin method: ${topic}`);
            methods.set(topic, handler);
            return () => { methods.delete(topic); };
          },
        },
        host: { dataDirectory, config: { ...profile, ...settings } },
      };
      const dispose = await module.exports.activate(context);
      // Read after `activate`, so keys it assigns there are seen.
      keymap.add(id, module.exports.keys);
      if (dispose) disposers.push(dispose);
      directories.set(id, directory);
    } catch (error) {
      info.error = error instanceof Error ? error.message : String(error);
      info.ui = undefined;
      info.css = undefined;
      methods.clear();
      subscriptions.clear();
      console.error(`Plugin ${id}:`, error);
    }
  }
  return {
    plugins: infos, directories, publish,
    request(id: string, method: string, params: unknown) {
      const handler = handlers.get(id)?.get(method);
      if (!handler) throw new Error(`Unknown plugin method: ${id}/${method}`);
      return handler(params);
    },
    async dispose() {
      for (const dispose of disposers.reverse()) {
        try { await dispose(); } catch (error) { console.error('Plugin cleanup:', error); }
      }
      handlers.clear();
      channels.clear();
      // A plugin's keys live only as long as this load of the plugins does.
      keymap.clear();
    },
  };
}
