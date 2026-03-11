"use client";

import { getProvider } from "@/config/providers";
import { Badge } from "@/components/ui/badge";

interface SourceBadgeProps {
  /** Provider identifier (e.g., 'oura', 'dexcom') */
  provider: string;
  /** Whether to show the provider name alongside the dot */
  showName?: boolean;
  /** Badge size */
  size?: "sm" | "md";
}

/**
 * SourceBadge — small inline badge showing a provider color dot and optional name.
 *
 * Used in chart headers, metric selector chips, and tooltips to indicate
 * the data source when a metric has multiple providers.
 */
export function SourceBadge({
  provider,
  showName = false,
  size = "sm",
}: SourceBadgeProps) {
  const config = getProvider(provider);
  const displayName = config?.displayName ?? provider;

  // Use a distinct color per provider for the dot
  const dotColor = getProviderColor(provider);
  const dotSize = size === "sm" ? "size-2" : "size-2.5";

  if (showName) {
    return (
      <Badge
        variant="outline"
        className="gap-1 px-1.5 py-0 text-[10px] font-normal"
        data-testid={`source-badge-${provider}`}
      >
        <span
          className={`inline-block shrink-0 rounded-full ${dotSize}`}
          style={{ backgroundColor: dotColor }}
        />
        {displayName}
      </Badge>
    );
  }

  return (
    <span
      className={`inline-block shrink-0 rounded-full ${dotSize}`}
      style={{ backgroundColor: dotColor }}
      title={displayName}
      data-testid={`source-badge-${provider}`}
    />
  );
}

/**
 * Provider brand colors for UI indicators.
 */
const PROVIDER_COLORS: Record<string, string> = {
  oura: "#7C3AED", // Purple
  dexcom: "#DB2777", // Pink
  garmin: "#2563EB", // Blue
  whoop: "#1F2937", // Dark gray
  withings: "#0891B2", // Teal
  cronometer: "#D97706", // Amber
  nutrisense: "#059669", // Green
};

export function getProviderColor(provider: string): string {
  return PROVIDER_COLORS[provider] ?? "#6B7280";
}
