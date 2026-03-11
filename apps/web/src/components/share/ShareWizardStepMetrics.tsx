"use client";

import { MetricSelector } from "@/components/dashboard/MetricSelector";
import type { HealthDataType } from "@/hooks/useHealthDataTypes";

interface ShareWizardStepMetricsProps {
  availableMetrics: HealthDataType[];
  selectedMetrics: string[];
  onSelectionChange: (metrics: string[]) => void;
  error?: string;
}

export function ShareWizardStepMetrics({
  availableMetrics,
  selectedMetrics,
  onSelectionChange,
  error,
}: ShareWizardStepMetricsProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Select Metrics</h3>
        <p className="text-muted-foreground text-sm">
          Choose which health metrics to include in this share. Only metrics you
          have data for are shown.
        </p>
      </div>

      <MetricSelector
        availableMetrics={availableMetrics}
        selectedMetrics={selectedMetrics}
        onSelectionChange={onSelectionChange}
        maxSelection={21}
      />

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
