"use client";

import { useState } from "react";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ShareUrlDialogProps {
  open: boolean;
  shareUrl: string;
  onClose: () => void;
}

export function ShareUrlDialog({
  open,
  shareUrl,
  onClose,
}: ShareUrlDialogProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Share link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Only allow closing via the explicit close button, not backdrop
        if (!isOpen) return;
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Share Link Created</DialogTitle>
          <DialogDescription>
            Your share link has been created successfully. Copy it now and send
            it to your recipient.
          </DialogDescription>
        </DialogHeader>

        {/* URL display */}
        <div className="bg-muted flex items-center gap-2 rounded-lg border p-3">
          <code className="flex-1 truncate text-sm">{shareUrl}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="shrink-0 gap-1.5"
            aria-label={copied ? "Copied" : "Copy link"}
          >
            {copied ? (
              <>
                <Check className="size-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy
              </>
            )}
          </Button>
        </div>

        {/* Warning */}
        <div className="bg-warning/10 text-warning flex items-start gap-2 rounded-lg border border-orange-200 p-3 dark:border-orange-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm">
            <strong>Save this link now.</strong> It will not be shown again.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
