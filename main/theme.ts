import type { Theme } from '@lengmoxxl/sdk';

// The app's own dark palette: the shell writes these out as --wc-* and every plugin, the editor's markdown preview
// included, takes its colours from the same tokens.
const DARK: Theme = {
  background: '#191a1b',
  foreground: '#dce3eb',
  cursor: '#aeafad',
  selection: '#264f78',
  surface: '#1f2021',
  overlay: '#20242c',
  border: '#333536',
  muted: '#8b98a6',
  accent: '#3994bc',
  black: '#181818',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#e5c07b',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#3b4650',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#dcdcaa',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#d4d4d4',
};

// GitHub's own light palette, read out of @primer/primitives: the surfaces and text are its functional tokens, the
// sixteen colours its ansi scale, the cursor and selection what it gives CodeMirror. brightBlack takes ansi-gray rather
// than ansi-blackBright, which would draw the rules a transcript parts its turns with as near-black bars on white.
const GITHUB: Theme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selection: '#54aeff66',
  surface: '#f6f8fa',
  overlay: '#e6eaef',
  border: '#d1d9e0',
  muted: '#59636e',
  accent: '#0969da',
  black: '#1f2328',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#59636e',
  brightBlack: '#59636e',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#818b98',
};

/** The themes that ship, in the order a picker lists them. */
const BUILT_IN: Record<string, Theme> = { WangCai: DARK, GitHub: GITHUB };

function patch(base: Theme, given: unknown): Theme {
  const theme = { ...base };
  if (!given || typeof given !== 'object') return theme;
  for (const token of Object.keys(theme) as (keyof Theme)[]) {
    const value = (given as Record<string, unknown>)[token];
    if (typeof value === 'string' && value.trim()) theme[token] = value;
  }
  return theme;
}

export function themesOf(initTheme: unknown): Record<string, Theme> {
  const patches = initTheme && typeof initTheme === 'object' ? initTheme as Record<string, unknown> : {};
  const names = [...new Set([...Object.keys(BUILT_IN), ...Object.keys(patches)])];
  return Object.fromEntries(names.map((name) => [name, patch(BUILT_IN[name] ?? DARK, patches[name])]));
}
