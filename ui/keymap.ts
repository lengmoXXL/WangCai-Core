import { call } from './bridge';
import type { KeymapPayload } from '../main/keymap';

/** One press: the modifiers held and the key they were held for, the way Neovim names it. */
interface Chord { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string }

/** A node of the keymap: what a prefix leads to, how the hint names and describes it, and — when a sequence ends
 * here — what to run. The label is empty only on the root, which is never shown as a press of its own. */
interface Node { children: Map<string, Node>; label: string; desc?: string; sequence?: string }

// What a `<...>` name stands for in the window: the key Nvim writes as CR, Esc or Space is what `event.key` calls
// Enter, Escape or a space.
const NAMES: Record<string, string> = {
  cr: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab',
  space: ' ', bs: 'Backspace', backspace: 'Backspace', del: 'Delete', delete: 'Delete',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert',
};
for (let at = 1; at <= 12; at += 1) NAMES[`f${at}`] = `F${at}`;

// A chord is what a trie is keyed by, so the same press written two ways has to read the same.
const chordKey = (chord: Chord) => `${Number(chord.ctrl)}${Number(chord.alt)}${Number(chord.shift)}${Number(chord.meta)}:${chord.key}`;

// Named keys are read without their case, and the leader is one of them.
const isLeader = (token: string) => token.toLowerCase() === 'leader';

/** The leader the main process settled on — a space unless init.ts names another — as the chord it stands for and
 * the name a hint shows for it. */
interface Leader { chord: Chord; label: string }

/**
 * One `<...>` token as a chord. Shift is carried by the character's case for a letter, as Neovim's is, and stays a
 * modifier only for a named key, whose name cannot show it.
 */
function chordOfToken(token: string): Chord | undefined {
  const chord: Chord = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  let rest = token;
  while (rest.length > 2 && rest[1] === '-') {
    const modifier = rest[0].toLowerCase();
    if (modifier === 'c') chord.ctrl = true;
    else if (modifier === 'a' || modifier === 'm') chord.alt = true;
    else if (modifier === 'd') chord.meta = true;
    else if (modifier === 's') chord.shift = true;
    else break;
    rest = rest.slice(2);
  }
  if (rest.length === 1) return { ...chord, shift: false, key: chord.shift && rest.toLowerCase() !== rest.toUpperCase() ? rest.toUpperCase() : rest };
  const named = NAMES[rest.toLowerCase()];
  return named ? { ...chord, key: named } : undefined;
}

/**
 * A binding as it is written: `<leader>ff`, `<C-S-p>` and `g g` all read as presses in a row. Whitespace only
 * separates; a space itself is `<Space>`, and a bare character is one press.
 */
function tokensOf(text: string) {
  const tokens: string[] = [];
  for (let at = 0; at < text.length;) {
    if (/\s/.test(text[at])) { at += 1; continue; }
    if (text[at] === '<') {
      const end = text.indexOf('>', at);
      if (end < 0) return [];
      tokens.push(text.slice(at + 1, end));
      at = end + 1;
      continue;
    }
    tokens.push(text[at]);
    at += 1;
  }
  return tokens;
}

// What the window shows a written token as: the character itself, or the name it was written with.
const labelOf = (token: string) => (token.length === 1 ? token : token.toUpperCase());

// The same for a chord that has no written form to show — the leader, whose label comes from its modifiers.
function chordLabel(chord: Chord) {
  const modifiers = `${chord.ctrl ? 'C-' : ''}${chord.alt ? 'A-' : ''}${chord.shift ? 'S-' : ''}${chord.meta ? 'D-' : ''}`;
  return `${modifiers}${chord.key === ' ' ? 'SPC' : labelOf(chord.key)}`;
}

// A leader this side cannot read is reported and left out, so the sequences that start with it are reported too.
function leaderOf(text: string): Leader | undefined {
  const token = text.startsWith('<') && text.endsWith('>') ? text.slice(1, -1) : text;
  const chord = chordOfToken(token);
  if (!chord) {
    console.error(`Keymap leader ${text}: cannot be read`);
    return undefined;
  }
  return { chord, label: chordLabel(chord) };
}

// The presses one written sequence stands for, with what to show for each in a pending hint.
function sequenceOf(text: string, leader: Leader | undefined) {
  const parts: { chord: Chord; label: string }[] = [];
  for (const token of tokensOf(text)) {
    if (isLeader(token)) {
      if (!leader) return undefined;
      parts.push(leader);
      continue;
    }
    const chord = chordOfToken(token);
    if (!chord) return undefined;
    parts.push({ chord, label: labelOf(token) });
  }
  return parts.length ? parts : undefined;
}

// The character a key sits on, by its base-layout name: macOS reports Option+f as `ƒ`, so a binding has to be
// able to name the key it is actually on.
const baseChar = (code: string) => code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : undefined;

// The presses one keydown could stand for, or nothing for a key that cannot be named.
function chordsOfEvent(event: KeyboardEvent): Chord[] {
  const { ctrlKey: ctrl, altKey: alt, metaKey: meta } = event;
  // `event.key` is the shifted character itself, so only the other modifiers are read here.
  if (event.key.length === 1) {
    const chord: Chord = { ctrl, alt, shift: false, meta, key: event.key };
    const base = alt ? baseChar(event.code) : undefined;
    return base && base !== event.key ? [chord, { ...chord, key: base }] : [chord];
  }
  if (event.key === 'Dead' || event.key === 'Unidentified' || event.key === 'Process') return [];
  return [{ ctrl, alt, shift: event.shiftKey, meta, key: event.key }];
}

// A press belongs to the field, not to the window, unless the binding asked for it there.
const isEditable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');

function trieOf(bindings: KeymapPayload['bindings'], leader: Leader | undefined) {
  const root: Node = { children: new Map(), label: '' };
  for (const binding of bindings) {
    const presses = sequenceOf(binding.keys, leader);
    if (!presses) { console.error(`Keymap ${binding.keys}: cannot be read`); continue; }
    let node = root;
    for (const { chord, label } of presses) {
      const key = chordKey(chord);
      let child = node.children.get(key);
      if (child) {
        // A later binding overrides one it repeats, its label included: the hint shows what would run.
        child.label = label;
      } else {
        node.children.set(key, child = { children: new Map(), label });
      }
      node = child;
    }
    node.sequence = binding.keys;
    node.desc = binding.desc;
  }
  return root;
}

/**
 * The window's side of the keymap: it matches presses against the sequences and hands a whole match back to
 * the main process, where the bindings run. A prefix that could still grow waits out the timeout before it is run
 * on its own, and while it waits a hint lists what the next key may be.
 */
export function bindKeys(config: KeymapPayload) {
  const leader = leaderOf(config.leader);
  // A field gets only the bindings that ask for it, so each case needs a trie of its own.
  const anywhere = trieOf(config.bindings, leader);
  const inField = trieOf(config.bindings.filter((binding) => binding.insert), leader);
  const hint = document.createElement('div');
  hint.className = 'which-key';
  hint.hidden = true;
  document.body.append(hint);
  let pending: { node: Node; path: string[] } | undefined;
  let timer = 0;
  const clear = () => {
    clearTimeout(timer);
    pending = undefined;
    hint.hidden = true;
  };
  const fire = (sequence: string) => {
    clear();
    void call('key', sequence).catch(console.error);
  };
  const paint = (node: Node, path: string[]) => {
    const head = document.createElement('div');
    head.className = 'which-key-head';
    head.textContent = path.join(' ');
    const rows = [...node.children.values()].map((child) => {
      const row = document.createElement('div');
      row.className = 'which-key-row';
      const kbd = document.createElement('kbd');
      kbd.textContent = child.label;
      const text = document.createElement('span');
      text.textContent = child.desc ?? child.sequence ?? '';
      row.append(kbd, text);
      return row;
    });
    hint.replaceChildren(head, ...rows);
    hint.hidden = false;
  };
  const step = (node: Node, path: string[]) => {
    clearTimeout(timer);
    pending = { node, path };
    const { sequence } = node;
    if (sequence !== undefined && !node.children.size) { fire(sequence); return; }
    // A node that both ends a sequence and leads to longer ones waits for the timeout, as Vim does with `g` and `gg`.
    timer = window.setTimeout(sequence === undefined ? clear : () => fire(sequence), config.timeout);
    paint(node, path);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.repeat) return;
    const candidates = chordsOfEvent(event).map(chordKey);
    if (!candidates.length) return;
    const current = pending;
    if (current && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear(); return; }
    // Only a first press is judged by where it landed: after that the sequence is already the window's.
    const children = current?.node.children ?? (isEditable(event.target) ? inField : anywhere).children;
    for (const pressed of candidates) {
      const next = children.get(pressed);
      if (!next) continue;
      event.preventDefault();
      event.stopPropagation();
      step(next, [...current?.path ?? [], next.label]);
      return;
    }
    // A press that continues nothing ends the sequence and is left to whatever wanted it.
    if (current) clear();
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => {
    clear();
    hint.remove();
    window.removeEventListener('keydown', onKeyDown, true);
  };
}
