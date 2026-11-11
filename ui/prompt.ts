import { call } from './bridge';

/** One ask a binding made: a field to type in, or a list to filter and take one item from. */
type Ask = { id: number; title: string } & ({ kind: 'input'; value?: string; placeholder?: string } | { kind: 'pick'; items: string[] });

/**
 * The asks a binding makes while it runs. The main process waits for each answer, so one is drawn at a time in the order
 * they arrive and what it came to is sent back; a dismissed one is sent back as nothing. The focus goes back where it
 * was, so the page the key was pressed in answers the next key.
 */
export function prompts(root: HTMLElement) {
  const scrim = document.createElement('div');
  scrim.className = 'menu-scrim prompt-scrim';
  scrim.hidden = true;
  const dialog = document.createElement('form');
  dialog.className = 'prompt-dialog';
  dialog.setAttribute('role', 'dialog');
  const heading = document.createElement('p');
  heading.className = 'prompt-title';
  const field = document.createElement('input');
  field.className = 'prompt-input';
  const list = document.createElement('div');
  list.className = 'prompt-list';
  list.setAttribute('role', 'listbox');
  dialog.append(heading, field, list);
  scrim.append(dialog);
  root.append(scrim);

  const queue: Ask[] = [];
  let current: Ask | undefined;
  // The items the filter leaves, and the one the arrows have moved to.
  let shown: string[] = [];
  let at = 0;
  let back: Element | null = null;

  const answer = (value: string | undefined) => {
    if (!current) return;
    const ask = current;
    current = undefined;
    scrim.hidden = true;
    void call('prompt-answer', ask.id, value ?? null).catch(console.error);
    if (back instanceof HTMLElement) back.focus();
    const next = queue.shift();
    if (next) show(next);
  };
  const draw = (items: string[]) => {
    const typed = field.value.trim().toLowerCase();
    shown = items.filter((item) => item.toLowerCase().includes(typed));
    const rows = shown.map((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === at));
      row.textContent = item;
      row.onclick = () => answer(item);
      return row;
    });
    const empty = document.createElement('p');
    empty.className = 'prompt-empty';
    empty.textContent = '没有匹配项';
    list.replaceChildren(...(rows.length ? rows : [empty]));
    list.children[at].scrollIntoView({ block: 'nearest' });
  };
  const show = (ask: Ask) => {
    current = ask;
    back = document.activeElement;
    dialog.setAttribute('aria-label', ask.title);
    heading.textContent = ask.title;
    field.setAttribute('aria-label', ask.title);
    list.hidden = ask.kind !== 'pick';
    at = 0;
    if (ask.kind === 'pick') {
      field.value = '';
      field.placeholder = '';
      draw(ask.items);
    } else {
      field.value = ask.value ?? '';
      field.placeholder = ask.placeholder ?? '';
    }
    scrim.hidden = false;
    field.focus();
    field.select();
  };

  field.oninput = () => { if (current?.kind === 'pick') { at = 0; draw(current.items); } };
  dialog.onsubmit = (event) => {
    event.preventDefault();
    if (!current) return;
    if (current.kind === 'input') answer(field.value);
    else if (shown.length) answer(shown[at]);
  };
  dialog.onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      answer(undefined);
      return;
    }
    if (current?.kind !== 'pick' || !shown.length) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    at = (at + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
    draw(current.items);
  };
  scrim.onclick = (event) => { if (!dialog.contains(event.target as Node)) answer(undefined); };

  const off = window.wangcai.subscribe('core:prompt', (data) => {
    const ask = data as Ask;
    if (current) queue.push(ask); else show(ask);
  });
  return () => {
    off();
    scrim.remove();
  };
}