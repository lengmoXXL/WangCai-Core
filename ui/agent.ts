import type { AgentDownload } from '../main/agent';
import { call } from './bridge';

/** The download of the agent the machines run, in the corner of the pane that waits for a terminal: that it is
 * under way, or why it stopped and what starts it again. */
export function agentDownload() {
  const element = document.createElement('div');
  element.className = 'agent-download';
  element.setAttribute('role', 'status');
  element.hidden = true;
  const label = document.createElement('span');
  const reason = document.createElement('span');
  reason.className = 'reason';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重试';
  retry.onclick = () => {
    retry.disabled = true;
    void call('agent-retry').catch(() => {});
  };
  element.append(label, reason, retry);
  window.wangcai.subscribe('core:agent', (value) => {
    const { stage, message } = value as AgentDownload;
    const failed = stage === 'failed';
    element.hidden = stage === 'ready';
    element.dataset.stage = stage;
    label.textContent = failed ? '下载 wangcai 失败' : '正在下载 wangcai…';
    // The last line of the report is what went wrong with the last attempt; the whole of it, URL and all, is the
    // tooltip.
    reason.textContent = failed ? (message ?? '').split('\n').pop() ?? '' : '';
    reason.title = message ?? '';
    reason.hidden = !failed;
    retry.hidden = !failed;
    retry.disabled = false;
  });
  return element;
}