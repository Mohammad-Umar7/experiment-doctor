/**
 * ANSI colours mapped to the design tokens. NO_COLOR always wins; FORCE_COLOR
 * forces; otherwise colour only on a TTY. 24-bit colour when the terminal
 * says it supports it, else the closest basic colour.
 */

export interface Palette {
  enabled: boolean;
  healthy(s: string): string;
  critical(s: string): string;
  warning(s: string): string;
  info(s: string): string;
  accent(s: string): string;
  muted(s: string): string;
  secondary(s: string): string;
  bold(s: string): string;
  dim(s: string): string;
}

type Rgb = [number, number, number];

const TOKENS: Record<string, { rgb: Rgb; basic: number }> = {
  healthy: { rgb: [0x22, 0xff, 0x88], basic: 92 },
  critical: { rgb: [0xff, 0x52, 0x63], basic: 91 },
  warning: { rgb: [0xf5, 0xb9, 0x42], basic: 93 },
  info: { rgb: [0x60, 0xa5, 0xfa], basic: 94 },
  accent: { rgb: [0x9b, 0x7b, 0xff], basic: 95 },
  muted: { rgb: [0x77, 0x81, 0x95], basic: 90 },
  secondary: { rgb: [0xa0, 0xa8, 0xb8], basic: 37 },
};

export function colorEnabled(env: Record<string, string | undefined>, isTTY: boolean | undefined): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return !!isTTY;
}

export function makePalette(env: Record<string, string | undefined>, isTTY: boolean | undefined): Palette {
  const enabled = colorEnabled(env, isTTY);
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? '') || !!env.WT_SESSION;
  const wrap = (open: string, close: string) => (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  const tone = (name: keyof typeof TOKENS) => {
    const t = TOKENS[name]!;
    return wrap(truecolor ? `38;2;${t.rgb.join(';')}` : String(t.basic), '39');
  };
  return {
    enabled,
    healthy: tone('healthy'),
    critical: tone('critical'),
    warning: tone('warning'),
    info: tone('info'),
    accent: tone('accent'),
    muted: tone('muted'),
    secondary: tone('secondary'),
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
  };
}

/** Visible length, ignoring ANSI escapes. */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}
