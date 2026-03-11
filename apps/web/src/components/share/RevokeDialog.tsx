"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  shareLabel?: string;
  isPending?: boolean;
}

export function RevokeDialog({
  open,
  onOpenChange,
  onConfirm,
  shareLabel,
  isPending,
}: RevokeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke Share Link</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to revoke{" "}
            {shareLabel ? (
              <strong>&ldquo;{shareLabel}&rdquo;</strong>
            ) : (
              "this share link"
            )}
            ? Anyone with this link will immediately lose access to your shared
            data. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            variant="destructive"
            disabled={isPending}
          >
            {isPending ? "Revoking..." : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
