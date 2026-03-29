/**
 * Totus Design System — Brand Tokens (TypeScript)
 * Use these in JS/TS code where CSS variables aren't available
 * (e.g. Recharts color props, canvas, email templates).
 */

// ── Appearance colors ─────────────────────────────────────────────────────────

export const colors = {
  ocean: '#1e5b7b',
  emerald: '#2fa87b',
  coral: '#e8845a',
  ink: '#1a2332',
  slate: '#64748b',
  mist: '#e2e8f0',
  cloud: '#f8f9fb',
  white: '#ffffff',
  oceanTint: '#e8f2f8',
  emeraldTint: '#e8f4f0',
  coralTint: '#fdf0eb',
} as const;

// ── Semantic aliases ──────────────────────────────────────────────────────────
// Use these when writing feature code so rebranding only requires
// changing the mapping below, not hunting every usage site.

export const semantic = {
  // Actions
  primary: colors.ocean,
  primaryForeground: colors.white,
  cta: colors.coral,
  ctaForeground: colors.white,

  // Status
  success: colors.emerald,
  successForeground: colors.white,
  danger: colors.coral,
  dangerForeground: colors.white,

  // Surfaces (light mode defaults)
  background: colors.cloud,
  surface: colors.white,
  surfaceMuted: colors.cloud,

  // Text
  text: colors.ink,
  textMuted: colors.slate,

  // Borders
  border: colors.mist,
} as const;

// ── Typography ────────────────────────────────────────────────────────────────

export const fonts = {
  sans: "'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'DM Mono', ui-monospace, 'Cascadia Code', monospace",
} as const;

// ── Spacing (4px base grid) ───────────────────────────────────────────────────

export const spacing = {
  '0': '0',
  '1': '0.25rem',  // 4px
  '2': '0.5rem',   // 8px
  '3': '0.75rem',  // 12px
  '4': '1rem',     // 16px
  '5': '1.25rem',  // 20px
  '6': '1.5rem',   // 24px
  '8': '2rem',     // 32px
  '12': '3rem',    // 48px
  '16': '4rem',    // 64px
  '24': '6rem',    // 96px
} as const;

// ── Border radius ─────────────────────────────────────────────────────────────

export const radius = {
  badge: '0.25rem',   // 4px  — badges, tags
  button: '0.375rem', // 6px  — inputs, default buttons
  card: '0.5rem',     // 8px  — cards, containers
  icon: '0.875rem',   // 14px — app icon (22% of 64px)
  pill: '1.5rem',     // 24px — CTA pill buttons
} as const;

// ── Shadows (Ocean-tinted) ────────────────────────────────────────────────────

export const shadows = {
  sm: '0 1px 3px rgba(30,91,123,.06), 0 4px 12px rgba(30,91,123,.06)',
  md: '0 4px 16px rgba(30,91,123,.10), 0 1px 4px rgba(30,91,123,.06)',
  lg: '0 8px 32px rgba(30,91,123,.14), 0 2px 8px rgba(30,91,123,.08)',
} as const;

// ── Chart colors ──────────────────────────────────────────────────────────────

/** Ordered color sequence for Recharts / data viz. */
export const chartColors = [
  colors.emerald,   // chart-1: health positive / in-range
  colors.ocean,     // chart-2: primary data stream
  colors.coral,     // chart-3: alerts / out-of-range
  colors.slate,     // chart-4: tertiary
  colors.ink,       // chart-5: additional
] as const;
