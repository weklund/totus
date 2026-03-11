"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StepIndicator } from "./StepIndicator";
import { ShareWizardStepMetrics } from "./ShareWizardStepMetrics";
import { ShareWizardStepDateRange } from "./ShareWizardStepDateRange";
import { ShareWizardStepExpiration } from "./ShareWizardStepExpiration";
import { ShareWizardStepReview } from "./ShareWizardStepReview";
import { useCreateShare } from "@/hooks/useCreateShare";
import type { HealthDataType } from "@/hooks/useHealthDataTypes";

interface ShareWizardProps {
  availableMetrics: HealthDataType[];
  onCreated: (share: { id: string; share_url: string; token: string }) => void;
  onCancel: () => void;
}

function generateLabel(metrics: string[], metricTypes: HealthDataType[]) {
  const labels = metrics
    .map((m) => metricTypes.find((t) => t.metric_type === m)?.label ?? m)
    .slice(0, 3);
  const suffix = metrics.length > 3 ? ` +${metrics.length - 3} more` : "";
  return `Shared ${labels.join(", ")}${suffix}`;
}

export function ShareWizard({
  availableMetrics,
  onCreated,
  onCancel,
}: ShareWizardProps) {
  const createShare = useCreateShare();

  // Wizard state
  const [step, setStep] = useState(1);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: format(subDays(new Date(), 90), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"),
  });
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [customDays, setCustomDays] = useState("30");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [labelEdited, setLabelEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-generate label when metrics change (unless user has manually edited)
  function handleMetricsChange(metrics: string[]) {
    setSelectedMetrics(metrics);
    if (!labelEdited) {
      setLabel(generateLabel(metrics, availableMetrics));
    }
    if (errors.metrics) {
      setErrors((prev) => ({ ...prev, metrics: "" }));
    }
  }

  function handleLabelChange(value: string) {
    setLabel(value);
    setLabelEdited(true);
  }

  function validateStep(): boolean {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (selectedMetrics.length === 0) {
        newErrors.metrics = "Select at least one metric";
      }
    }

    if (step === 2) {
      if (!dateRange.start || !dateRange.end) {
        newErrors.dateRange = "Select a date range";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleNext() {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, 4));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleSubmit() {
    try {
      const result = await createShare.mutateAsync({
        label: label || generateLabel(selectedMetrics, availableMetrics),
        allowed_metrics: selectedMetrics,
        data_start: dateRange.start,
        data_end: dateRange.end,
        expires_in_days: expiresInDays,
        note: note || undefined,
      });

      toast.success("Share link created!");
      onCreated({
        id: result.data.id,
        share_url: result.data.share_url,
        token: result.data.token,
      });
    } catch {
      toast.error("Failed to create share link. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Step indicator */}
      <StepIndicator currentStep={step} />

      {/* Step info */}
      <p className="text-muted-foreground text-center text-sm">
        Step {step} of 4
      </p>

      {/* Step content */}
      <Card>
        <CardContent className="pt-6">
          {step === 1 && (
            <ShareWizardStepMetrics
              availableMetrics={availableMetrics}
              selectedMetrics={selectedMetrics}
              onSelectionChange={handleMetricsChange}
              error={errors.metrics}
            />
          )}

          {step === 2 && (
            <ShareWizardStepDateRange
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              error={errors.dateRange}
            />
          )}

          {step === 3 && (
            <ShareWizardStepExpiration
              expiresInDays={expiresInDays}
              onExpiresInDaysChange={setExpiresInDays}
              customDays={customDays}
              onCustomDaysChange={setCustomDays}
              note={note}
              onNoteChange={setNote}
              label={label}
              onLabelChange={handleLabelChange}
            />
          )}

          {step === 4 && (
            <ShareWizardStepReview
              selectedMetrics={selectedMetrics}
              dateRange={dateRange}
              expiresInDays={expiresInDays}
              label={label}
              note={note}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <div>
          {step === 1 ? (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
          )}
        </div>

        <div>
          {step < 4 ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={createShare.isPending}
              className="gap-1.5"
            >
              {createShare.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Create Share Link
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
