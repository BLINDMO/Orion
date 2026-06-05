/**
 * ORION design system — design tokens. Spec §2.
 *
 * Framework-agnostic token source of truth (color, spacing, radius, elevation,
 * typography, motion). The RN/Skia client (spec §3) consumes these; nothing here
 * depends on a UI framework so the same tokens can drive native, web or docs.
 *
 * Principles: dark-first with a calm light peer; high-contrast low-chroma
 * surfaces; ONE electric accent for primary actions; semantic green/red reserved
 * STRICTLY for P&L direction (and always paired with sign/shape for color-blind
 * safety, never color alone). Tabular figures everywhere money/quantities tick.
 */

export const palette = {
  // Brand — monochrome-first so the mark works on dark and light.
  ink: "#0A0C10", // near-black background (NOT pure #000)
  inkElevated: "#12151B",
  inkSurface: "#171B23",
  inkSurface2: "#1F2530",
  hairline: "#2A3340",
  textPrimary: "#EAEEF5",
  textSecondary: "#9AA6B6",
  textTertiary: "#5E6B7E",

  // Single electric accent for primary actions.
  accent: "#4C8DFF",
  accentPressed: "#3A78E6",
  accentSubtle: "#16243F",

  // Semantic P&L — reserved for direction ONLY.
  gain: "#2ECC8F",
  loss: "#FF5C6C",
  gainSubtle: "#10271F",
  lossSubtle: "#2A161A",
  warn: "#F5B83D",

  // Light theme peer.
  light: {
    bg: "#F6F8FB",
    surface: "#FFFFFF",
    surface2: "#EEF1F6",
    hairline: "#D7DEE8",
    textPrimary: "#0C1118",
    textSecondary: "#48586C",
    accent: "#1F6BFF",
    gain: "#0FA968",
    loss: "#E23744",
  },
} as const;

/** 4/8pt spacing grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Restrained elevation — depth via subtle surfaces + hairlines, not heavy shadow. */
export const elevation = {
  flat: { shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  raised: { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffsetY: 4, elevation: 4 },
  overlay: { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffsetY: 8, elevation: 12 },
} as const;

/**
 * Typography. A precise, data-friendly family with TABULAR figures for all
 * numerals so money/quantities never shift width as they tick.
 */
export const typography = {
  // Suggested families; the app bundles the actual fonts.
  fontSans: "Inter, system-ui, sans-serif",
  fontMono: "RobotoMono, ui-monospace, monospace", // numerals: tabular
  numericFeatureSettings: '"tnum" 1, "lnum" 1, "zero" 1',
  scale: {
    display: { size: 34, lineHeight: 40, weight: "700" },
    title: { size: 24, lineHeight: 30, weight: "600" },
    heading: { size: 20, lineHeight: 26, weight: "600" },
    body: { size: 16, lineHeight: 22, weight: "400" },
    callout: { size: 14, lineHeight: 20, weight: "500" },
    caption: { size: 12, lineHeight: 16, weight: "500" },
    // Dedicated numeric styles (tabular) for tickers/order tickets.
    tickerLg: { size: 28, lineHeight: 32, weight: "600", tabular: true },
    tickerMd: { size: 18, lineHeight: 22, weight: "600", tabular: true },
    mono: { size: 13, lineHeight: 18, weight: "500", tabular: true },
  },
} as const;

/** Physically-based, interruptible motion (spring/inertia). */
export const motion = {
  duration: { instant: 80, fast: 160, base: 240, slow: 360, scrub: 600 },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    decelerate: "cubic-bezier(0, 0, 0, 1)",
    accelerate: "cubic-bezier(0.3, 0, 1, 1)",
  },
  spring: {
    // Reanimated-style spring configs.
    snappy: { damping: 26, stiffness: 320, mass: 1 },
    gentle: { damping: 30, stiffness: 180, mass: 1 },
    // Number tick-up + time-advance scrubbing.
    ticker: { damping: 22, stiffness: 240, mass: 1 },
  },
  haptics: {
    orderFill: "impactMedium",
    timeAdvance: "selection",
    levelUp: "notificationSuccess",
  },
} as const;

/** Color-blind-safe P&L helper — pairs color with sign/shape, never color alone. */
export function pnlPresentation(value: number): { color: string; sign: "+" | "-" | ""; glyph: "▲" | "▼" | "—" } {
  if (value > 0) return { color: palette.gain, sign: "+", glyph: "▲" };
  if (value < 0) return { color: palette.loss, sign: "-", glyph: "▼" };
  return { color: palette.textSecondary, sign: "", glyph: "—" };
}

export const tokens = { palette, spacing, radius, elevation, typography, motion } as const;
export default tokens;
