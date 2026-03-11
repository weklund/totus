"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Unplug, Loader2, Wifi, WifiOff } from "lucide-react";
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
import type { Connection } from "@/hooks/useConnections";

interface ConnectionCardProps {
  /** Connection data from API. If undefined, shows "connect" state. */
  connection?: Connection;
  /** Callback after a successful disconnect */
  onDisconnected?: () => void;
}

/**
 * ConnectionCard — displays Oura connection status with sync/disconnect actions.
 *
 * If no connection prop is passed, shows the "Connect Oura Ring" button.
 * If connected, shows provider name, last sync time, sync status, and actions.
 */
export function ConnectionCard({
  connection,
  onDisconnected,
}: ConnectionCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const triggerSync = useTriggerSync();
  const disconnect = useDisconnect();

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const res = await api.get<{ data: { authorize_url: string } }>(
        "/connections/oura/authorize",
      );
      window.location.href = res.data.authorize_url;
    } catch {
      toast.error("Failed to start Oura connection. Please try again.");
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
        toast.success("Oura Ring disconnected.");
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
      <Card data-testid="connection-card-disconnected">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="bg-muted flex size-10 items-center justify-center rounded-full">
              <WifiOff className="text-muted-foreground size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Oura Ring</p>
              <p className="text-muted-foreground text-xs">Not connected</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting}
            data-testid="connect-oura-button"
          >
            {isConnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wifi className="size-3.5" />
            )}
            {isConnecting ? "Connecting..." : "Connect Oura Ring"}
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

  const statusBadge = () => {
    switch (connection.status) {
      case "connected":
        return <Badge variant="default">Connected</Badge>;
      case "expired":
        return <Badge variant="secondary">Token Expired</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
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
    <Card data-testid="connection-card-connected">
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 flex size-10 items-center justify-center rounded-full">
            <Wifi className="text-primary size-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Oura Ring</p>
              {statusBadge()}
              {syncStatusBadge()}
            </div>
            <p className="text-muted-foreground text-xs">
              Last synced {lastSyncText}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={triggerSync.isPending}
            data-testid="sync-now-button"
          >
            {triggerSync.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Sync Now
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={disconnect.isPending}
                data-testid="disconnect-button"
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
                <AlertDialogTitle>Disconnect Oura Ring?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the Oura connection. Your previously imported
                  health data will be kept. You can reconnect at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDisconnect}
                  data-testid="confirm-disconnect-button"
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
