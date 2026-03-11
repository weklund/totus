"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ErrorCardProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorCard({
  title = "Something went wrong",
  message,
  onRetry,
}: ErrorCardProps) {
  return (
    <Card className="border-destructive/50" data-testid="error-card">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
        <AlertCircle className="text-destructive size-8" />
        <div className="text-center">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground mt-1 text-xs">{message}</p>
        </div>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-1.5"
            data-testid="retry-button"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
