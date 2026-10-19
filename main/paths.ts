/**
 * Where a run keeps what it writes and finds what it was shipped with: its data directory, and the resources
 * directory the shell carries the agent in. Neither is Core's to choose — a development run can be pointed
 * elsewhere — so both are handed over before it starts.
 */
export const paths = { storage: '', resources: '' };
