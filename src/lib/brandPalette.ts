/** Unique Distribution brand green and the semantic tokens built around it. */

export const BRAND_SEED = '#66a441'

const HEX6 = /^#([0-9a-f]{6})$/i
const HEX3 = /^#([0-9a-f]{3})$/i

export type BrandScaleStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950

export type BrandScale = Record<BrandScaleStep, string>

export type BrandPalette = {
  primary: string
  primaryHover: string
  primaryDark: string
  primaryMuted: string
  pageBg: string
  contentBg: string
  text: string
  muted: string
  soft: string
  footer: string
  onDark: string
  hero: string
  border: string
}

export const BRAND_SETTING_KEYS = {
  primary: 'brand_primary',
  primaryHover: 'brand_primary_hover',
  primaryDark: 'brand_primary_dark',
  primaryMuted: 'brand_primary_muted',
  pageBg: 'brand_page_bg',
  contentBg: 'brand_content_bg',
  text: 'brand_text',
  muted: 'brand_muted',
  soft: 'brand_soft',
  footer: 'brand_footer',
  onDark: 'brand_on_dark',
  hero: 'brand_hero',
  border: 'brand_border',
} as const satisfies Record<keyof BrandPalette, string>

export const BRAND_COLOR_FIELDS: Array<{
  key: keyof BrandPalette
  settingKey: (typeof BRAND_SETTING_KEYS)[keyof BrandPalette]
  label: string
  hint: string
}> = [
  { key: 'primary', settingKey: 'brand_primary', label: 'Brand / CTA', hint: 'Buttons, links, and focus rings' },
  { key: 'primaryHover', settingKey: 'brand_primary_hover', label: 'Brand hover', hint: 'Pressed and hover states' },
  { key: 'primaryDark', settingKey: 'brand_primary_dark', label: 'Brand dark', hint: 'Strong accents and highlights' },
  { key: 'primaryMuted', settingKey: 'brand_primary_muted', label: 'Brand muted', hint: 'Chips, badges, and selected rows' },
  { key: 'text', settingKey: 'brand_text', label: 'Body text', hint: 'Headings and primary copy' },
  { key: 'muted', settingKey: 'brand_muted', label: 'Muted text', hint: 'Secondary labels and captions' },
  { key: 'pageBg', settingKey: 'brand_page_bg', label: 'Page background', hint: 'Outer canvas behind content' },
  { key: 'contentBg', settingKey: 'brand_content_bg', label: 'Content surface', hint: 'Cards, sheets, and page body' },
  { key: 'soft', settingKey: 'brand_soft', label: 'Soft accent', hint: 'Secondary buttons and hover fills' },
  { key: 'border', settingKey: 'brand_border', label: 'Borders', hint: 'Inputs, dividers, and table lines' },
  { key: 'hero', settingKey: 'brand_hero', label: 'Hero fallback', hint: 'Default hero slide background' },
  { key: 'footer', settingKey: 'brand_footer', label: 'Footer / dark', hint: 'Footer, admin sidebar, dark bars' },
  { key: 'onDark', settingKey: 'brand_on_dark', label: 'Text on dark', hint: 'Light copy on footer and hero' },
]

const SCALE_STEPS: Record<BrandScaleStep, { s: number; l: number }> = {
  50: { s: 0.4, l: 0.97 },
  100: { s: 0.42, l: 0.92 },
  200: { s: 0.42, l: 0.82 },
  300: { s: 0.43, l: 0.7 },
  400: { s: 0.43, l: 0.57 },
  500: { s: 0.43, l: 0.45 },
  600: { s: 0.44, l: 0.37 },
  700: { s: 0.45, l: 0.29 },
  800: { s: 0.46, l: 0.22 },
  900: { s: 0.48, l: 0.15 },
  950: { s: 0.5, l: 0.09 },
}

export function normalizeHex(value: string | undefined | null): string | null {
  const raw = value?.trim() ?? ''
  if (HEX6.test(raw)) return `#${raw.slice(1).toLowerCase()}`
  const short = raw.match(HEX3)
  if (!short) return null
  const [r, g, b] = short[1].split('')
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, hue + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hue) * 255),
    Math.round(hue2rgb(p, q, hue - 1 / 3) * 255),
  ]
}

function hslToHex(h: number, s: number, l: number): string {
  return rgbToHex(...hslToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l))))
}

const SCALE_ORDER = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export function deriveScaleFromPrimary(primary: string): BrandScale {
  const hex = normalizeHex(primary) ?? BRAND_SEED
  const [h] = rgbToHsl(...hexToRgb(hex))
  const scale = {} as BrandScale
  for (const step of SCALE_ORDER) {
    const { s, l } = SCALE_STEPS[step]
    scale[step] = step === 500 ? hex : hslToHex(h, s, l)
  }
  return scale
}

export function derivePaletteFromPrimary(primary: string): BrandPalette {
  const hex = normalizeHex(primary) ?? BRAND_SEED
  const [h] = rgbToHsl(...hexToRgb(hex))
  const scale = deriveScaleFromPrimary(hex)
  return {
    primary: hex,
    primaryHover: scale[600],
    primaryDark: scale[700],
    primaryMuted: scale[100],
    pageBg: hslToHex(h, 0.12, 0.955),
    contentBg: hslToHex(h, 0.16, 0.98),
    text: hslToHex(h, 0.22, 0.12),
    muted: hslToHex(h, 0.08, 0.43),
    soft: scale[100],
    footer: scale[950],
    onDark: scale[50],
    hero: scale[700],
    border: hslToHex(h, 0.18, 0.84),
  }
}

export const DEFAULT_BRAND_PALETTE = derivePaletteFromPrimary(BRAND_SEED)
export const DEFAULT_BRAND_SCALE = deriveScaleFromPrimary(BRAND_SEED)
export const DEFAULT_HERO_BACKGROUND = DEFAULT_BRAND_PALETTE.hero

export const LEGACY_UNUSED_PRIMARY = '#1a3a5c'

export function resolveBrandPalette(settings: Record<string, string>): BrandPalette {
  const hasCompanionKeys = Boolean(
    normalizeHex(settings[BRAND_SETTING_KEYS.pageBg]) ||
      normalizeHex(settings[BRAND_SETTING_KEYS.footer]) ||
      normalizeHex(settings[BRAND_SETTING_KEYS.hero]),
  )
  let primary = normalizeHex(settings[BRAND_SETTING_KEYS.primary])
  if (primary === LEGACY_UNUSED_PRIMARY && !hasCompanionKeys) {
    primary = null
  }
  const resolvedPrimary = primary ?? DEFAULT_BRAND_PALETTE.primary
  const derived = derivePaletteFromPrimary(resolvedPrimary)
  const resolved = { ...derived }
  for (const key of Object.keys(BRAND_SETTING_KEYS) as Array<keyof BrandPalette>) {
    const override = normalizeHex(settings[BRAND_SETTING_KEYS[key]])
    if (override) resolved[key] = override
  }
  resolved.primary = resolvedPrimary
  return resolved
}

export function paletteToCssVars(palette: BrandPalette): Record<string, string> {
  const scale = deriveScaleFromPrimary(palette.primary)
  return {
    '--brand-primary': palette.primary,
    '--brand-primary-hover': palette.primaryHover,
    '--brand-primary-dark': palette.primaryDark,
    '--brand-primary-muted': palette.primaryMuted,
    '--brand-page-bg': palette.pageBg,
    '--brand-content-bg': palette.contentBg,
    '--brand-text': palette.text,
    '--brand-muted': palette.muted,
    '--brand-soft': palette.soft,
    '--brand-footer': palette.footer,
    '--brand-on-dark': palette.onDark,
    '--brand-hero': palette.hero,
    '--brand-border': palette.border,
    '--brand-50': scale[50],
    '--brand-100': scale[100],
    '--brand-200': scale[200],
    '--brand-300': scale[300],
    '--brand-400': scale[400],
    '--brand-500': scale[500],
    '--brand-600': scale[600],
    '--brand-700': scale[700],
    '--brand-800': scale[800],
    '--brand-900': scale[900],
    '--brand-950': scale[950],
    '--color-page-bg': palette.pageBg,
    '--color-content-bg': palette.contentBg,
    '--color-hero-brown': palette.hero,
    '--color-text-brown': palette.text,
    '--color-cta-brown': palette.primary,
    '--color-soft-beige': palette.soft,
    '--color-footer-dark': palette.footer,
    '--color-cream-text': palette.onDark,
    '--color-muted': palette.muted,
    '--color-brand': palette.primary,
    '--color-brand-hover': palette.primaryHover,
    '--color-brand-muted': palette.primaryMuted,
    '--color-brand-dark': palette.primaryDark,
    '--color-brand-border': palette.border,
    '--color-brand-50': scale[50],
    '--color-brand-100': scale[100],
    '--color-brand-200': scale[200],
    '--color-brand-300': scale[300],
    '--color-brand-400': scale[400],
    '--color-brand-500': scale[500],
    '--color-brand-600': scale[600],
    '--color-brand-700': scale[700],
    '--color-brand-800': scale[800],
    '--color-brand-900': scale[900],
    '--color-brand-950': scale[950],
    '--admin-primary': palette.primary,
    '--admin-primary-hover': palette.primaryHover,
    '--admin-primary-muted': palette.primaryMuted,
    '--admin-surface': palette.contentBg,
    '--admin-border': palette.border,
    '--admin-text': palette.text,
    '--admin-muted': palette.muted,
    '--admin-sidebar': palette.footer,
    '--admin-sidebar-text': palette.onDark,
    '--admin-sidebar-active': palette.primary,
    '--chart-1': palette.primary,
    '--chart-2': palette.primaryHover,
  }
}
