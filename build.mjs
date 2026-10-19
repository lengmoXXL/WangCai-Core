import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import esbuild from 'esbuild';
import { build } from 'vite';

const source = import.meta.dirname;

// The main realm: one bundle the shell loads and calls, with everything it needs inside, so the app never
// carries this repository's dependencies. The optional natives ws reaches for stay out: it runs without them.
await esbuild.build({
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: 'linked',
  absWorkingDir: source, entryPoints: ['main/index.ts'], outfile: join(source, 'dist/main.cjs'),
  external: ['bufferutil', 'utf-8-validate'],
});

// The window: the page, its scripts and its stylesheet, which the shell serves under its own scheme.
await build({
  root: join(source, 'ui'),
  build: { outDir: join(source, 'dist/ui'), emptyOutDir: true },
});

// What the shell compares a Core it built itself against: a build outside a repository leaves none.
const head = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const revision = head();
writeFileSync(join(source, 'dist/commit'), revision ? `${revision}\n` : '');
