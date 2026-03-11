"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/dashboard/ErrorCard";
import { useSourcePreferences } from "@/hooks/useSourcePreferences";
import { useSetSourcePreference } from "@/hooks/useSetSourcePreference";
import { useClearSourcePreference } from "@/hooks/useClearSourcePreference";
import { getAllMetricTypes, type MetricType } from "@/config/metrics";
import { getProvider } from "@/config/providers";

/**
 * SourcePreferencesSection — settings section for managing per-metric source preferences.
 *
 * For each metric available from multiple providers, displays a dropdown to
 * select which provider is the preferred (authoritative) source.
 * "Auto" option uses the default resolution (most recent data).
 *
 * See: /docs/web-ui-lld.md Section 8.5
 */
export function SourcePreferencesSection() {
  const { data, isLoading, error, refetch } = useSourcePreferences();
  const setPreference = useSetSourcePreference();
  const clearPreference = useClearSourcePreference();

  // Get metrics that have multiple providers
  const multiSourceMetrics = useMemo(() => {
    return getAllMetricTypes().filter((m) => m.providers.length > 1);
  }, []);

  // Build lookup map of current preferences
  const preferencesMap = useMemo(() => {
    const map = new Map<string, string>();
    if (data?.data?.preferences) {
      for (const pref of data.data.preferences) {
        map.set(pref.metric_type, pref.provider);
      }
    }
    return map;
  }, [data]);

  function handleChange(metricType: string, value: string) {
    if (value === "auto") {
      clearPreference.mutate(metricType, {
        onSuccess: () => {
          toast.success("Source preference cleared");
        },
        onError: () => {
          toast.error("Failed to clear preference");
        },
      });
    } else {
      setPreference.mutate(
        { metricType, provider: value },
        {
          onSuccess: () => {
            toast.success("Source preference updated");
          },
          onError: () => {
            toast.error("Failed to update preference");
          },
        },
      );
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="source-preferences-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Failed to load preferences"
        message={error.message || "Could not load your source preferences."}
        onRetry={() => refetch()}
      />
    );
  }

  if (multiSourceMetrics.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No metrics with multiple sources available.
      </p>
    );
  }

  const isPending = setPreference.isPending || clearPreference.isPending;

  return (
    <div className="space-y-4" data-testid="source-preferences-section">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">Metric Source Preferences</h4>
        <p className="text-muted-foreground text-xs">
          Choose which provider is authoritative for metrics available from
          multiple sources. &ldquo;Auto&rdquo; uses the most recently synced
          data.
        </p>
      </div>

      <div className="space-y-3">
        {multiSourceMetrics.map((metric) => (
          <SourcePreferenceRow
            key={metric.id}
            metric={metric}
            currentProvider={preferencesMap.get(metric.id) ?? null}
            onChange={(value) => handleChange(metric.id, value)}
            disabled={isPending}
          />
        ))}
      </div>

      {isPending && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
}

interface SourcePreferenceRowProps {
  metric: MetricType;
  currentProvider: string | null;
  onChange: (value: string) => void;
  disabled: boolean;
}

function SourcePreferenceRow({
  metric,
  currentProvider,
  onChange,
  disabled,
}: SourcePreferenceRowProps) {
  return (
    <div
      className="flex items-center justify-between gap-4"
      data-testid={`source-preference-${metric.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{metric.label}</p>
        <p className="text-muted-foreground text-xs">
          {metric.providers
            .map((p) => getProvider(p)?.displayName ?? p)
            .join(", ")}
        </p>
      </div>

      <Select
        value={currentProvider ?? "auto"}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger
          className="w-[180px]"
          data-testid={`source-select-${metric.id}`}
        >
          <SelectValue placeholder="Auto" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto (most recent)</SelectItem>
          {metric.providers.map((providerId) => {
            const provider = getProvider(providerId);
            return (
              <SelectItem key={providerId} value={providerId}>
                {provider?.displayName ?? providerId}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
