"use client";

import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
import { useRevokeApiKey } from "@/hooks/useRevokeApiKey";

interface RevokeApiKeyDialogProps {
  open: boolean;
  keyId: string;
  keyName: string;
  onOpenChange: (open: boolean) => void;
  onRevoked: () => void;
}

/**
 * RevokeApiKeyDialog — confirmation dialog for revoking an API key.
 *
 * See: validation-contract.md VAL-MPUI-014
 */
export function RevokeApiKeyDialog({
  open,
  keyId,
  keyName,
  onOpenChange,
  onRevoked,
}: RevokeApiKeyDialogProps) {
  const revokeKey = useRevokeApiKey();

  async function handleRevoke() {
    try {
      await revokeKey.mutateAsync(keyId);
      toast.success("API key revoked");
      onRevoked();
    } catch {
      toast.error("Failed to revoke API key");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="revoke-api-key-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Revoke API Key
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to revoke{" "}
            <span className="font-medium">&ldquo;{keyName}&rdquo;</span>? Any
            applications using this key will immediately lose access. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revokeKey.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            disabled={revokeKey.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            data-testid="confirm-revoke-button"
          >
            {revokeKey.isPending && <Loader2 className="size-4 animate-spin" />}
            Revoke Key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
