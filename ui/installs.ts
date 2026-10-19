import { coreId, installStatusesTopic, pluginPageTopic, stageNames, type InstallStage, type InstallStatus } from '@lengmoxxl/sdk/bridge';
import { call } from './bridge';

/** The plugin page: a card over the window, the Core the shell installs itself, one row per plugin init.ts
 * lists, and what to do about either. */
export function installsPage() {
  const install = (ids: string[]) => { void call('install', ids); };
  const element = document.createElement('section');
  element.className = 'installs';
  element.hidden = true;
  element.setAttribute('aria-label', '插件');
  const heading = document.createElement('h1');
  heading.textContent = '插件';
  const list = document.createElement('ul');
  const header = document.createElement('header');
  const actions = document.createElement('div');
  const core = document.createElement('section');
  core.className = 'core';
  core.hidden = true;
  let statuses: InstallStatus[] = [];
  const plugins = () => statuses.filter(({ id }) => id !== coreId);
  const entries = (stage: InstallStage) => plugins().filter((status) => status.stage === stage).map(({ id }) => id);
  const idle = (stage: InstallStage) => stage === 'ready' || stage === 'failed';
  const busy = () => statuses.some(({ stage }) => !idle(stage));
  const button = (label: string, action: () => void) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.onclick = action;
    return item;
  };
  const updateAll = button('全部更新', () => install(entries('ready')));
  const retryAll = button('全部重试', () => install(entries('failed')));
  const close = button('关闭', () => { element.hidden = true; });
  actions.append(updateAll, retryAll, close);
  header.append(heading, actions);
  element.append(header, core, list);
  // What a row of the page holds, whether it is the Core the shell installs itself or a plugin init.ts lists:
  const row = ({ id, stage, message }: InstallStatus, label: string) => {
    const name = document.createElement('span');
    name.className = 'install-id';
    name.textContent = label;
    const state = document.createElement('span');
    state.className = 'install-stage';
    state.textContent = stageNames[stage];
    const parts: HTMLElement[] = [name, state];
    const coreRow = id === coreId;
    // A ready plugin can be moved to the version init.ts pins or to the latest one, a failed one tried again;
    // Core holds a disabled button while it works, because the shell installs one thing at a time.
    if (coreRow || idle(stage)) {
      const action = button(stage === 'failed' ? '重试' : '更新', () => install([id]));
      if (coreRow) action.disabled = busy();
      parts.push(action);
    }
    const detail = document.createElement('p');
    detail.className = 'install-message';
    detail.textContent = message ?? '';
    parts.push(detail);
    return parts;
  };
  // A row with something left to do opens the page; it stays until it is closed, so a failure is read.
  const draw = () => {
    updateAll.disabled = busy() || !entries('ready').length;
    retryAll.disabled = busy() || !entries('failed').length;
    const coreStatus = statuses.find(({ id }) => id === coreId);
    core.hidden = coreStatus === undefined;
    if (coreStatus) {
      core.dataset.stage = coreStatus.stage;
      core.replaceChildren(...row(coreStatus, '核心组件'));
    }
    list.replaceChildren(...plugins().map((status) => {
      const item = document.createElement('li');
      item.dataset.stage = status.stage;
      item.append(...row(status, status.id));
      return item;
    }));
    if (statuses.some(({ stage }) => stage !== 'ready')) element.hidden = false;
  };
  const update = (next: InstallStatus[]) => {
    statuses = next;
    draw();
  };
  window.wangcai.subscribe(pluginPageTopic, () => { element.hidden = false; });
  window.wangcai.subscribe(installStatusesTopic, (next) => update(next as InstallStatus[]));
  void call<InstallStatus[]>('statuses').then(update);
  return element;
}
