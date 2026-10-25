import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// What an agent reads of the shell, which ships it: the docs, the SDK and the window's own source.
const SHIPPED = ['docs', 'sdk', 'examples', 'README.md', 'desktop/main', 'desktop/build/icon.png'];
// What it reads of this repository: the clone the shell installed under `plugins/core`.
const CORE = ['main', 'ui'];

/**
 * Copies the sources an agent reads into the data directory. The revision is part of the stamp: these files
 * change when Core is rebuilt, which the shell's version alone does not show.
 */
export function syncSources(shipped: string, storage: string, version: string) {
  const directory = join(storage, 'src');
  const stamp = join(storage, 'src.version');
  const built = join(storage, 'plugins/core/dist/commit');
  const revision = existsSync(built) ? readFileSync(built, 'utf8').trim() : '';
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === `${version} ${revision}`) return;
  rmSync(directory, { recursive: true, force: true });
  for (const entry of SHIPPED) cpSync(join(shipped, entry), join(directory, entry), { recursive: true });
  for (const entry of CORE) cpSync(join(storage, 'plugins/core', entry), join(directory, 'core', entry), { recursive: true });
  writeFileSync(stamp, `${version} ${revision}`);
}
