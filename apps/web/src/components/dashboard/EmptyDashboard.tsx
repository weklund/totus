"use client";

import { useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/**
 * EmptyDashboard — full-page empty state when no connections exist.
 *
 * Displays an illustration, a heading asking the user to connect,
 * and a prominent "Connect Oura" button that initiates the OAuth flow.
 */
export function EmptyDashboard() {
  const [isConnecting, setIsConnecting] = useState(false);

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

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 py-24"
      data-testid="empty-dashboard"
    >
      <div className="bg-primary/10 flex size-20 items-center justify-center rounded-full">
        <Activity className="text-primary size-10" />
      </div>
      <div className="max-w-sm text-center">
        <h2 className="text-xl font-semibold">
          Connect your Oura Ring to get started
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Link your Oura Ring to visualize your sleep, activity, and recovery
          data all in one place.
        </p>
      </div>
      <Button
        size="lg"
        onClick={handleConnect}
        disabled={isConnecting}
        data-testid="empty-connect-oura-button"
      >
        {isConnecting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Activity className="size-4" />
        )}
        {isConnecting ? "Connecting..." : "Connect Oura"}
      </Button>
    </div>
  );
}
