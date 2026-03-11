"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateApiKey } from "@/hooks/useCreateApiKey";

/** Available API key scopes */
const AVAILABLE_SCOPES = [
  {
    id: "health:read",
    label: "Health Data (Read)",
    description: "Read health metrics and data",
  },
  {
    id: "shares:read",
    label: "Shares (Read)",
    description: "List and view share links",
  },
  {
    id: "shares:write",
    label: "Shares (Write)",
    description: "Create and revoke shares",
  },
  {
    id: "audit:read",
    label: "Audit Log (Read)",
    description: "Read audit events",
  },
  {
    id: "connections:read",
    label: "Connections (Read)",
    description: "List connections",
  },
  {
    id: "connections:write",
    label: "Connections (Write)",
    description: "Manage connections and sync",
  },
  {
    id: "preferences:read",
    label: "Preferences (Read)",
    description: "Read metric preferences",
  },
  {
    id: "preferences:write",
    label: "Preferences (Write)",
    description: "Set metric preferences",
  },
  {
    id: "profile:read",
    label: "Profile (Read)",
    description: "Read user profile",
  },
  {
    id: "keys:write",
    label: "API Keys (Write)",
    description: "Create and revoke API keys",
  },
] as const;

interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (fullKey: string) => void;
}

/**
 * CreateApiKeyDialog — dialog for creating a new API key with scope selection.
 *
 * See: validation-contract.md VAL-MPUI-013
 */
export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateApiKeyDialogProps) {
  const createKey = useCreateApiKey();
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);

  function toggleScope(scopeId: string) {
    setSelectedScopes((prev) =>
      prev.includes(scopeId)
        ? prev.filter((s) => s !== scopeId)
        : [...prev, scopeId],
    );
  }

  function handleClose() {
    // Reset form state
    setName("");
    setSelectedScopes([]);
    onOpenChange(false);
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Please enter a name for the API key");
      return;
    }

    if (selectedScopes.length === 0) {
      toast.error("Please select at least one scope");
      return;
    }

    try {
      const result = await createKey.mutateAsync({
        name: name.trim(),
        scopes: selectedScopes,
      });

      toast.success("API key created");
      onCreated(result.data.key);
      setName("");
      setSelectedScopes([]);
    } catch {
      toast.error("Failed to create API key");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-[480px]"
        data-testid="create-api-key-dialog"
      >
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Create a new API key for CLI or programmatic access. Select the
            permissions this key should have.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name input */}
          <div className="space-y-2">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              placeholder="e.g., CLI access, MCP server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="api-key-name-input"
            />
          </div>

          {/* Scope selector */}
          <div className="space-y-2">
            <Label>Scopes</Label>
            <div className="grid gap-2" data-testid="scope-selector">
              {AVAILABLE_SCOPES.map((scope) => {
                const isSelected = selectedScopes.includes(scope.id);
                return (
                  <label
                    key={scope.id}
                    className="hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-center gap-3 rounded-md border p-2 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleScope(scope.id)}
                      className="border-input size-4 rounded"
                      data-testid={`scope-${scope.id}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{scope.label}</p>
                      <p className="text-muted-foreground text-xs">
                        {scope.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              createKey.isPending || !name.trim() || selectedScopes.length === 0
            }
            className="gap-1.5"
            data-testid="create-key-submit"
          >
            {createKey.isPending && <Loader2 className="size-4 animate-spin" />}
            Create Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
