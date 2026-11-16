import type { Theme } from '@lengmoxxl/sdk';

// The one default theme the whole app reads: the shell writes these out as --wc-* and every plugin, the editor's
// markdown preview included, takes its colours from the same tokens. init.ts may override any of them.
export const DEFAULT_THEME: Theme = {
  background: '#191a1b',
  foreground: '#dce3eb',
  cursor: '#aeafad',
  selection: '#264f78',
  surface: '#1f2021',
  overlay: '#303132',
  border: '#333536',
  muted: '#8b98a6',
  accent: '#3994bc',
  black: '#181818',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#dcdcaa',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#dcdcaa',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#d4d4d4',
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