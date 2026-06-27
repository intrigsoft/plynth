/**
 * Shared project text-styles for all Plynth diagram editors.
 *
 * Styles are project-wide (localStorage key `plynth.textstyles`) and configured
 * from the project view. Each text node stores only a `styleId` referencing one
 * of these styles. Ported from the design-source `PlynthTextStyles` library to a
 * plain ES module (no `window.*` globals).
 */
import type { CSSProperties } from 'react';

/** The six built-in text-style ids. A text node references a style by one of these. */
export type TextStyleId = 'title' | 'heading' | 'sub1' | 'sub2' | 'body' | 'caption';

/** The seven selectable font-family keys. */
export type FontKey = 'sans' | 'arial' | 'verdana' | 'georgia' | 'times' | 'courier' | 'mono';

/** A selectable font family. `cw` is the average character-width ratio used by {@link measureText}. */
export interface FontFamily {
  key: FontKey;
  name: string;
  /** CSS `font-family` stack. */
  stack: string;
  /** Average glyph width as a fraction of the font size (for box estimation). */
  cw: number;
}

/** A single shared text style. */
export interface TextStyle {
  id: TextStyleId;
  name: string;
  desc: string;
  font: FontKey;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Hex color string, e.g. `#1b2230`. */
  color: string;
}

/** Estimated rendered box for a text node. */
export interface TextMeasure {
  w: number;
  h: number;
}

const STORAGE_KEY = 'plynth.textstyles';

/** The seven font-family options, in display order. */
export const FONT_FAMILIES: FontFamily[] = [
  { key: 'sans', name: 'Hanken Grotesk', stack: "'Hanken Grotesk',system-ui,sans-serif", cw: 0.55 },
  { key: 'arial', name: 'Arial', stack: 'Arial,Helvetica,sans-serif', cw: 0.55 },
  { key: 'verdana', name: 'Verdana', stack: 'Verdana,Geneva,sans-serif', cw: 0.63 },
  { key: 'georgia', name: 'Georgia', stack: 'Georgia,serif', cw: 0.52 },
  { key: 'times', name: 'Times New Roman', stack: "'Times New Roman',Times,serif", cw: 0.48 },
  { key: 'courier', name: 'Courier New', stack: "'Courier New',Courier,monospace", cw: 0.6 },
  { key: 'mono', name: 'JetBrains Mono', stack: "'JetBrains Mono',monospace", cw: 0.62 },
];

/** Font-key → {@link FontFamily} lookup. */
export const FONTS: Record<FontKey, FontFamily> = FONT_FAMILIES.reduce(
  (map, f) => {
    map[f.key] = f;
    return map;
  },
  {} as Record<FontKey, FontFamily>,
);

/** The eight preset text colors offered as swatches. */
export const TEXT_COLORS: string[] = [
  '#1b2230',
  '#5b6678',
  '#4f46e5',
  '#2563eb',
  '#0e9488',
  '#b45309',
  '#dc2626',
  '#7c3aed',
];

/** Fallback style id used when a referenced style is missing. */
export const DEFAULT_STYLE_ID: TextStyleId = 'body';

/** The six default text styles (used until the user customizes them). */
export const DEFAULT_TEXT_STYLES: TextStyle[] = [
  { id: 'title', name: 'Title', desc: 'Large title for a diagram or board', font: 'sans', size: 32, bold: true, italic: false, underline: false, color: '#1b2230' },
  { id: 'heading', name: 'Heading', desc: 'Section heading', font: 'sans', size: 26, bold: true, italic: false, underline: false, color: '#1b2230' },
  { id: 'sub1', name: 'Subheader 1', desc: 'Primary subheading', font: 'sans', size: 22, bold: true, italic: false, underline: false, color: '#2a3344' },
  { id: 'sub2', name: 'Subheader 2', desc: 'Secondary subheading', font: 'sans', size: 18, bold: false, italic: false, underline: false, color: '#2a3344' },
  { id: 'body', name: 'Body', desc: 'Default annotation text', font: 'sans', size: 16, bold: false, italic: false, underline: false, color: '#1b2230' },
  { id: 'caption', name: 'Caption', desc: 'Small caption / note', font: 'sans', size: 13, bold: false, italic: false, underline: false, color: '#5b6678' },
];

/** Deep-clone the defaults so callers can mutate freely. */
function cloneDefaults(): TextStyle[] {
  return DEFAULT_TEXT_STYLES.map((s) => ({ ...s }));
}

/** Load the project's text styles from localStorage, falling back to defaults. */
export function loadTextStyles(): TextStyle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a) && a.length) return a as TextStyle[];
    }
  } catch {
    /* ignore malformed storage */
  }
  return cloneDefaults();
}

/** Persist the project's text styles to localStorage. */
export function saveTextStyles(styles: TextStyle[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

/** Resolve a style by id, falling back to the default style, then the first, then the body default. */
export function textStyleById(styles: TextStyle[] | undefined, id: string): TextStyle {
  const list = styles || [];
  return (
    list.find((s) => s.id === id) ||
    list.find((s) => s.id === DEFAULT_STYLE_ID) ||
    list[0] ||
    DEFAULT_TEXT_STYLES[4]
  );
}

/** The CSS `font-family` stack for a style. */
export function fontStack(style: TextStyle): string {
  return (FONTS[style.font] || FONTS.sans).stack;
}

/** React inline-style properties for rendering a text node in this style (the `typeCss` equivalent). */
export function textStyleCss(style: TextStyle): CSSProperties {
  return {
    fontStyle: style.italic ? 'italic' : 'normal',
    fontWeight: style.bold ? 700 : 400,
    fontSize: style.size,
    fontFamily: fontStack(style),
    color: style.color,
    textDecoration: style.underline ? 'underline' : 'none',
  };
}

/** Estimate the rendered box (width/height in px) for a text node. */
export function measureText(name: string | null | undefined, style: TextStyle): TextMeasure {
  const fs = style.size;
  const cw = (FONTS[style.font] || FONTS.sans).cw;
  const lines = String(name == null ? 'Text' : name).split('\n');
  let maxLen = 0;
  for (const l of lines) maxLen = Math.max(maxLen, (l || '').length);
  const w = Math.max(54, Math.min(560, Math.round(maxLen * fs * cw) + 18));
  const h = Math.max(fs + 14, lines.length * Math.round(fs * 1.35) + 10);
  return { w, h };
}
