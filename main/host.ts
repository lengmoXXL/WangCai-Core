import type { Profile } from '@lengmoxxl/sdk';
import type { InstallStatus, Network, PluginEntry } from '@lengmoxxl/sdk/bridge';
import type { KeymapInput } from './keymap';

/** What the shell lends Core: where a run keeps its files, its own version and sources, the Electron
 * capabilities Core answers through, and the config and plugins the shell read and installed for it. */
export interface CoreHost {
  paths: { storage: string };
  /** The shell's version, which is what the snapshot an agent reads is stamped with. */
  version: string;
  /** Where the shell's own sources are shipped: what that snapshot is copied from. */
  sources: string;
  /** What init.ts holds — the theme, how a run reaches the network, and its keymap — which the shell read out of it.
   * The keymap is optional because a shell older than this contract sends none: what is left is Core's own keys. */
  config: { profile: Profile; network: Network; keymap?: KeymapInput };
  /** The plugins the shell installed and this repo loads. */
  plugins(): Promise<PluginEntry[]>;
  /** The rows the plugin page draws — the plugins, and Core itself — as they stand now. */
  statuses(): InstallStatus[];
  /** Installs or updates the rows these ids name, Core included; answers whether anything was built anew. */
  install(ids: string[]): Promise<boolean>;
  /** The shell registers the schemes before it is ready; Core serves what they hand out. */
  protocol: { handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void };
  /** A plugin's file, read through the shell's session. */
  fetch(url: string): Promise<Response>;
  /** One topic to the window. */
  send(topic: string, data: unknown): void;
  openExternal(url: string): Promise<void>;
  /** Draws the window again, which is what a plugin that was built anew needs. */
  reload(): void;
  fullscreen(): boolean;
}

/** What the shell gets back once Core is running. */
export interface Core {
  /** The contract this build answers, which the shell compares against what it lends. */
  contract: number;
  /** One method the window asks for by name; the shell only forwards the call. */
  dispatch(method: string, ...args: unknown[]): unknown;
  dispose(): Promise<void>;
}
