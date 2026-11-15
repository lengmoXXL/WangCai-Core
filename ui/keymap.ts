import { bindTries, isEditable, readStroke, triesOf, type Tries, type TrieNode } from '@lengmoxxl/sdk/keys';
import { call } from './bridge';
import type { KeyBinding, KeymapPayload } from '../main/keymap';

// The page is focused, and told it is on show: a plugin that keeps a text field in it answers by focusing that field, so
// the keys land where typing goes instead of on the page around it.
export const handKeysTo = (page?: HTMLElement) => {
  if (!page) return;
  page.focus();
  page.dispatchEvent(new CustomEvent('wangcai:shown'));
};

// A plugin can be drawn in the main pane or in a sidebar tab, so the page that takes the keys is the one of it that is
// not hidden.
export const visiblePageOf = (plugin: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-plugin="${plugin}"]`)].find((element) => !element.hidden);

/** A binding of the window's keymap, with what a matched one runs: the id is handed back to the main process. */
type RunnableBinding = KeyBinding & { run(): void };

// The page a key event's target sits in, if any: a plugin's own container or one of its sidebar panels.
const pageOf = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-plugin]') : null;

/**
 * The window's keymap. It picks the keys a press is judged by — the global ones, and inside a page those plus the local
 * keys that answer there — and hands a whole match back to the main process, where the bindings run; the matching itself
 * is the SDK's. A field or a terminal is judged by the same keys as the page around it. While a prefix waits a hint lists
 * what the next key may be. Ctrl+Shift+Q leaves the field; an Escape on its own still belongs to whatever the field holds,
 * however many times it is pressed, so that a field which is also an editor is not left without the keyboard by a reader
 * leaving the insert mode — unless a prefix is waiting, which that Escape cancels.
 */
export function bindWindowKeys(config: KeymapPayload, corner: HTMLElement) {
  const leader = readStroke(config.leader);
  if (!leader) console.error(`Keymap leader ${config.leader}: cannot be read`);
  const entries: RunnableBinding[] = config.bindings.map((binding) => ({
    ...binding,
    run: () => { void call('key', binding.id).catch(console.error); },
  }));
  // A global entry answers everywhere; a local one only inside a page, and only when it names no plugin or names this one.
  const answersIn = (entry: RunnableBinding, plugin?: string) =>
    entry.scope === 'global' || (plugin !== undefined && (entry.plugin === undefined || entry.plugin === plugin));
  const globals = entries.filter((entry) => answersIn(entry));
  const globalTries = triesOf(globals, { leader, fields: 'all' });
  // A page's tries are built the first time it is pressed in and kept for the rest of the session.
  const pages = new Map<string, Tries<RunnableBinding>>();
  const pageTries = (plugin: string) => {
    let tries = pages.get(plugin);
    if (!tries) {
      const local = entries.filter((entry) => entry.scope === 'local' && answersIn(entry, plugin));
      tries = triesOf([...globals, ...local], { leader, fields: 'all' });
      pages.set(plugin, tries);
    }
    return tries;
  };
  // The page whose keys the last press was judged by, which is the page a prefix's lines are read for too.
  let answering: string | undefined;
  const triesFor = (event: KeyboardEvent) => {
    answering = pageOf(event.target)?.dataset.plugin;
    return answering === undefined ? globalTries : pageTries(answering);
  };
  // The engine reads a sequence into the labels the hint is told, so `<leader>` and every other spelling land alike.
  // One binding's trie is a single chain, which is that binding's path.
  const labelsOf = (keys: string) => {
    let node = triesOf([{ keys, run: () => {} }], { leader }).outside;
    const labels: string[] = [];
    while (node.children.size) {
      node = node.children.values().next().value!;
      labels.push(node.label);
    }
    return labels;
  };
  // Only the prefix lines are kept here, since the binding's own line is drawn on its row. The lines sit at the end of
  // the path, so a shorter array leaves the levels above it unnamed.
  const notes = entries.flatMap((entry) => {
    const lines = Array.isArray(entry.desc) ? entry.desc.slice(0, -1) : [];
    if (!lines.length) return [];
    const labels = labelsOf(entry.keys);
    return lines.flatMap((desc, index) => {
      const level = labels.length - lines.length + index;
      return desc && level >= 1 ? [{ path: labels.slice(0, level), desc, entry }] : [];
    });
  });
  /** Every line written for one prefix by a layer that answers here, so `g` can be git and goto at once. */
  const namesAt = (labels: string[]) => {
    const path = labels.join(' ');
    return [...new Set(notes
      .filter((note) => note.path.join(' ') === path && answersIn(note.entry, answering))
      .map((note) => note.desc))].join(' · ');
  };
  const hint = document.createElement('div');
  hint.className = 'which-key';
  hint.hidden = true;
  corner.append(hint);
  const onPrefix = (node: TrieNode<RunnableBinding> | undefined, labels: string[]) => {
    if (!node) { hint.hidden = true; return; }
    const head = document.createElement('div');
    head.className = 'which-key-head';
    head.textContent = labels.join(' ');
    const names = namesAt(labels);
    const group = document.createElement('div');
    group.className = 'which-key-group';
    group.textContent = names;
    group.hidden = !names;
    const rows = [...node.children.values()].map((child) => {
      const row = document.createElement('div');
      row.className = 'which-key-row';
      const kbd = document.createElement('kbd');
      kbd.textContent = child.label;
      const text = document.createElement('span');
      // A key that only leads on is named by the lines written for it as a prefix.
      const desc = child.binding?.desc;
      const own = Array.isArray(desc) ? desc[desc.length - 1] : desc;
      text.textContent = own || namesAt([...labels, child.label]) || child.binding?.keys || '';
      row.append(kbd, text);
      return row;
    });
    hint.replaceChildren(head, group, ...rows);
    hint.hidden = false;
  };
  const onBefore = (event: KeyboardEvent, waiting: boolean) => {
    // Leaving the field is a shortcut rather than an Escape: macOS does not deliver an Escape held with Cmd to a window, so
    // that press cannot be the one that leaves. A letter with two modifiers does arrive.
    const leaving = isEditable(event) && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'q';
    if (!leaving && !(waiting && event.key === 'Escape')) return false;
    // The page is not told it is on show: that would send the keys back into the field this press is leaving.
    if (leaving) pageOf(event.target)?.focus();
    return true;
  };
  const unbind = bindTries(document.documentElement, triesFor, { prefix: onPrefix, before: onBefore, timeout: config.timeout });
  return () => {
    unbind();
    hint.remove();
  };
}
