import type { CSSProperties } from 'react';
import type { CampMajorLevel } from '../data/campReportCatalog';

export interface CampReportPalette {
  accent: string;
  accentSoft: string;
  accentStrong: string;
  ink: string;
  paper: string;
  panel: string;
  border: string;
  moduleWarm: string;
  moduleCool: string;
  moduleWarmBorder: string;
  moduleCoolBorder: string;
  highlight: string;
}

export interface CampReportTheme {
  majorCamp: CampMajorLevel;
  logoImage: string;
  visualStyle: 'standard' | 'racing';
  palette: CampReportPalette;
}

export interface CampReportThemeConfig {
  majorCamp: string;
  logoImage: string;
  palette: CampReportPalette;
  source: 'default' | 'logo' | 'image' | 'manual';
  updatedAt: number;
}

export const CAMP_THEME_UPDATED_EVENT = 'amber:camp-theme-updated';

const L3_LOGO_TRANSPARENT = '/assets/public-placeholder.svg';
const L3_LOGO_LEGACY_JPG = '/assets/public-placeholder.svg';

const DEFAULT_LOGO_BY_MAJOR: Partial<Record<CampMajorLevel, string>> = {
  L0: '/assets/public-placeholder.svg',
  'L1大': '/assets/public-placeholder.svg',
  'L1小': '/assets/public-placeholder.svg',
  L2: '/assets/public-placeholder.svg',
  L3: L3_LOGO_TRANSPARENT,
  L4: '/assets/public-placeholder.svg',
  S: '/assets/public-placeholder.svg',
};

const DEFAULT_VISUAL_STYLE_BY_MAJOR: Partial<Record<CampMajorLevel, CampReportTheme['visualStyle']>> = {
  L0: 'racing',
  'L1大': 'racing',
  'L1小': 'racing',
  L2: 'racing',
  L3: 'racing',
  L4: 'racing',
  S: 'racing',
};

export const DEFAULT_CAMP_PALETTE_BY_MAJOR: Record<CampMajorLevel, CampReportPalette> = {
  L0: {
    accent: '#66C7E9',
    accentSoft: '#E9F8FF',
    accentStrong: '#2B93C8',
    ink: '#1B425D',
    paper: '#FFF7FB',
    panel: '#FFFEFA',
    border: '#B8E2F2',
    moduleWarm: '#FFE3F1',
    moduleCool: '#DCF5FF',
    moduleWarmBorder: '#F3B7D4',
    moduleCoolBorder: '#9ED9F0',
    highlight: '#F68FC9',
  },
  'L1大': {
    accent: '#E8212B',
    accentSoft: '#FFF0E3',
    accentStrong: '#B81520',
    ink: '#241713',
    paper: '#FFF7DA',
    panel: '#FFFDF4',
    border: '#EBC59A',
    moduleWarm: '#FFE0BC',
    moduleCool: '#DCECFB',
    moduleWarmBorder: '#F4B57C',
    moduleCoolBorder: '#93C4E8',
    highlight: '#FFD43D',
  },
  'L1小': {
    accent: '#F39AC9',
    accentSoft: '#FFF0F8',
    accentStrong: '#D65A9B',
    ink: '#423247',
    paper: '#FFF7FC',
    panel: '#FFFEFB',
    border: '#EAC2D8',
    moduleWarm: '#FFE1F0',
    moduleCool: '#DDF5FF',
    moduleWarmBorder: '#F2A8CF',
    moduleCoolBorder: '#9DD9ED',
    highlight: '#FFE952',
  },
  L2: {
    accent: '#43A758',
    accentSoft: '#F2FFD8',
    accentStrong: '#159257',
    ink: '#164A35',
    paper: '#F6FFD7',
    panel: '#FFFEF1',
    border: '#E7D98E',
    moduleWarm: '#FFE38A',
    moduleCool: '#D8F5B3',
    moduleWarmBorder: '#E5C861',
    moduleCoolBorder: '#BBDD7A',
    highlight: '#FFE45A',
  },
  L3: {
    accent: '#E84134',
    accentSoft: '#FFF0E6',
    accentStrong: '#B91B24',
    ink: '#101820',
    paper: '#FFF8E8',
    panel: '#FFFDF7',
    border: '#EBC3B1',
    moduleWarm: '#FFE0D0',
    moduleCool: '#E1EBFF',
    moduleWarmBorder: '#F2AA92',
    moduleCoolBorder: '#9DB7E8',
    highlight: '#FFE34D',
  },
  L4: {
    accent: '#C91F2D',
    accentSoft: '#FFF0EF',
    accentStrong: '#8E1420',
    ink: '#181211',
    paper: '#FFF6F1',
    panel: '#FFFDF8',
    border: '#E3B8B6',
    moduleWarm: '#FDE1E2',
    moduleCool: '#F4F3EF',
    moduleWarmBorder: '#E99499',
    moduleCoolBorder: '#CBC7BE',
    highlight: '#F8D84A',
  },
  S: {
    accent: '#69D8EA',
    accentSoft: '#F0E9FF',
    accentStrong: '#1264C4',
    ink: '#123F75',
    paper: '#F4FBFF',
    panel: '#FFFEFB',
    border: '#B8D8F5',
    moduleWarm: '#EEE4FF',
    moduleCool: '#DDF9FF',
    moduleWarmBorder: '#C7B4F3',
    moduleCoolBorder: '#96D9EA',
    highlight: '#FFE236',
  },
};

export function getDefaultCampTheme(majorCamp: CampMajorLevel): CampReportTheme {
  return {
    majorCamp,
    logoImage: DEFAULT_LOGO_BY_MAJOR[majorCamp] || '',
    visualStyle: DEFAULT_VISUAL_STYLE_BY_MAJOR[majorCamp] || 'standard',
    palette: DEFAULT_CAMP_PALETTE_BY_MAJOR[majorCamp] || DEFAULT_CAMP_PALETTE_BY_MAJOR.L0,
  };
}

export function normalizeCampLogoImage(majorCamp: CampMajorLevel, logoImage: string | undefined, fallbackLogoImage = '') {
  const nextLogo = logoImage || fallbackLogoImage;
  if (majorCamp === 'L3' && nextLogo.includes(L3_LOGO_LEGACY_JPG)) {
    return L3_LOGO_TRANSPARENT;
  }
  return nextLogo;
}

export function resolveCampReportTheme(
  majorCamp: CampMajorLevel,
  configs: Record<string, CampReportThemeConfig>,
): CampReportTheme {
  const fallback = getDefaultCampTheme(majorCamp);
  const config = configs[majorCamp];
  if (!config) return fallback;
  return {
    ...fallback,
    logoImage: normalizeCampLogoImage(majorCamp, config.logoImage, fallback.logoImage),
    palette: normalizePalette(config.palette, fallback.palette),
  };
}

export function buildCampThemeVars(theme: CampReportTheme): CSSProperties {
  const palette = theme.palette;
  return {
    '--camp-accent': palette.accent,
    '--camp-accent-soft': palette.accentSoft,
    '--camp-accent-strong': palette.accentStrong,
    '--camp-ink': palette.ink,
    '--camp-paper': palette.paper,
    '--camp-panel': palette.panel,
    '--camp-border': palette.border,
    '--camp-module-warm': palette.moduleWarm,
    '--camp-module-cool': palette.moduleCool,
    '--camp-module-warm-border': palette.moduleWarmBorder,
    '--camp-module-cool-border': palette.moduleCoolBorder,
    '--camp-highlight': palette.highlight,
    '--camp-header-logo': theme.logoImage ? `url("${theme.logoImage}")` : 'none',
  } as CSSProperties;
}

export function normalizePalette(palette: Partial<CampReportPalette> | undefined, fallback: CampReportPalette): CampReportPalette {
  return {
    accent: normalizeHexColor(palette?.accent, fallback.accent),
    accentSoft: normalizeHexColor(palette?.accentSoft, fallback.accentSoft),
    accentStrong: normalizeHexColor(palette?.accentStrong, fallback.accentStrong),
    ink: normalizeHexColor(palette?.ink, fallback.ink),
    paper: normalizeHexColor(palette?.paper, fallback.paper),
    panel: normalizeHexColor(palette?.panel, fallback.panel),
    border: normalizeHexColor(palette?.border, fallback.border),
    moduleWarm: normalizeHexColor(palette?.moduleWarm, fallback.moduleWarm),
    moduleCool: normalizeHexColor(palette?.moduleCool, fallback.moduleCool),
    moduleWarmBorder: normalizeHexColor(palette?.moduleWarmBorder, fallback.moduleWarmBorder),
    moduleCoolBorder: normalizeHexColor(palette?.moduleCoolBorder, fallback.moduleCoolBorder),
    highlight: normalizeHexColor(palette?.highlight, fallback.highlight),
  };
}

export function createPaletteFromAccent(accent: string): CampReportPalette {
  const safeAccent = normalizeHexColor(accent, '#4D9BEE');
  const hsl = hexToHsl(safeAccent);
  const accentStrong = hslToHex({ ...hsl, s: clamp(hsl.s + 0.04, 0, 1), l: clamp(hsl.l - 0.16, 0.16, 0.42) });
  const ink = hslToHex({ ...hsl, s: clamp(hsl.s + 0.08, 0, 1), l: 0.22 });
  const accentSoft = hslToHex({ ...hsl, s: clamp(hsl.s * 0.42, 0.16, 0.38), l: 0.92 });
  const paper = hslToHex({ ...hsl, s: clamp(hsl.s * 0.48, 0.2, 0.44), l: 0.96 });
  const panel = hslToHex({ ...hsl, s: clamp(hsl.s * 0.26, 0.08, 0.22), l: 0.985 });
  const border = hslToHex({ ...hsl, s: clamp(hsl.s * 0.42, 0.16, 0.38), l: 0.82 });
  const moduleWarm = hslToHex({ h: (hsl.h + 38) % 360, s: clamp(hsl.s * 0.42, 0.16, 0.36), l: 0.94 });
  const moduleCool = hslToHex({ ...hsl, s: clamp(hsl.s * 0.36, 0.14, 0.34), l: 0.91 });
  return {
    accent: safeAccent,
    accentSoft,
    accentStrong,
    ink,
    paper,
    panel,
    border,
    moduleWarm,
    moduleCool,
    moduleWarmBorder: hslToHex({ h: (hsl.h + 38) % 360, s: clamp(hsl.s * 0.38, 0.14, 0.34), l: 0.8 }),
    moduleCoolBorder: hslToHex({ ...hsl, s: clamp(hsl.s * 0.36, 0.14, 0.32), l: 0.76 }),
    highlight: hslToHex({ h: (hsl.h + 62) % 360, s: 0.86, l: 0.62 }),
  };
}

export async function extractDominantColorFromImage(imageSrc: string): Promise<string> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  const size = 72;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('当前浏览器无法识别图片主色。');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const buckets = new Map<string, { color: [number, number, number]; score: number }>();
  let fallback: [number, number, number] = [77, 155, 238];
  let fallbackScore = 0;

  for (let index = 0; index < data.length; index += 16) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const alpha = data[index + 3];
    if (alpha < 150) continue;
    const hsl = rgbToHsl(r, g, b);
    const lightnessPenalty = hsl.l > 0.92 || hsl.l < 0.12 ? 0.2 : 1;
    const saturationWeight = Math.max(hsl.s, 0.12);
    const score = saturationWeight * lightnessPenalty;
    if (score > fallbackScore) {
      fallbackScore = score;
      fallback = [r, g, b];
    }
    if (hsl.s < 0.16 || hsl.l > 0.94 || hsl.l < 0.10) continue;
    const key = `${Math.round(r / 24)}_${Math.round(g / 24)}_${Math.round(b / 24)}`;
    const current = buckets.get(key);
    if (current) {
      current.score += score;
      current.color = [
        Math.round((current.color[0] + r) / 2),
        Math.round((current.color[1] + g) / 2),
        Math.round((current.color[2] + b) / 2),
      ];
    } else {
      buckets.set(key, { color: [r, g, b], score });
    }
  }

  const best = Array.from(buckets.values()).sort((a, b) => b.score - a.score)[0];
  return rgbToHex(...(best?.color || fallback));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败，无法识别主色。'));
    image.src = src;
  });
}

function normalizeHexColor(value: string | undefined, fallback: string) {
  const clean = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(clean)) return clean.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(clean)) {
    const [, r, g, b] = clean;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex, '#4D9BEE').slice(1);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function hexToHsl(hex: string) {
  return rgbToHsl(...hexToRgb(hex));
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = ((bn - rn) / d + 2);
  else h = ((rn - gn) / d + 4);
  return { h: h * 60, s, l };
}

function hslToHex({ h, s, l }: { h: number; s: number; l: number }) {
  const normalizedH = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const gray = l * 255;
    return rgbToHex(gray, gray, gray);
  }
  const hueToRgb = (p: number, q: number, t: number) => {
    let nextT = t;
    if (nextT < 0) nextT += 1;
    if (nextT > 1) nextT -= 1;
    if (nextT < 1 / 6) return p + (q - p) * 6 * nextT;
    if (nextT < 1 / 2) return q;
    if (nextT < 2 / 3) return p + (q - p) * (2 / 3 - nextT) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(
    hueToRgb(p, q, normalizedH + 1 / 3) * 255,
    hueToRgb(p, q, normalizedH) * 255,
    hueToRgb(p, q, normalizedH - 1 / 3) * 255,
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
