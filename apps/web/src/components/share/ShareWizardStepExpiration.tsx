"use client";

import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EXPIRATION_OPTIONS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "Custom", days: 0 },
] as const;

interface ShareWizardStepExpirationProps {
  expiresInDays: number;
  onExpiresInDaysChange: (days: number) => void;
  customDays: string;
  onCustomDaysChange: (value: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  label: string;
  onLabelChange: (label: string) => void;
  error?: string;
}

export function ShareWizardStepExpiration({
  expiresInDays,
  onExpiresInDaysChange,
  customDays,
  onCustomDaysChange,
  note,
  onNoteChange,
  label,
  onLabelChange,
  error,
}: ShareWizardStepExpirationProps) {
  const isCustom = ![7, 30, 90].includes(expiresInDays);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Expiration &amp; Note</h3>
        <p className="text-muted-foreground text-sm">
          Set when the share link expires and add an optional note.
        </p>
      </div>

      {/* Label */}
      <div className="space-y-2">
        <Label htmlFor="share-label">Label</Label>
        <Input
          id="share-label"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="e.g., For Dr. Smith"
          maxLength={255}
        />
        <p className="text-muted-foreground text-xs">
          A short name to identify this share link.
        </p>
      </div>

      {/* Expiration radio buttons */}
      <div className="space-y-2">
        <Label>Link Expiration</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EXPIRATION_OPTIONS.map((option) => {
            const isSelected =
              option.days === 0 ? isCustom : expiresInDays === option.days;
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => {
                  if (option.days === 0) {
                    const parsed = parseInt(customDays, 10);
                    onExpiresInDaysChange(
                      !isNaN(parsed) && parsed > 0 ? parsed : 1,
                    );
                  } else {
                    onExpiresInDaysChange(option.days);
                  }
                }}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  isSelected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-accent",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {isCustom && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number"
              value={customDays}
              onChange={(e) => {
                onCustomDaysChange(e.target.value);
                const parsed = parseInt(e.target.value, 10);
                if (!isNaN(parsed) && parsed > 0 && parsed <= 365) {
                  onExpiresInDaysChange(parsed);
                }
              }}
              min={1}
              max={365}
              className="w-24"
              placeholder="Days"
            />
            <span className="text-muted-foreground text-sm">days (1-365)</span>
          </div>
        )}
      </div>

      {/* Note */}
      <div className="space-y-2">
        <Label htmlFor="share-note">Note (optional)</Label>
        <textarea
          id="share-note"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Add context about what you're sharing and why..."
          maxLength={1000}
          rows={3}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="text-muted-foreground text-xs">
          {note.length}/1000 characters
        </p>
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
