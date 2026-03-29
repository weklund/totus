import * as React from 'react';
import { spacing } from '../tokens';

type LogoVariant = 'color' | 'white' | 'mono' | 'auto';

interface SignalBarsProps {
  /** Height in pixels. Width is derived from the 36:28 aspect ratio. */
  height?: number;
  /**
   * Color variant:
   * - `color` — full brand colors (light backgrounds)
   * - `white` — all-white opacity progression (dark/ocean backgrounds)
   * - `mono` — monochrome slate (single-color contexts)
   * - `auto` — respects CSS `color-scheme`; switches white on `.dark` automatically
   */
  variant?: LogoVariant;
  className?: string;
}

const BAR_COLORS: Record<Exclude<LogoVariant, 'auto'>, [string, string, string, string]> = {
  color: ['#2fa87b', '#1e5b7b', '#1e5b7b', '#e8845a'],
  white: ['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.8)', '#ffffff'],
  mono: ['#64748b', '#64748b', '#64748b', '#64748b'],
};

/** Signal Bars icon mark — the Totus logo. */
export function SignalBars({ height = 28, variant = 'color', className }: SignalBarsProps) {
  const width = Math.round((height / 28) * 36);

  if (variant === 'auto') {
    // CSS-driven: uses currentColor so the parent can control color via CSS.
    // In light mode: render color variant via CSS variables.
    // In dark mode (.dark ancestor): bars use white opacity progression.
    return (
      <svg
        data-totus-logo
        width={width}
        height={height}
        viewBox="0 0 36 28"
        fill="none"
        aria-label="Totus"
        className={className}
        style={{ display: 'inline-block', flexShrink: 0 }}
      >
        <rect x="0" y="20" width="7" height="8" rx="2" fill="var(--totus-logo-bar1, #2fa87b)" />
        <rect x="9.5" y="13" width="7" height="15" rx="2" fill="var(--totus-logo-bar2, #1e5b7b)" />
        <rect x="19" y="6" width="7" height="22" rx="2" fill="var(--totus-logo-bar3, #1e5b7b)" />
        <rect x="28.5" y="0" width="7" height="28" rx="2" fill="var(--totus-logo-bar4, #e8845a)" />
        <style>{`
          .dark [data-totus-logo] { --totus-logo-bar1: rgba(255,255,255,0.4); --totus-logo-bar2: rgba(255,255,255,0.6); --totus-logo-bar3: rgba(255,255,255,0.8); --totus-logo-bar4: #ffffff; }
        `}</style>
      </svg>
    );
  }

  const [c1, c2, c3, c4] = BAR_COLORS[variant];
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 36 28"
      fill="none"
      aria-label="Totus"
      className={className}
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <rect x="0" y="20" width="7" height="8" rx="2" fill={c1} />
      <rect x="9.5" y="13" width="7" height="15" rx="2" fill={c2} />
      <rect x="19" y="6" width="7" height="22" rx="2" fill={c3} />
      <rect x="28.5" y="0" width="7" height="28" rx="2" fill={c4} />
    </svg>
  );
}

interface LogoProps {
  /** Height of the icon mark in pixels. Wordmark scales proportionally. */
  height?: number;
  variant?: LogoVariant;
  /** Show the "totus" wordmark next to the icon. Default: true. */
  wordmark?: boolean;
  className?: string;
}

/**
 * Full Totus logo lockup — Signal Bars icon + optional wordmark.
 *
 * @example
 * // Full color lockup (light bg)
 * <Logo />
 *
 * // White version (dark/ocean bg)
 * <Logo variant="white" />
 *
 * // Auto — switches color/white based on .dark class automatically
 * <Logo variant="auto" />
 *
 * // Icon only at 20px
 * <Logo height={20} wordmark={false} />
 */
export function Logo({ height = 28, variant = 'color', wordmark = true, className }: LogoProps) {
  // Gap between icon and wordmark derived from spacing scale (space-2 = 8px is ~30% of 28px default)
  const gapPx = parseFloat(spacing['2']) * 16; // 0.5rem → 8px
  const wordmarkSize = Math.round(height * 0.8);

  const wordmarkColor =
    variant === 'color'
      ? 'var(--totus-text, #1a2332)'
      : variant === 'auto'
        ? 'var(--totus-text, #1a2332)'
        : '#ffffff';

  return (
    <span
      data-totus-logo
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: gapPx,
      }}
    >
      <SignalBars height={height} variant={variant} />
      {wordmark && (
        <span
          style={{
            fontFamily: 'var(--totus-font-sans, "DM Sans", system-ui, sans-serif)',
            fontSize: wordmarkSize,
            fontWeight: 500,
            letterSpacing: '0.02em',
            color: wordmarkColor,
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          totus
        </span>
      )}
    </span>
  );
}
