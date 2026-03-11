"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareWizard } from "@/components/share/ShareWizard";
import { ShareUrlDialog } from "@/components/share/ShareUrlDialog";
import { useHealthDataTypes } from "@/hooks/useHealthDataTypes";

/**
 * Share Wizard page — 4-step guided flow for creating a new share grant.
 */
export default function ShareWizardPage() {
  const router = useRouter();
  const { data: typesData, isLoading } = useHealthDataTypes();
  const availableMetrics = useMemo(
    () => typesData?.data?.types ?? [],
    [typesData],
  );

  // URL dialog state
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  function handleCreated(share: {
    id: string;
    share_url: string;
    token: string;
  }) {
    setShareUrl(share.share_url);
  }

  function handleDialogClose() {
    setShareUrl(null);
    router.push("/dashboard/share");
  }

  function handleCancel() {
    router.push("/dashboard/share");
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 gap-1.5">
          <Link href="/dashboard/share">
            <ArrowLeft className="size-3.5" />
            Back to Shares
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Create Share Link</h2>
        <p className="text-muted-foreground text-sm">
          Create a secure link to share your health data with a doctor, coach,
          or anyone you trust.
        </p>
      </div>

      {/* Wizard or loading */}
      {isLoading ? (
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ) : availableMetrics.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-muted-foreground text-sm">
            No health data available to share. Connect your Oura Ring and sync
            data first.
          </p>
          <Button asChild className="mt-4">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </div>
      ) : (
        <ShareWizard
          availableMetrics={availableMetrics}
          onCreated={handleCreated}
          onCancel={handleCancel}
        />
      )}

      {/* URL dialog */}
      {shareUrl && (
        <ShareUrlDialog
          open={!!shareUrl}
          shareUrl={shareUrl}
          onClose={handleDialogClose}
        />
      )}
    </div>
  );
}
