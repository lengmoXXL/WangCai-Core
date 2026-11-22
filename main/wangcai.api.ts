/**
 * The API `init.ts` is written against, as one module an editor can resolve: the shell writes a tsconfig beside that
 * file pointing `wangcai.api` at this one in the sources copy, so `import type { Config } from 'wangcai.api'` and
 * `export default { … } satisfies Config` give the config its symbols — every field, and every call a binding's script
 * gets. Types only: nothing here runs, and the import is stripped when the shell loads the file.
 */
import type { Theme } from '@lengmoxxl/sdk';
import type { Network } from '@lengmoxxl/sdk/bridge';
import type { KeyContext } from './keymap';

export type { KeyContext, CommandResult } from './keymap';
export type { Machine, Profile, Theme } from '@lengmoxxl/sdk';
export type { Network } from '@lengmoxxl/sdk/bridge';

/** One plugin as `workspaces` or `tabs` names it: where it comes from, and what it is configured with. A relative
 * `directory` is read from the directory init.ts sits in, and an entry that names no source is the official repository
 * of its id. */
export interface PluginSpec {
  id: string;
  repo?: string;
  commit?: string;
  directory?: string;
  config?: Record<string, unknown>;
}

/** One bound sequence: where it answers, and the one thing it does — an event, a command named in `commands`, or a
 * script. */
export type Binding = {
  /** The line the hint lists after the prefix. An array holds one line per press, counted back from this binding: the
   * last is its own, and the ones before name the prefixes above it — `['git', '状态']` on `<leader>gs` names `<leader>g`
   * as git. Every binding under a prefix contributes, and the hint shows them all. */
  desc?: string | string[];
  /** Answers wherever the focus is, not only inside a plugin's page. */
  global?: boolean;
} & ({ event: string; data?: unknown } | { command: string; args?: unknown } | { run(context: KeyContext): unknown; args?: unknown });

/** What `init.ts` exports: the theme and network a run reads, the plugins it lists, and the keymap Core runs. */
export interface Config {
  /** The themes the window may switch between, by name. `WangCai` and `GitHub` ship; naming one of them patches it,
   * and any other name adds a theme. An added theme starts from `WangCai`, so one meant to be light names every token
   * it wants light. `<leader>ut` picks between them, and the choice is remembered. */
  theme?: Record<string, Partial<Theme>>;
  network?: Network;
  /** The plugins the window draws workspaces for. */
  workspaces?: PluginSpec[];
  /** The plugins that add sidebar tabs. */
  tabs?: PluginSpec[];
  /** The prefix key, in Neovim notation; `<C-Space>` when it is not written. */
  leader?: string;
  /** How long a prefix waits for its next key, in milliseconds. */
  timeout?: number;
  keys?: Record<string, Binding>;
  commands?: Record<string, (context: KeyContext) => unknown>;
}