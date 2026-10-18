import { call, corePageTopic, coreStatusTopic, stageNames, type CoreStatus, type InstallStage } from '../shared';

/** The Core page: what the shell's own rebuild of Core is doing, and the button that asks for one. */
export function corePage() {
  const element = document.createElement('section');
  element.className = 'core-page';
  element.hidden = true;
  element.setAttribute('aria-label', '核心组件');
  const heading = document.createElement('h1');
  heading.textContent = '核心组件';
  const header = document.createElement('header');
  const actions = document.createElement('div');
  const button = (label: string, action: () => void) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.onclick = action;
    return item;
  };
  const update = button('更新', () => { void call('core-update'); });
  const close = button('关闭', () => { element.hidden = true; });
  actions.append(update, close);
  header.append(heading, actions);
  const body = document.createElement('div');
  body.className = 'core-body';
  const stage = document.createElement('p');
  stage.className = 'core-stage';
  const message = document.createElement('p');
  message.className = 'core-message';
  body.append(stage, message);
  element.append(header, body);
  const idle = (value: InstallStage) => value === 'ready' || value === 'failed';
  let status: CoreStatus | undefined;
  const draw = () => {
    // The shell runs one rebuild at a time, so asking for a second one while it works would be dropped there.
    update.disabled = status !== undefined && !idle(status.stage);
    stage.textContent = status ? stageNames[status.stage] : '';
    message.textContent = status?.message ?? '';
    if (status) stage.dataset.stage = status.stage;
    // What a rebuild reported stays on screen until it is closed, so a failure is read.
    if (status && status.stage !== 'ready') element.hidden = false;
  };
  window.wangcai.subscribe(corePageTopic, () => { element.hidden = false; });
  window.wangcai.subscribe(coreStatusTopic, (next) => { status = next as CoreStatus; draw(); });
  return element;
}