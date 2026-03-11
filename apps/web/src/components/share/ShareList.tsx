"use client";

import { useState, useMemo } from "react";
import { Link2, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareCard } from "./ShareCard";
import { RevokeDialog } from "./RevokeDialog";
import { DeleteDialog } from "./DeleteDialog";
import { useShares } from "@/hooks/useShares";
import { useRevokeShare } from "@/hooks/useRevokeShare";
import { useDeleteShare } from "@/hooks/useDeleteShare";
import type { ShareGrant } from "@/hooks/useShares";

interface ShareListProps {
  status: string;
}

export function ShareList({ status }: ShareListProps) {
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useShares(status);
  const revokeShare = useRevokeShare();
  const deleteShare = useDeleteShare();

  // Dialog state
  const [revokeTarget, setRevokeTarget] = useState<ShareGrant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShareGrant | null>(null);

  // Flatten pages
  const shares = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  function handleRevoke(shareId: string) {
    const share = shares.find((s) => s.id === shareId);
    if (share) setRevokeTarget(share);
  }

  function handleConfirmRevoke() {
    if (!revokeTarget) return;
    revokeShare.mutate(revokeTarget.id, {
      onSuccess: () => {
        toast.success("Share link revoked");
        setRevokeTarget(null);
      },
      onError: () => {
        toast.error("Failed to revoke share link");
      },
    });
  }

  function handleDelete(shareId: string) {
    const share = shares.find((s) => s.id === shareId);
    if (share) setDeleteTarget(share);
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    deleteShare.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Share link deleted");
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error("Failed to delete share link");
      },
    });
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="share-list-loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[140px] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-destructive text-sm">
          Failed to load shares. Please try again.
        </p>
      </div>
    );
  }

  // Empty state
  if (shares.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <div className="bg-muted flex size-16 items-center justify-center rounded-full">
          <Link2 className="text-muted-foreground size-8" />
        </div>
        <div className="text-center">
          <p className="font-medium">No shared links yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Create your first share to let a doctor or coach view your data.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/share/new">
            <Plus className="size-4" />
            Create Share
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="share-list">
      {shares.map((share) => (
        <ShareCard
          key={share.id}
          share={share}
          onRevoke={handleRevoke}
          onDelete={handleDelete}
        />
      ))}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="gap-1.5"
          >
            {isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
            Load More
          </Button>
        </div>
      )}

      {/* Revoke confirmation dialog */}
      <RevokeDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        onConfirm={handleConfirmRevoke}
        shareLabel={revokeTarget?.label}
        isPending={revokeShare.isPending}
      />

      {/* Delete confirmation dialog */}
      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
        shareLabel={deleteTarget?.label}
        isPending={deleteShare.isPending}
      />
    </div>
  );
}
