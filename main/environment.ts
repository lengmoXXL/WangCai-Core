import type { ExecOptions, MachineConnection, MachineState, PtyOptions, Size } from '@lengmoxxl/sdk';

// A value that names a variable — `$HOME`, `${PATH}` — names one of the node's: the machine's values are the ones its
// commands run with, and on an ssh machine those are not the ones Core was started with.
const VARIABLE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

/**
 * A machine the way its commands see it: the variables it was configured with are handed to every session and every
 * process instead of to the node that runs them. A node started with them would keep them, so a changed value would
 * wait for a restart of the node; here the next command already has it. What a caller sets for one command wins, since
 * that is what it knows better.
 */
export function withEnvironment(machine: MachineConnection, configured: Record<string, string>): MachineConnection {
  const names = [...new Set(Object.values(configured).flatMap((value) => [...value.matchAll(VARIABLE)].map((match) => match[1])))];
  // Asked of the node, once, and only when some value names a variable.
  let asked: Promise<Record<string, string>> | undefined;
  const variables = () => asked ??= names.length ? expanded(machine, names, configured) : Promise.resolve(configured);
  const environment = async (given?: Record<string, string>) => ({ ...await variables(), ...given });
  // Plugins hold this in place of the node: the state and the streams are the node's own, and only what runs a
  // command is read through the environment here.
  return {
    get state() { return machine.state; },
    get port() { return machine.port; },
    ready: machine.ready,
    onState: (callback: (state: MachineState) => void) => machine.onState(callback),
    retain: () => machine.retain(),
    disconnect: () => machine.disconnect(),
    fs: machine.fs,
    pty: {
      list: machine.pty.list,
      cwd: machine.pty.cwd,
      attach: machine.pty.attach,
      close: machine.pty.close,
      create: async (size?: Size, options: PtyOptions = {}) => machine.pty.create(size, { ...options, env: await environment(options.env) }),
    },
    subprocess: {
      exec: async (program: string, args: string[], options: ExecOptions) => machine.subprocess.exec(program, args, { ...options, env: await environment(options.env) }),
      spawn: async (program: string, args: string[], options: ExecOptions) => machine.subprocess.spawn(program, args, { ...options, env: await environment(options.env) }),
      attach: machine.subprocess.attach,
      close: machine.subprocess.close,
    },
  } as unknown as MachineConnection;
}

/** The machine's values, with what each variable names replaced by what the node holds for it. */
async function expanded(machine: MachineConnection, names: string[], configured: Record<string, string>) {
  // The names are the ones a variable may be written with, so the shell only ever reads: what comes back is one
  // NUL-terminated value per name, in this order.
  const script = names.map((name) => `printf '%s\\0' "$${name}"`).join('; ');
  const { stdout } = await machine.subprocess.exec('/bin/sh', ['-c', script], { cwd: '/' });
  const values = new TextDecoder().decode(stdout).split('\0');
  const held = Object.fromEntries(names.map((name, index) => [name, values[index] ?? '']));
  return Object.fromEntries(Object.entries(configured).map(([name, value]) => [
    name, value.replace(VARIABLE, (_, variable: string) => held[variable] ?? ''),
  ]));
}