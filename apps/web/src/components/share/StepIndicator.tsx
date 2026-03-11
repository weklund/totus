"use client";

import { cn } from "@/lib/cn";
import { Check } from "lucide-react";

interface Step {
  label: string;
  number: number;
}

const STEPS: Step[] = [
  { label: "Metrics", number: 1 },
  { label: "Date Range", number: 2 },
  { label: "Expiration", number: 3 },
  { label: "Review", number: 4 },
];

interface StepIndicatorProps {
  currentStep: number;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div
      className="flex items-center justify-between"
      data-testid="step-indicator"
    >
      {STEPS.map((step, index) => {
        const isCompleted = step.number < currentStep;
        const isCurrent = step.number === currentStep;

        return (
          <div key={step.number} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors",
                  isCompleted
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-primary text-primary"
                      : "border-muted-foreground/30 text-muted-foreground/50",
                )}
              >
                {isCompleted ? <Check className="size-4" /> : step.number}
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  isCurrent
                    ? "text-foreground"
                    : isCompleted
                      ? "text-primary"
                      : "text-muted-foreground/50",
                )}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-0.5 flex-1",
                  isCompleted ? "bg-primary" : "bg-muted-foreground/20",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
