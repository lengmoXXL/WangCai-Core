import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Network } from '@lengmoxxl/sdk/bridge';
import type { KeymapInput } from './keymap';
import type { PluginSpec } from './wangcai.api';

export interface CoreConfig { theme?: unknown; font?: unknown; network: Network; keymap?: KeymapInput }

type ConfiguredPlugin = PluginSpec & { workspaces: boolean };

const trimmed = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

// A relative directory is taken from the config directory. The first entry for an id wins.
function mergePlugins(configDirectory: string, entries: unknown, workspaces: boolean, specs: Map<string, ConfiguredPlugin>) {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    const { id, repo, commit, directory, config } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim() || specs.has(id)) continue;
    const relative = trimmed(directory);
    specs.set(id, {
      id,
      workspaces,
      repo: trimmed(repo) ?? (relative ? undefined : `https://github.com/lengmoXXL/WangCai-${id}`),
      commit: trimmed(commit),
      directory: relative ? resolve(configDirectory, relative) : undefined,
      config: typeof config === 'object' && config !== null && !Array.isArray(config) ? config as Record<string, unknown> : undefined,
    });
  }
}

const DEFAULT_PLUGINS: ConfiguredPlugin[] = [
  { id: 'terminal-agent', workspaces: true, repo: 'https://github.com/lengmoXXL/WangCai-terminal-agent' },
  { id: 'files', workspaces: false, repo: 'https://github.com/lengmoXXL/WangCai-files' },
  { id: 'terminal', workspaces: false, repo: 'https://github.com/lengmoXXL/WangCai-terminal' },
];

const preset = (storage: string) => `// 配置字段的完整说明：${join(storage, 'src/README.md')}
import type { Config } from 'wangcai.api';

export default {
  workspaces: [
${DEFAULT_PLUGINS.filter((spec) => spec.workspaces).map(({ id, repo }) => `    { id: '${id}', repo: '${repo}' }`).join(',\n')},
  ],
  tabs: [
${DEFAULT_PLUGINS.filter((spec) => !spec.workspaces).map(({ id, repo }) => `    { id: '${id}', repo: '${repo}' }`).join(',\n')},
  ],
} satisfies Config;
`;

export async function loadConfig(
  paths: { config: string; storage: string },
  networkOf: (value: unknown) => Network,
): Promise<{ config: CoreConfig; plugins: Map<string, ConfiguredPlugin> }> {
  const source = join(paths.config, 'init.ts');
  if (!existsSync(source)) {
    try {
      mkdirSync(paths.config, { recursive: true });
      writeFileSync(source, preset(paths.storage));
    } catch (error) {
      console.error('User config:', error);
      return { config: { network: {} }, plugins: new Map(DEFAULT_PLUGINS.map((plugin) => [plugin.id, plugin])) };
    }
  }
  // The config's editor resolves types from the source snapshot Core installs.
  try {
    const sdk = join(paths.storage, 'src/sdk');
    writeFileSync(join(paths.config, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'esnext', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, types: [],
        allowImportingTsExtensions: true,
        paths: {
          'wangcai.api': [join(paths.storage, 'src/core/main/wangcai.api.ts')],
          '@lengmoxxl/sdk': [join(sdk, 'types.ts')],
          '@lengmoxxl/sdk/bridge': [join(sdk, 'bridge.ts')],
        },
      },
      include: ['init.ts'],
    }, null, 2)}\n`);
  } catch (error) {
    console.error('User config:', error);
  }
  try {
    const { default: input } = await import(pathToFileURL(source).href) as { default?: unknown };
    const { theme, font, network: networkInput, workspaces, tabs, leader, timeout, keys, commands } = (input ?? {}) as Record<string, unknown>;
    const specs = new Map<string, ConfiguredPlugin>();
    mergePlugins(paths.config, workspaces, true, specs);
    mergePlugins(paths.config, tabs, false, specs);
    return {
      config: { theme, font, network: networkOf(networkInput), keymap: { leader, timeout, keys, commands } },
      plugins: specs,
    };
  } catch (error) {
    console.error('User config:', error);
    return { config: { network: {} }, plugins: new Map() };
  }
}
