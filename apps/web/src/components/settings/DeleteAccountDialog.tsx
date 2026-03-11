"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";

const CONFIRMATION_STRING = "DELETE MY ACCOUNT";

/**
 * DeleteAccountDialog — account deletion with confirmation input.
 *
 * Opens a dialog where the user must type "DELETE MY ACCOUNT" exactly.
 * The delete button is disabled until the input matches.
 * On success: clears session and redirects to /.
 */
export function DeleteAccountDialog() {
  const [open, setOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const router = useRouter();
  const deleteAccount = useDeleteAccount();

  const isMatch = confirmInput === CONFIRMATION_STRING;

  const handleDelete = () => {
    if (!isMatch) return;

    deleteAccount.mutate(CONFIRMATION_STRING, {
      onSuccess: () => {
        toast.success("Account deleted successfully");
        setOpen(false);
        // Redirect to landing page
        router.push("/");
      },
      onError: () => {
        toast.error("Failed to delete account. Please try again.");
      },
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setConfirmInput("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive" data-testid="delete-account-button">
          <Trash2 className="mr-2 size-4" />
          Delete Account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Account</DialogTitle>
          <DialogDescription>
            This action is <strong>permanent and irreversible</strong>. All your
            health data, connections, and share links will be permanently
            deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <Label htmlFor="confirm-delete">
            Type <strong>{CONFIRMATION_STRING}</strong> to confirm
          </Label>
          <Input
            id="confirm-delete"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={CONFIRMATION_STRING}
            autoComplete="off"
            data-testid="delete-confirmation-input"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={deleteAccount.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isMatch || deleteAccount.isPending}
            data-testid="confirm-delete-button"
          >
            {deleteAccount.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Delete My Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
