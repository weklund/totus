import * as React from 'react';
import { spacing } from '../tokens';

type LogoVariant = 'color' | 'white' | 'mono' | 'auto';

interface SignalBarsProps {
  /** Height in pixels. Width is derived from the 72:52 aspect ratio. */
  height?: number;
  /**
   * Color variant:
   * - `color` — full brand colors (light backgrounds)
   * - `white` — white opacity bars + lighter gradient center (dark/ocean backgrounds)
   * - `mono` — monochrome slate (single-color contexts)
   * - `auto` — switches color/white based on `.dark` ancestor automatically
   */
  variant?: LogoVariant;
  className?: string;
}

/**
 * Signal Bars icon mark — the Totus logo (Direction B).
 *
 * Five rounded vertical bars at bell-curve heights — a health/data histogram.
 * Ocean-to-emerald gradient on the center bar with a coral peak dot.
 */
export function SignalBars({ height = 28, variant = 'color', className }: SignalBarsProps) {
  const width = Math.round(height * (72 / 52));
  const id = React.useId().replace(/:/g, '');

  if (variant === 'auto') {
    return (
      <svg
        data-totus-logo
        width={width}
        height={height}
        viewBox="0 0 72 52"
        fill="none"
        aria-label="Totus"
        className={className}
        style={{ display: 'inline-block', flexShrink: 0 }}
      >
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--totus-logo-grad0, #1E5B7B)" />
            <stop offset="100%" stopColor="var(--totus-logo-grad1, #2FA87B)" />
          </linearGradient>
        </defs>
        <rect x="1"  y="40" width="10" height="12" rx="5" fill="var(--totus-logo-b1, #1E5B7B)" opacity="var(--totus-logo-o1, 0.3)" />
        <rect x="15" y="28" width="10" height="24" rx="5" fill="var(--totus-logo-b2, #1E5B7B)" opacity="var(--totus-logo-o2, 0.55)" />
        <rect x="29" y="8"  width="10" height="44" rx="5" fill={`url(#${id}-g)`} />
        <rect x="43" y="18" width="10" height="34" rx="5" fill="var(--totus-logo-b4, #2FA87B)" opacity="var(--totus-logo-o4, 0.65)" />
        <rect x="57" y="30" width="10" height="22" rx="5" fill="var(--totus-logo-b5, #2FA87B)" opacity="var(--totus-logo-o5, 0.38)" />
        <circle cx="34" cy="6" r="5" fill="#E8845A" />
        <style>{`
          .dark [data-totus-logo] {
            --totus-logo-b1: white; --totus-logo-o1: 0.18;
            --totus-logo-b2: white; --totus-logo-o2: 0.32;
            --totus-logo-grad0: #4DB6E8; --totus-logo-grad1: #4EDBA0;
            --totus-logo-b4: white; --totus-logo-o4: 0.38;
            --totus-logo-b5: white; --totus-logo-o5: 0.22;
          }
        `}</style>
      </svg>
    );
  }

  const isWhite = variant === 'white';
  const isMono = variant === 'mono';

  const grad0 = isWhite ? '#4DB6E8' : isMono ? '#64748b' : '#1E5B7B';
  const grad1 = isWhite ? '#4EDBA0' : isMono ? '#64748b' : '#2FA87B';
  const barFillLeft = isWhite ? 'white' : isMono ? '#64748b' : '#1E5B7B';
  const barFillRight = isWhite ? 'white' : isMono ? '#64748b' : '#2FA87B';
  const dotFill = isMono ? '#64748b' : '#E8845A';

  const opacities = isWhite
    ? [0.18, 0.32, 1, 0.38, 0.22]
    : isMono
      ? [0.3, 0.55, 1, 0.65, 0.38]
      : [0.3, 0.55, 1, 0.65, 0.38];

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 72 52"
      fill="none"
      aria-label="Totus"
      className={className}
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={grad0} />
          <stop offset="100%" stopColor={grad1} />
        </linearGradient>
      </defs>
      <rect x="1"  y="40" width="10" height="12" rx="5" fill={barFillLeft}  opacity={opacities[0]} />
      <rect x="15" y="28" width="10" height="24" rx="5" fill={barFillLeft}  opacity={opacities[1]} />
      <rect x="29" y="8"  width="10" height="44" rx="5" fill={`url(#${id}-g)`} />
      <rect x="43" y="18" width="10" height="34" rx="5" fill={barFillRight} opacity={opacities[3]} />
      <rect x="57" y="30" width="10" height="22" rx="5" fill={barFillRight} opacity={opacities[4]} />
      <circle cx="34" cy="6" r="5" fill={dotFill} />
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
 * // Auto — switches color/white based on .dark class
 * <Logo variant="auto" />
 *
 * // Icon only at 20px
 * <Logo height={20} wordmark={false} />
 */
export function Logo({ height = 28, variant = 'color', wordmark = true, className }: LogoProps) {
  const gapPx = parseFloat(spacing['2']) * 16; // 0.5rem → 8px
  const wordmarkSize = Math.round(height * 0.65);

  const wordmarkColor =
    variant === 'white'
      ? '#ffffff'
      : 'var(--totus-text, #1f2433)';

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
            fontWeight: 600,
            letterSpacing: '-0.02em',
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
