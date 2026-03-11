"use client";

import { useState } from "react";
import { Download, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useExportData } from "@/hooks/useExportData";

/**
 * ExportSection — data export trigger with download link.
 *
 * Calls POST /api/user/export, then creates a downloadable JSON file.
 */
export function ExportSection() {
  const exportData = useExportData();
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const handleExport = () => {
    exportData.mutate(undefined, {
      onSuccess: (response) => {
        // Create a Blob from the export data for download
        const blob = new Blob([JSON.stringify(response.data.export, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        toast.success("Data export ready for download!");
      },
      onError: () => {
        toast.error("Failed to export data. Please try again.");
      },
    });
  };

  return (
    <div className="space-y-3" data-testid="export-section">
      <p className="text-muted-foreground text-sm">
        Download all your health data, shares, and audit log as a JSON file.
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exportData.isPending}
          data-testid="export-data-button"
        >
          {exportData.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Download className="mr-2 size-4" />
          )}
          Export All Data
        </Button>

        {downloadUrl && (
          <a
            href={downloadUrl}
            download={`totus-export-${new Date().toISOString().slice(0, 10)}.json`}
            className="text-primary inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
            data-testid="export-download-link"
          >
            <Check className="size-4" />
            Download ready — click to save
          </a>
        )}
      </div>
    </div>
  );
}
