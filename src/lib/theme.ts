import type { Theme } from './types';

const HEX_RE = /#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FUNC_RE = /(?:rgb|rgba|hsl|hsla|oklch|lab)\(\s*([^)]+?)\s*\)/gi;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return `#${[r, g, b]
    .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function normalizeColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/#[0-9a-f]{4,8}$/.exec(v)) {
    const hex = v;
    if (hex.length === 4) return `#${hex.slice(1).split('').map((c) => c + c).join('')}`;
    if (hex.length === 5) return `#${hex.slice(1, -1).split('').map((c) => c + c).join('')}`;
    if (hex.length === 7) return hex;
    if (hex.length === 9) return hex.slice(0, 7);
    return hex;
  }
  if (/^(rgb|rgba|hsl|hsla)\(/.exec(v)) {
    const inner = v.slice(v.indexOf('(') + 1, v.lastIndexOf(')'));
    const parts = inner.split(/[,\s/]+/).filter(Boolean);
    if (/^(rgb|rgba)$/.exec(v.slice(0, 3))) {
      const r = clamp(Math.round(Number(parts[0])), 0, 255);
      const g = clamp(Math.round(Number(parts[1])), 0, 255);
      const b = clamp(Math.round(Number(parts[2])), 0, 255);
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    }
    const h = Number(parts[0]);
    const sRaw = parts[1];
    const lRaw = parts[2];
    const s = sRaw && sRaw.endsWith('%') ? Number(sRaw.slice(0, -1)) / 100 : Number(sRaw);
    const l = lRaw && lRaw.endsWith('%') ? Number(lRaw.slice(0, -1)) / 100 : Number(lRaw);
    return hslToHex(h, s, l);
  }
  const named = new Map<string, string>([
    ['white', '#ffffff'],
    ['black', '#000000'],
    ['red', '#ff0000'],
    ['green', '#00ff00'],
    ['blue', '#0000ff'],
    ['cyan', '#00ffff'],
    ['magenta', '#ff00ff'],
    ['yellow', '#ffff00'],
    ['gray', '#808080'],
    ['grey', '#808080'],
  ]);
  return named.get(v) ?? null;
}

function collectRootVariables(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rootRe = /(?:^|[}])([^{]*)\{([^}]*:root[^}]*)\}|\:root\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rootRe.exec(css))) {
    const body = m[3] ?? m[2] ?? '';
    for (const line of body.split(';')) {
      const varRe = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+)/.exec(line);
      if (varRe && varRe[1] && varRe[2]) {
        out[varRe[1]] = varRe[2].trim();
      }
    }
  }
  return out;
}

export function extractThemeFromCss(files: { path: string; text: string }[]): Theme {
  const cssTexts = files
    .filter((f) => f.path.endsWith('.css'))
    .map((f) => f.text);

  const variables: Record<string, string> = {};
  for (const css of cssTexts) {
    Object.assign(variables, collectRootVariables(css));
  }

  const counts = new Map<string, number>();
  const add = (c: string | null | undefined) => {
    if (!c) return;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  };

  const varColors = Object.values(variables).map((v) => normalizeColor(v)).filter(Boolean) as string[];
  for (const v of varColors) add(v);

  for (const css of cssTexts) {
    for (const m of css.matchAll(HEX_RE)) add(normalizeColor(m[0]));
    for (const m of css.matchAll(FUNC_RE)) add(normalizeColor(m[0]));
  }

  const fallback: string[] = ['#d4ff3f', '#0a0c10'];
  const colors = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c]) => c);

  const merged = colors.length >= 3 ? colors : [...colors, ...fallback].slice(0, 6);
  return { colors: merged, variables };
}

export function themeCssVars(theme: Theme): string {
  const parts: string[] = [];
  theme.colors.forEach((c, i) => parts.push(`--plc${i}: ${c}`));
  for (const [k, v] of Object.entries(theme.variables)) {
    if (!k.startsWith('--')) continue;
    if (partReject(v)) continue;
    parts.push(`${k}: ${v}`);
  }
  return parts.join(';');
}

function partReject(v: string): boolean {
  return /[{};]/.test(v) || v.length > 240;
}