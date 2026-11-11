import { openMachine, type ConnectionOptions, type Machine, type MachineConnection } from '@lengmoxxl/sdk';
import type { Agents } from './agent';
import { withEnvironment } from './environment';

// One connection per machine for the whole app: a plugin that asks for a machine another plugin already
// holds gets that connection and counts as a holder of it, the last holder to disconnect closes it, and the
// entry goes with it. Asking while one is still opening waits for that one rather than opening a second.
const machines = new Map<string, MachineConnection>();
const opening = new Map<string, Promise<MachineConnection>>();

export async function connect(options: ConnectionOptions) {
  options.signal?.throwIfAborted();
  // What a machine asks its commands to run with is not part of opening the node: each command is handed it, so a
  // changed value needs no restart and one node per host serves machines that differ.
  const { env, ...connection } = options;
  const target = options.type === 'ssh' ? `ssh:${options.host}` : `local:${options.binary ?? 'wangcai'}`;
  const held = machines.get(target);
  if (held) {
    held.retain();
    return env ? withEnvironment(held, env) : held;
  }
  const joined = opening.get(target);
  const flight = joined ?? (async () => {
    const machine = await openMachine(connection);
    machines.set(target, machine);
    machine.onState((state) => { if (state.status === 'disconnected' && machines.get(target) === machine) machines.delete(target); });
    return machine;
  })();
  opening.set(target, flight);
  try {
    const machine = await flight;
    if (joined) machine.retain();
    return env ? withEnvironment(machine, env) : machine;
  } finally {
    if (!joined) opening.delete(target);
  }
}

/** How a machine is named where one is asked for — a plugin's `connect`, a binding's `exec` — read as the connection it
 * takes: an ssh host, or the machine Core runs on, with the agent put there first where it is missing. */
export const connectorOf = (agents: Agents) => async (machine: Pick<Machine, 'host' | 'env'>, signal?: AbortSignal) => connect(machine.host
  ? { type: 'ssh', host: machine.host, agent: agents.ssh, env: machine.env, signal }
  : { type: 'local', binary: await agents.local(), env: machine.env, signal });
