import * as React from 'react';

type LogoVariant = 'color' | 'white' | 'mono';

interface SignalBarsProps {
  /** Height in pixels. Width is derived from the 36:28 aspect ratio. */
  height?: number;
  variant?: LogoVariant;
  className?: string;
}

const BAR_COLORS: Record<LogoVariant, [string, string, string, string]> = {
  color: ['#2fa87b', '#1e5b7b', '#1e5b7b', '#e8845a'],
  white: ['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.8)', '#ffffff'],
  mono: ['#64748b', '#64748b', '#64748b', '#64748b'],
};

/** Signal Bars icon mark — the Totus logo. */
export function SignalBars({ height = 28, variant = 'color', className }: SignalBarsProps) {
  const width = Math.round((height / 28) * 36);
  const [c1, c2, c3, c4] = BAR_COLORS[variant];
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 36 28"
      fill="none"
      aria-label="Totus"
      className={className}
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
 * <Logo />                          // full color, with wordmark
 * <Logo variant="white" />          // white bars, white wordmark (for dark/ocean bg)
 * <Logo height={20} wordmark={false} /> // icon only at 20px height
 */
export function Logo({ height = 28, variant = 'color', wordmark = true, className }: LogoProps) {
  const wordmarkColor = variant === 'color' ? '#1a2332' : '#ffffff';
  const fontSize = Math.round(height * 0.8);

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height * 0.3) }}
    >
      <SignalBars height={height} variant={variant} />
      {wordmark && (
        <span
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize,
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
