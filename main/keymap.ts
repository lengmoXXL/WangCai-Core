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

/** Where a binding fires: `local` fires only while the focus sits inside a plugin's page, `global` fires wherever the
 * focus is. A binding that also fires while a field has the keys says `insert: true`. */
type KeyScope = 'local' | 'global';

/** One bound sequence as the window gets it: the id it is run by, the keys in Neovim notation, what to draw for it,
 * whether it also fires while a field has the keys, and where it is allowed to fire. */
export interface KeyBinding {
  id: string; keys: string; desc?: string; insert: boolean; scope: KeyScope;
  /** For a local binding, the page it belongs to; with no plugin named it answers in any page, which is what init.ts
   * writes. A global binding names no page. */
  plugin?: string;
}

/** What the window matches against: the leader, how long a prefix waits, and every bound sequence, with the layers in
 * the order they were written. */
export interface KeymapPayload { leader: string; timeout: number; bindings: KeyBinding[] }

/** The keymap: what the window is given, how a binding is run by id, and where a plugin's keys join and leave. */
export interface Keymap {
  payload(): KeymapPayload;
  run(id: string): Promise<void>;
  /** What one plugin brought with it, kept in a layer of its own. */
  add(owner: string, entries: unknown): void;
  /** Forgets what every plugin brought, which is where loading them again starts. */
  clear(): void;
}

type Action = { event: string; data?: unknown } | { run(context: KeyContext): unknown; args?: unknown };
/** The parts one binding's fields give: what to draw, whether it also fires in a field, and the action. */
type Written = { desc?: string; insert: boolean; action: Action };
type Entry = { binding: KeyBinding; action: Action };

/** A space, as in Vim, unless init.ts names another key. */
const LEADER = ' ';
/** How long a partly typed sequence waits for its next key. */
const TIMEOUT = 800;

// A value written for a binding that is meant to be an object: anything else is read as no fields at all.
const fieldsOf = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

// A command is a name init.ts bound in `commands`: the plugin layer passes none, so a plugin's keys bring events and
// scripts of their own rather than name a command from the user's file.
function commandOf(name: string, commands: Record<string, unknown> | undefined) {
  const run = commands?.[name];
  return typeof run === 'function' ? run as (context: KeyContext) => unknown : undefined;
}

/**
 * The action one binding's fields name — an event, a command or a script — or nothing when they name none, including a
 * command that does not resolve; `layerOf` reports each such failure by name.
 */
function entryOf(fields: Record<string, unknown>, commands: Record<string, unknown> | undefined): Written | undefined {
  const run = typeof fields.run === 'function' ? fields.run as (context: KeyContext) => unknown
    : typeof fields.command === 'string' ? commandOf(fields.command, commands)
      : undefined;
  const action: Action | undefined = run ? { run, args: fields.args }
    : typeof fields.event === 'string' ? { event: fields.event, data: fields.data }
      : undefined;
  if (!action) return undefined;
  return { desc: typeof fields.desc === 'string' ? fields.desc : undefined, insert: fields.insert === true, action };
}

/**
 * One layer of the keymap as it was written. A binding it cannot read is reported under `owner`, which the caller
 * names: `core keymap …` or `<plugin> keymap …`.
 * `scope` is the scope a binding takes from its layer, and `global: true` can lift it to global; nothing lowers it
 * back to local.
 */
function layerOf(entries: unknown, commands: Record<string, unknown> | undefined, options: { owner?: string; scope: KeyScope }) {
  const layer: Entry[] = [];
  const label = options.owner ? `${options.owner} keymap` : 'Keymap';
  for (const [sequence, value] of Object.entries(fieldsOf(entries))) {
    const fields = fieldsOf(value);
    const written = entryOf(fields, commands);
    if (written) {
      const scope = fields.global === true ? 'global' : options.scope;
      const id = `${options.owner ?? 'init.ts'}/${sequence}`;
      layer.push({
        binding: { id, keys: sequence, desc: written.desc, insert: written.insert, scope, plugin: scope === 'local' ? options.owner : undefined },
        action: written.action,
      });
      continue;
    }
    // One diagnosis per binding, since `entryOf` reports nothing itself.
    const { command } = fields;
    const kinds = commands ? 'event, command or script' : 'event or script';
    if (typeof command !== 'string') console.error(`${label} ${sequence} names no ${kinds}`);
    else if (commands) console.error(`${label} ${sequence} names no command ${command}`);
    else console.error(`${label} ${sequence}: a plugin's keys name events and scripts, not commands`);
  }
  return layer;
}

/**
 * The keymap in three layers — the keys Core binds itself, the ones plugins carry, and init.ts's — where a later
 * layer overrides the layers below it within the same scope, while a local binding wins over a global one.
 * Scripts and commands run here rather than in the window, in the process that holds the module they came from, so a
 * script can use anything that module can.
 */
export function keymapOf(input: KeymapInput | undefined, calls: Omit<KeyContext, 'args'>, defaults: unknown): Keymap {
  const { leader, timeout, keys, commands } = fieldsOf(input);
  const named = fieldsOf(commands);
  const built = layerOf(defaults, named, { owner: 'core', scope: 'global' });
  const own = layerOf(keys, named, { scope: 'local' });
  const borrowed: Entry[] = [];
  // A sequence bound twice within one scope is settled by this order; which scope answers is the window's call.
  const layers = () => [...built, ...borrowed, ...own];
  const fire = async (entry: Entry) => {
    try {
      if ('event' in entry.action) await calls.publish(entry.action.event, entry.action.data);
      else await entry.action.run({ ...calls, args: entry.action.args });
    } catch (error) {
      console.error(`Keymap ${entry.binding.keys}:`, error);
    }
  };
  return {
    payload: () => ({
      leader: typeof leader === 'string' && leader ? leader : LEADER,
      timeout: typeof timeout === 'number' && timeout > 0 ? timeout : TIMEOUT,
      bindings: layers().map((entry) => entry.binding),
    }),
    async run(id) {
      // The window matched this binding and handed over its id; running it here runs a script in the same process as
      // the module it came from, and publishes an event from this process.
      const entry = layers().find((candidate) => candidate.binding.id === id);
      if (entry) await fire(entry);
    },
    add(owner, entries) {
      borrowed.push(...layerOf(entries, undefined, { owner, scope: 'local' }));
    },
    clear() {
      borrowed.length = 0;
    },
  };
}
