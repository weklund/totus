"use client";

import { useState } from "react";
import { Plus, Wifi, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { getAllProviders } from "@/config/providers";
import type { ProviderId } from "@/config/providers";
import type { Connection } from "@/hooks/useConnections";

/**
 * Set of providers that are fully implemented and can be connected via OAuth.
 * Only Oura is currently implemented; others are stubs.
 */
const IMPLEMENTED_PROVIDERS = new Set<ProviderId>(["oura"]);

interface AddProviderDialogProps {
  /** Current user connections to show "Connected" badges */
  connections: Connection[];
  /** Custom trigger element. If not provided, renders a default "Add" button */
  trigger?: React.ReactNode;
  /** Optional callback when dialog opens/closes */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state */
  open?: boolean;
}

/**
 * AddProviderDialog — dialog with a grid of all supported providers.
 *
 * Connected providers show a "Connected" badge.
 * Unimplemented (stub) providers show "Coming Soon" and cannot start OAuth.
 * Clicking an implemented, unconnected provider starts the OAuth flow.
 */
export function AddProviderDialog({
  connections,
  trigger,
  onOpenChange,
  open: controlledOpen,
}: AddProviderDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(
    null,
  );

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const allProviders = getAllProviders();
  const connectedProviderIds = new Set(connections.map((c) => c.provider));

  const handleProviderClick = async (providerId: ProviderId) => {
    // "Coming Soon" providers: show info, no OAuth
    if (!IMPLEMENTED_PROVIDERS.has(providerId)) {
      toast.info(
        `${allProviders.find((p) => p.id === providerId)?.displayName ?? providerId} integration is coming soon!`,
      );
      return;
    }

    // Already connected
    if (connectedProviderIds.has(providerId)) {
      toast.info("This provider is already connected.");
      return;
    }

    // Start OAuth flow
    setConnectingProvider(providerId);
    try {
      const res = await api.get<{ data: { authorize_url: string } }>(
        `/connections/${providerId}/authorize`,
      );
      window.location.href = res.data.authorize_url;
    } catch {
      const displayName =
        allProviders.find((p) => p.id === providerId)?.displayName ??
        providerId;
      toast.error(
        `Failed to start ${displayName} connection. Please try again.`,
      );
      setConnectingProvider(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" data-testid="add-provider-button">
            <Plus className="size-3.5" />
            Add Source
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" data-testid="add-provider-dialog">
        <DialogHeader>
          <DialogTitle>Connect a Data Source</DialogTitle>
          <DialogDescription>
            Choose a health data provider to connect. Your data will be synced
            automatically.
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid grid-cols-2 gap-3 pt-2"
          data-testid="provider-grid"
        >
          {allProviders.map((provider) => {
            const isConnected = connectedProviderIds.has(provider.id);
            const isImplemented = IMPLEMENTED_PROVIDERS.has(provider.id);
            const isConnecting = connectingProvider === provider.id;
            const isComingSoon = !isImplemented;

            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => handleProviderClick(provider.id)}
                disabled={isConnecting || isConnected}
                className={`relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${
                  isConnected
                    ? "border-primary/30 bg-primary/5 cursor-default"
                    : isComingSoon
                      ? "border-border/50 hover:bg-accent/50 cursor-default opacity-60"
                      : "border-border hover:bg-accent cursor-pointer"
                }`}
                data-testid={`provider-option-${provider.id}`}
              >
                <div
                  className={`flex size-10 items-center justify-center rounded-full ${
                    isConnected ? "bg-primary/10" : "bg-muted"
                  }`}
                >
                  {isConnecting ? (
                    <Loader2 className="text-primary size-5 animate-spin" />
                  ) : (
                    <Wifi
                      className={`size-5 ${isConnected ? "text-primary" : "text-muted-foreground"}`}
                    />
                  )}
                </div>
                <span className="text-sm font-medium">
                  {provider.displayName}
                </span>
                {isConnected && (
                  <Badge
                    variant="default"
                    className="text-[10px]"
                    data-testid={`provider-connected-badge-${provider.id}`}
                  >
                    Connected
                  </Badge>
                )}
                {isComingSoon && !isConnected && (
                  <Badge
                    variant="outline"
                    className="gap-1 text-[10px]"
                    data-testid={`provider-coming-soon-${provider.id}`}
                  >
                    <Clock className="size-2.5" />
                    Coming Soon
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
