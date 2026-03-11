"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Unplug, Loader2, Wifi, WifiOff, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTriggerSync } from "@/hooks/useTriggerSync";
import { useDisconnect } from "@/hooks/useDisconnect";
import { api } from "@/lib/api-client";
import { getProvider } from "@/config/providers";
import type { Connection } from "@/hooks/useConnections";
import type { ProviderId } from "@/config/providers";

interface ProviderConnectionCardProps {
  /** The provider ID to display */
  providerId: ProviderId;
  /** Connection data from API. If undefined, shows "connect" state. */
  connection?: Connection;
  /** Callback after a successful disconnect */
  onDisconnected?: () => void;
}

/**
 * ProviderConnectionCard — generic connection card for any provider.
 *
 * Accepts a provider config prop and shows the provider name dynamically,
 * status badge, sync/disconnect actions, and handles expired/error states
 * with a Reconnect button.
 */
export function ProviderConnectionCard({
  providerId,
  connection,
  onDisconnected,
}: ProviderConnectionCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const triggerSync = useTriggerSync();
  const disconnect = useDisconnect();

  const providerConfig = getProvider(providerId);
  const displayName = providerConfig?.displayName ?? providerId;

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const res = await api.get<{ data: { authorize_url: string } }>(
        `/connections/${providerId}/authorize`,
      );
      window.location.href = res.data.authorize_url;
    } catch {
      toast.error(
        `Failed to start ${displayName} connection. Please try again.`,
      );
      setIsConnecting(false);
    }
  };

  const handleSync = () => {
    if (!connection) return;
    triggerSync.mutate(connection.id, {
      onSuccess: (data) => {
        toast.success(data.data.message || "Sync completed successfully!");
      },
      onError: () => {
        toast.error("Sync failed. Please try again.");
      },
    });
  };

  const handleDisconnect = () => {
    if (!connection) return;
    disconnect.mutate(connection.id, {
      onSuccess: () => {
        toast.success(`${displayName} disconnected.`);
        onDisconnected?.();
      },
      onError: () => {
        toast.error("Failed to disconnect. Please try again.");
      },
    });
  };

  // Disconnected state — show connect CTA
  if (!connection) {
    return (
      <Card data-testid={`provider-card-${providerId}-disconnected`}>
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="bg-muted flex size-10 items-center justify-center rounded-full">
              <WifiOff className="text-muted-foreground size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">{displayName}</p>
              <p className="text-muted-foreground text-xs">Not connected</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting}
            data-testid={`connect-${providerId}-button`}
          >
            {isConnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wifi className="size-3.5" />
            )}
            {isConnecting ? "Connecting..." : `Connect`}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Connected state
  const lastSyncText = connection.last_sync_at
    ? formatDistanceToNow(new Date(connection.last_sync_at), {
        addSuffix: true,
      })
    : "Never synced";

  const isExpiredOrError =
    connection.status === "expired" || connection.status === "error";

  const statusBadge = () => {
    switch (connection.status) {
      case "active":
        return <Badge variant="default">Connected</Badge>;
      case "expired":
        return <Badge variant="secondary">Token Expired</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      case "paused":
        return <Badge variant="outline">Paused</Badge>;
      default:
        return null;
    }
  };

  const syncStatusBadge = () => {
    if (connection.sync_status === "syncing" || triggerSync.isPending) {
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          Syncing
        </Badge>
      );
    }
    return null;
  };

  return (
    <Card data-testid={`provider-card-${providerId}-connected`}>
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 flex size-10 items-center justify-center rounded-full">
            <Wifi className="text-primary size-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{displayName}</p>
              {statusBadge()}
              {syncStatusBadge()}
            </div>
            <p className="text-muted-foreground text-xs">
              Last synced {lastSyncText}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isExpiredOrError ? (
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={isConnecting}
              data-testid={`reconnect-${providerId}-button`}
            >
              {isConnecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogIn className="size-3.5" />
              )}
              Reconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={triggerSync.isPending}
              data-testid={`sync-${providerId}-button`}
            >
              {triggerSync.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Sync Now
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={disconnect.isPending}
                data-testid={`disconnect-${providerId}-button`}
              >
                {disconnect.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Unplug className="size-3.5" />
                )}
                Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect {displayName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the {displayName} connection. Your previously
                  imported health data will be kept. You can reconnect at any
                  time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDisconnect}
                  data-testid={`confirm-disconnect-${providerId}-button`}
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
