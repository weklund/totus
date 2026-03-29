/**
 * Totus Design System — Brand Tokens (TypeScript)
 * Use these in JS/TS code where CSS variables aren't available
 * (e.g. Recharts color props, canvas, email templates).
 */

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

export const fonts = {
  sans: "'DM Sans', system-ui, -apple-system, sans-serif",
  mono: "'DM Mono', ui-monospace, monospace",
} as const;

export const radius = {
  card: '0.5rem',
  button: '0.375rem',
  pill: '1.5rem',
  badge: '0.25rem',
} as const;

export const shadows = {
  sm: '0 1px 3px rgba(30,91,123,.06), 0 4px 12px rgba(30,91,123,.06)',
  md: '0 4px 16px rgba(30,91,123,.10), 0 1px 4px rgba(30,91,123,.06)',
  lg: '0 8px 32px rgba(30,91,123,.14), 0 2px 8px rgba(30,91,123,.08)',
} as const;

/** Chart color sequence for Recharts / data viz */
export const chartColors = [
  colors.emerald,   // chart-1: health positive / in-range
  colors.ocean,     // chart-2: primary data stream
  colors.coral,     // chart-3: alerts / out-of-range
  colors.slate,     // chart-4: tertiary
  colors.ink,       // chart-5: additional
] as const;
