import type { Theme } from '@lengmoxxl/sdk';

// The one default theme the whole app reads: the shell writes these out as --wc-* and every plugin, the editor's
// markdown preview included, takes its colours from the same tokens. init.ts may override any of them.
export const DEFAULT_THEME: Theme = {
  background: '#121314',
  foreground: '#dce3eb',
  cursor: '#9bc7bc',
  selection: '#35534e',
  surface: '#191a1b',
  overlay: '#2c2d2e',
  border: '#333536',
  muted: '#8b98a6',
  accent: '#3994bc',
  black: '#26303a',
  red: '#e68c8c',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#719ad1',
  magenta: '#c792ea',
  cyan: '#5fc9dd',
  white: '#d9e0e9',
  brightBlack: '#3b4650',
  brightRed: '#f0a8a8',
  brightGreen: '#b8ddd3',
  brightYellow: '#f0d5a6',
  brightBlue: '#a6c3ea',
  brightMagenta: '#dbb8e8',
  brightCyan: '#a9dbe0',
  brightWhite: '#eef3f8',
};

// The protocol hands this over as plain data; the token names and their defaults live here, so Core is the one place
// that reads a value out of it. A token init.ts leaves out, or writes as a non-string, keeps the default.
export function mergeTheme(given?: Record<string, unknown>): Theme {
  const theme = { ...DEFAULT_THEME };
  for (const token of Object.keys(theme) as (keyof Theme)[]) {
    const value = given?.[token];
    if (typeof value === 'string' && value.trim()) theme[token] = value;
  }
  return theme;
}