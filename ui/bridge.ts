import type { PluginBridge } from '@lengmoxxl/sdk/bridge';

/** One method of the shell's bridge, which is one ipc call however many methods this repository answers. */
export const call = <T = any>(method: string, ...args: unknown[]) => window.wangcai.call(method, ...args) as Promise<T>;

declare global { interface Window { wangcai: PluginBridge } }