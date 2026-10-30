import type { Profile } from '@lengmoxxl/sdk';

/** What init.ts holds under `leader`, `timeout`, `keys` and `commands`, as the shell read it out of the file.
 * The values are the user's own code, so nothing here is trusted beyond its shape. */
export interface KeymapInput { leader?: unknown; timeout?: unknown; keys?: unknown; commands?: unknown }

/** What a binding's script reaches: publish, request, open and send, the profile, and the binding's own args. */
export interface KeyContext {
  args?: unknown;
  profile: Profile;
  publish(event: string, data?: unknown): Promise<unknown>;
  request(id: string, method: string, params?: unknown): Promise<unknown>;
  send(topic: string, data?: unknown): void;
  open(url: string): Promise<unknown>;
}

/** One bound sequence as the window gets it: the keys in Neovim notation, what to draw for it, and whether it also
 * fires while a field has the keys (otherwise the field keeps them). */
export interface KeyBinding { keys: string; desc?: string; insert: boolean }

/** What the window matches against: the leader, how long a prefix waits, and every bound sequence, lowest precedence
 * first, so a later entry overrides an earlier one it repeats. */
export interface KeymapPayload { leader: string; timeout: number; bindings: KeyBinding[] }

/** The keymap: what the window is given, the way a matched sequence runs, and where a plugin's keys join and leave. */
export interface Keymap {
  payload(): KeymapPayload;
  run(sequence: string): Promise<void>;
  /** What one plugin brought with it, kept in a layer of its own. */
  add(owner: string, entries: unknown): void;
  /** Forgets what every plugin brought, which is where loading them again starts. */
  clear(): void;
}

type Action = { event: string; data?: unknown } | { run(context: KeyContext): unknown; args?: unknown };
type Entry = { desc?: string; insert: boolean; action: Action };

/** A space, as in Vim, unless init.ts names another key. */
const LEADER = ' ';
/** How long a partly typed sequence waits for its next key. */
const TIMEOUT = 800;

// A value a binding wrote that is meant to be an object: anything else is read as no fields at all.
const fieldsOf = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

// A command is a name init.ts bound in `commands`: the plugin layer passes none, so a plugin's keys bring events and
// scripts of their own rather than reach into the user's file.
function commandOf(name: string, commands: Record<string, unknown> | undefined) {
  const run = commands?.[name];
  return typeof run === 'function' ? run as (context: KeyContext) => unknown : undefined;
}

/**
 * One binding as it was written — an object naming an event, a command or a script — or nothing when no action can
 * be read from it, a command that does not resolve included; `layerOf` reports that case and the others.
 */
function entryOf(value: unknown, commands: Record<string, unknown> | undefined): Entry | undefined {
  const fields = fieldsOf(value);
  const run = typeof fields.run === 'function' ? fields.run as (context: KeyContext) => unknown
    : typeof fields.command === 'string' ? commandOf(fields.command, commands)
      : undefined;
  const action: Action | undefined = run ? { run, args: fields.args }
    : typeof fields.event === 'string' ? { event: fields.event, data: fields.data }
      : undefined;
  if (!action) return undefined;
  return { desc: typeof fields.desc === 'string' ? fields.desc : undefined, insert: fields.insert === true, action };
}

/** One layer of the keymap as it was written: a plugin names itself, so what it cannot read is reported with it. */
function layerOf(entries: unknown, commands: Record<string, unknown> | undefined, owner?: string) {
  const layer = new Map<string, Entry>();
  const label = owner ? `${owner} keymap` : 'Keymap';
  for (const [sequence, value] of Object.entries(fieldsOf(entries))) {
    const entry = entryOf(value, commands);
    if (entry) { layer.set(sequence, entry); continue; }
    // One diagnosis per binding, since `entryOf` reports nothing itself.
    const { command } = fieldsOf(value);
    const kinds = commands ? 'event, command or script' : 'event or script';
    if (typeof command !== 'string') console.error(`${label} ${sequence} names no ${kinds}`);
    else if (commands) console.error(`${label} ${sequence} names no command ${command}`);
    else console.error(`${label} ${sequence}: a plugin's keys name events and scripts, not commands`);
  }
  return layer;
}

/**
 * The keymap in three layers — the keys Core binds itself, the ones plugins carry, and init.ts's on top: among
 * sequences that come to the same presses, the user's is the one that runs. Scripts and commands run here rather
 * than in the window, in the process that holds the module they came from, so a binding can do anything it can.
 */
export function keymapOf(input: KeymapInput | undefined, calls: Omit<KeyContext, 'args'>, defaults: unknown): Keymap {
  const { leader, timeout, keys, commands } = fieldsOf(input);
  const named = fieldsOf(commands);
  const built = layerOf(defaults, named);
  const own = layerOf(keys, named);
  const borrowed = new Map<string, Entry>();
  const fire = async (sequence: string, entry: Entry) => {
    try {
      if ('event' in entry.action) await calls.publish(entry.action.event, entry.action.data);
      else await entry.action.run({ ...calls, args: entry.action.args });
    } catch (error) {
      console.error(`Keymap ${sequence}:`, error);
    }
  };
  return {
    payload: () => ({
      leader: typeof leader === 'string' && leader ? leader : LEADER,
      timeout: typeof timeout === 'number' && timeout > 0 ? timeout : TIMEOUT,
      bindings: [...built, ...borrowed, ...own].map(([sequence, entry]) => ({ keys: sequence, desc: entry.desc, insert: entry.insert })),
    }),
    async run(sequence) {
      const entry = own.get(sequence) ?? borrowed.get(sequence) ?? built.get(sequence);
      if (entry) await fire(sequence, entry);
    },
    add(owner, entries) {
      for (const [sequence, entry] of layerOf(entries, undefined, owner)) borrowed.set(sequence, entry);
    },
    clear() {
      borrowed.clear();
    },
  };
}
