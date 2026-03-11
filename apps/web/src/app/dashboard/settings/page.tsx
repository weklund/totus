import { Suspense } from "react";
import { ConnectionsManager } from "@/components/settings/ConnectionsManager";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { ExportSection } from "@/components/settings/ExportSection";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";
import { ApiKeysSection } from "@/components/settings/ApiKeysSection";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

/**
 * Settings page — account management with profile, connections, API keys, export, and deletion.
 *
 * This is the RSC shell; client components handle interactive sections.
 *
 * See: /docs/web-ui-lld.md Section 7.7
 */
export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground text-sm">
          Manage your account, connections, and API keys.
        </p>
      </div>

      {/* Profile section */}
      <section>
        <h3 className="mb-3 text-lg font-medium">Profile</h3>
        <p className="text-muted-foreground mb-4 text-sm">
          Update your display name. This is visible to anyone viewing your
          shared health data.
        </p>
        <Suspense
          fallback={
            <div className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full max-w-sm" />
              <Skeleton className="h-9 w-16" />
            </div>
          }
        >
          <ProfileForm />
        </Suspense>
      </section>

      <Separator />

      {/* Connections section */}
      <section>
        <h3 className="mb-3 text-lg font-medium">Data Sources</h3>
        <p className="text-muted-foreground mb-4 text-sm">
          Connect your health devices to import data into Totus.
        </p>
        <Suspense
          fallback={<Skeleton className="h-[72px] w-full rounded-lg" />}
        >
          <ConnectionsManager />
        </Suspense>
      </section>

      <Separator />

      {/* API Keys section */}
      <section>
        <h3 className="mb-3 text-lg font-medium">API Keys</h3>
        <p className="text-muted-foreground mb-4 text-sm">
          Create and manage API keys for CLI and programmatic access to your
          data.
        </p>
        <Suspense
          fallback={
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          }
        >
          <ApiKeysSection />
        </Suspense>
      </section>

      <Separator />

      {/* Export section */}
      <section>
        <h3 className="mb-3 text-lg font-medium">Export Data</h3>
        <ExportSection />
      </section>

      <Separator />

      {/* Danger zone */}
      <section>
        <h3 className="text-destructive mb-3 text-lg font-medium">
          Danger Zone
        </h3>
        <p className="text-muted-foreground mb-4 text-sm">
          Permanently delete your account and all associated data. This action
          cannot be undone.
        </p>
        <DeleteAccountDialog />
      </section>
    </div>
  );
}
