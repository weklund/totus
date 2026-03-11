"use client";

import { useState } from "react";
import { Plus, Key, Copy, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/dashboard/ErrorCard";
import { useApiKeys, type ApiKey } from "@/hooks/useApiKeys";
import { CreateApiKeyDialog } from "./CreateApiKeyDialog";
import { RevokeApiKeyDialog } from "./RevokeApiKeyDialog";

/**
 * ApiKeysSection — settings section for managing API keys.
 *
 * Lists existing keys (masked tokens), provides create and revoke actions.
 * Full key is shown only once on creation.
 *
 * See: validation-contract.md VAL-MPUI-012, VAL-MPUI-013, VAL-MPUI-014, VAL-MPUI-020
 */
export function ApiKeysSection() {
  const { data, isLoading, error, refetch } = useApiKeys();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="api-keys-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Failed to load API keys"
        message={error.message || "Could not load your API keys."}
        onRetry={() => refetch()}
      />
    );
  }

  const keys = data?.data ?? [];
  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <div className="space-y-4" data-testid="api-keys-section">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h4 className="text-sm font-medium">API Keys</h4>
          <p className="text-muted-foreground text-xs">
            Manage API keys for CLI and programmatic access.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateDialog(true)}
          className="gap-1.5"
          data-testid="create-api-key-button"
        >
          <Plus className="size-3.5" />
          Create Key
        </Button>
      </div>

      {/* Active keys */}
      {activeKeys.length === 0 && revokedKeys.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Key className="text-muted-foreground mx-auto mb-2 size-8" />
          <p className="text-muted-foreground text-sm">
            No API keys yet. Create one to use the CLI or MCP server.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeKeys.map((key) => (
            <ApiKeyRow
              key={key.id}
              apiKey={key}
              onRevoke={() => setRevokeKeyId(key.id)}
            />
          ))}
          {revokedKeys.map((key) => (
            <ApiKeyRow key={key.id} apiKey={key} />
          ))}
        </div>
      )}

      {/* Created key reveal */}
      {createdKey && (
        <CreatedKeyBanner
          fullKey={createdKey}
          onDismiss={() => setCreatedKey(null)}
        />
      )}

      {/* Create dialog */}
      <CreateApiKeyDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={(fullKey) => {
          setShowCreateDialog(false);
          setCreatedKey(fullKey);
        }}
      />

      {/* Revoke dialog */}
      {revokeKeyId && (
        <RevokeApiKeyDialog
          open={!!revokeKeyId}
          keyId={revokeKeyId}
          keyName={keys.find((k) => k.id === revokeKeyId)?.name ?? ""}
          onOpenChange={(open) => {
            if (!open) setRevokeKeyId(null);
          }}
          onRevoked={() => setRevokeKeyId(null)}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────

interface ApiKeyRowProps {
  apiKey: ApiKey;
  onRevoke?: () => void;
}

function ApiKeyRow({ apiKey, onRevoke }: ApiKeyRowProps) {
  const isRevoked = !!apiKey.revoked_at;

  return (
    <div
      className={`flex items-center justify-between rounded-lg border p-3 ${isRevoked ? "opacity-60" : ""}`}
      data-testid={`api-key-row-${apiKey.id}`}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <Key className="text-muted-foreground size-3.5" />
          <span className="truncate text-sm font-medium">{apiKey.name}</span>
          {isRevoked && (
            <Badge variant="destructive" className="text-[10px]">
              Revoked
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
            {apiKey.short_token}••••••••
          </code>
          <span>·</span>
          <span>{apiKey.scopes.join(", ")}</span>
          {apiKey.last_used_at && (
            <>
              <span>·</span>
              <span>
                Used{" "}
                {formatDistanceToNow(new Date(apiKey.last_used_at), {
                  addSuffix: true,
                })}
              </span>
            </>
          )}
          <span>·</span>
          <span>
            Created{" "}
            {formatDistanceToNow(new Date(apiKey.created_at), {
              addSuffix: true,
            })}
          </span>
        </div>
      </div>

      {!isRevoked && onRevoke && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          className="text-destructive hover:text-destructive ml-2 shrink-0"
          data-testid={`revoke-key-${apiKey.id}`}
        >
          Revoke
        </Button>
      )}
    </div>
  );
}

interface CreatedKeyBannerProps {
  fullKey: string;
  onDismiss: () => void;
}

function CreatedKeyBanner({ fullKey, onDismiss }: CreatedKeyBannerProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopied(true);
      toast.success("API key copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  return (
    <div
      className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-50 p-4 dark:bg-amber-950/20"
      data-testid="created-key-banner"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Save your API key now
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This key will not be shown again. Copy it and store it securely.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <code
          className="flex-1 truncate rounded bg-white px-3 py-2 font-mono text-sm dark:bg-black/20"
          data-testid="created-key-value"
        >
          {fullKey}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopy}
          className="shrink-0 gap-1.5"
          data-testid="copy-key-button"
        >
          <Copy className="size-3.5" />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>

      <Button size="sm" variant="ghost" onClick={onDismiss} className="text-xs">
        I&apos;ve saved it
      </Button>
    </div>
  );
}
