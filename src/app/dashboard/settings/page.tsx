import { Suspense } from "react";
import { ConnectionsManager } from "@/components/settings/ConnectionsManager";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

/**
 * Settings page — account management with profile, connections, export, and deletion.
 *
 * This is the RSC shell; client components handle interactive sections.
 * Currently implements the ConnectionsManager section.
 * Profile, export, and danger zone sections will be added by later features.
 *
 * The page title "Settings" is rendered by the Header component via pathname detection.
 */
export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-muted-foreground text-sm">
          Manage your account and connections.
        </p>
      </div>

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

      {/* Placeholder for future settings sections */}
      <section>
        <h3 className="text-muted-foreground mb-3 text-lg font-medium">
          More settings coming soon
        </h3>
        <p className="text-muted-foreground text-sm">
          Profile editing, data export, and account management will be available
          in a future update.
        </p>
      </section>
    </div>
  );
}
