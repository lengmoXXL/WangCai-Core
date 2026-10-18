import type { Profile } from '@lengmoxxl/sdk';
import type { TabRecord } from '@lengmoxxl/sdk/channel';

// The shell's own font: the app decides this, plugins decide theirs.
export const uiFont = '"DejaVuSansM Nerd Font Mono", monospace';

// The shell draws the window out of Core's own bundle, which it serves under this scheme; the other two are
// what Core answers for itself. The shell declares all three privileged before it is ready.
export const coreScheme = 'wangcai-core';
export const pluginScheme = 'wangcai-plugin';
// The shell serves this document for a plugin to frame as a preview of an HTML file.
export const previewScheme = 'wangcai-preview';
export const previewUrl = `${previewScheme}://preview/`;
export const previewMessage = 'wangcai-preview';

// The two channels the app's preload and this repo share: one asks for a method by name, one carries topics.
export const link = { invoke: 'wangcai:invoke', channel: 'wangcai:channel' } as const;

// What the shell says to the window over the bridge channel: which page to open, and what rebuilding Core is
// doing. The page a topic names is the one that draws it.
export const pluginPageTopic = 'plugin-page';
export const corePageTopic = 'core-page';
export const coreStatusTopic = 'core-status';

export interface PluginInfo { id: string; config: Record<string, unknown>; ui?: string; css?: string; error?: string; workspaces?: boolean }

// What a plugin init.ts lists is doing, as the manager page reports it.
export type InstallStage = 'cloning' | 'updating' | 'installing' | 'building' | 'ready' | 'failed';
export interface InstallStatus { id: string; stage: InstallStage; message?: string }
// What rebuilding Core reports: the stages a plugin install reports, under no plugin's name.
export interface CoreStatus { stage: InstallStage; message?: string }
// What a stage is called on the page that reports it.
export const stageNames: Record<InstallStage, string> = { cloning: '克隆中', updating: '同步中', installing: '安装依赖', building: '构建中', ready: '就绪', failed: '失败' };
// The left sidebar's own bookkeeping: workspaces a provider serves, gathered under a named group, which the provider
// never hears of.
export interface WorkspaceGroup {
  id: string;
  name: string;
  collapsed: boolean;
  workspaces: string[];
  // How many top-level rows the group is drawn under, and under every row when it records none.
  after?: number;
}
export interface PluginBridge {
  call(method: string, ...args: unknown[]): Promise<any>;
  subscribe(event: string, callback: (data: unknown) => void): () => void;
}

/** One method of the app's bridge, which is one ipc call however many methods this repo answers. */
export const call = <T = any>(method: string, ...args: unknown[]) => window.wangcai.call(method, ...args) as Promise<T>;
declare global { interface Window { wangcai: PluginBridge } }
