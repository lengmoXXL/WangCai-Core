import { coreId, stageNames, type InstallStage, type InstallStatus } from '@lengmoxxl/sdk/bridge';
import { call } from './bridge';

/** The block the plugin page holds above its list: what the shell's own install of Core is doing, and the button
 * that asks for one. */
export function coreBlock() {
  const element = document.createElement('section');
  element.className = 'core';
  const name = document.createElement('span');
  name.className = 'install-id';
  name.textContent = '核心组件';
  const stage = document.createElement('span');
  stage.className = 'install-stage';
  const update = document.createElement('button');
  update.type = 'button';
  update.onclick = () => { void call('install', [coreId]); };
  const message = document.createElement('p');
  message.className = 'install-message';
  element.append(name, stage, update, message);
  const idle = (value: InstallStage) => value === 'ready' || value === 'failed';
  return {
    element,
    /** Draws the row the shell reports for Core, and nothing at all for a shell that reports none. */
    update(status: InstallStatus | undefined, busy: boolean) {
      element.hidden = status === undefined;
      // The shell installs one thing at a time, so asking for a second while it works would be dropped there.
      update.disabled = busy || (status !== undefined && !idle(status.stage));
      update.textContent = status?.stage === 'failed' ? '重试' : '更新';
      stage.textContent = status ? stageNames[status.stage] : '';
      message.textContent = status?.message ?? '';
      element.dataset.stage = status?.stage ?? '';
    },
  };
}