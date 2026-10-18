import type { Network } from './config';

/** What the shell lends Core: the Electron ends of the app, and where the files of a run live. */
export interface CoreHost {
  paths: { config: string; storage: string; resources: string; node: string };
  /** The app's version, which is what the snapshot an agent reads is stamped with. */
  version: string;
  /** Where the app's own sources are shipped: what that snapshot is copied from. */
  sources: string;
  /** The app registers the schemes before it is ready; Core serves what they hand out. */
  protocol: { handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void };
  /** A request of Core's own goes through the session, which is where the proxy init.ts names is set. */
  fetch(url: string, options?: { signal?: AbortSignal }): Promise<Response>;
  /** One topic to the window, on the channel shared.ts names. */
  send(topic: string, data: unknown): void;
  setProxy(rules: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Draws the window again, which is what a plugin that was built anew needs. */
  reload(): void;
  /** Asks the shell for its own rebuild — fetching, building and restarting Core is the shell's business. */
  updateCore(): void;
  fullscreen(): boolean;
}

/** What the shell gets back once Core is running. */
export interface Core {
  /** One method the window asked for by name; the app only forwards the call. */
  dispatch(method: string, ...args: unknown[]): unknown;
  /** The window's background before the page paints, taken from the theme init.ts holds. */
  background: string;
  /** How this run reaches the network, which is how the shell updates Core itself. */
  network: Network;
  dispose(): Promise<void>;
}