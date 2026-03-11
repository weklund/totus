# Totus MVP Low-Level Design: Web UI Layer

### Version 1.1 — March 2026

### Author: Architecture Team

### Status: Draft — Awaiting Founder Review

---

## 1. Overview

**Purpose.** This document specifies the complete low-level design for the Totus MVP frontend — the Next.js application that owners and viewers interact with. It defines every page, every component with its props interface, every data fetching pattern, every state management decision, and every styling convention. It is the implementation blueprint for the UI layer — an engineer (or AI coding agent) should be able to build the frontend by following this document.

**Audience.** The founder (Wes Eklund), implementation agents, and any future frontend engineers.

**Prerequisite Reading.**

- Totus MVP PRD (v1.0) — `/docs/mvp-prd.md`
- Totus Architecture Design (v1.0) — `/docs/architecture-design.md`
- Totus API & Database LLD (v1.0) — `/docs/api-database-lld.md`
- Totus Integrations Pipeline LLD (v1.1) — `/docs/integrations-pipeline-lld.md`

**Scope.** Frontend only. This document covers the Next.js App Router pages, React components, client-side state management, data fetching hooks, styling system, tooling, testing, and accessibility. It does NOT cover API route handler implementations, database queries, encryption logic, or provider sync — those are specified in the API & Database LLD and Integrations Pipeline LLD. The API contract defined in that document is treated as a stable input.

**Relationship to Other Documents.**

- The Architecture Design defines the unified viewer pattern, route structure, conditional rendering approach, and `RequestContext` shape. This LLD implements those patterns as concrete React components.
- The API & Database LLD defines every endpoint, request/response schema, and error code. This LLD consumes those endpoints via typed fetch hooks.

---

## 2. Problem Statement

The Architecture Design established the system's high-level UI shape: a unified viewer pattern, role-aware conditional rendering, and a `DashboardShell` component hierarchy. The API & Database LLD specified every endpoint the UI must consume. What neither document specifies is the concrete frontend implementation — the exact component tree, props interfaces, data fetching hooks, state management patterns, styling tokens, file structure, and tooling configuration that an implementation agent needs to build a working, accessible, performant frontend.

This LLD closes that gap. It translates architectural decisions into concrete, implementable frontend specifications. Every UI ambiguity in the upstream documents is resolved here with an explicit decision.

---

## 3. Glossary

| Term                  | Definition                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RSC**               | React Server Component — a component that renders on the server, can directly `await` data, and sends only HTML to the client. Cannot use hooks or browser APIs. |
| **Client Component**  | A React component marked with `"use client"` that runs in the browser. Can use hooks, event handlers, and browser APIs.                                          |
| **App Router**        | Next.js 15's file-system-based routing using the `app/` directory, with layouts, loading states, and error boundaries as conventions.                            |
| **View Context**      | A React Context that provides `{ role, permissions, userId?, grantId? }` to all components, derived from the server-side `RequestContext`.                       |
| **DashboardShell**    | The top-level layout component containing Header, sidebar navigation, and content area. Used by both owner and viewer routes.                                    |
| **Metric Chip**       | A toggleable UI element representing a single health metric (e.g., "Sleep Score", "HRV"). Owners can toggle freely; viewers see only granted metrics.            |
| **Share Wizard**      | A multi-step form for creating share grants: select metrics, set date range, set expiration, add note, confirm.                                                  |
| **Optimistic Update** | A UI pattern where the interface reflects a mutation immediately (before server confirmation), rolling back on error. Used for share revocation.                 |
| **Skeleton**          | A placeholder UI (gray animated shapes) shown while data is loading, matching the layout of the eventual content.                                                |
| **Toast**             | A brief, non-blocking notification that appears at the bottom-right of the screen (e.g., "Share link copied to clipboard").                                      |
| **Design Token**      | A named constant for a visual property (color, spacing, font size) used consistently across the UI. Defined in Tailwind config.                                  |
| **Hydration**         | The process where React attaches event handlers to server-rendered HTML, making it interactive.                                                                  |

---

## 4. Tenets

These tenets guide every frontend design decision in this document. When tenets conflict, earlier tenets take priority.

1. **The API is the security boundary, not the UI.** Frontend role checks and conditional rendering are UX conveniences. Never trust the client. Never store secrets in client bundles. Never assume the frontend can enforce access control. The API validates, authorizes, and audits independently.

2. **Server-first, client when necessary.** Use React Server Components for initial page loads and data fetching. Use Client Components only when interactivity (hooks, event handlers, browser APIs) is required. This minimizes client JavaScript, improves initial load performance, and simplifies data fetching.

3. **Progressive disclosure over information overload.** Show the most important metrics first. Let users drill down. Do not display 21 metrics simultaneously. Default to a curated view (sleep score, HRV, RHR, steps, readiness score) and let users customize.

4. **Perceived performance over absolute performance.** Show skeleton loaders immediately. Stream data as it becomes available. Use optimistic updates for mutations. The user should never see a blank screen or a spinner with no context.

5. **Accessibility is not a phase; it is a constraint.** Every component must be keyboard-navigable, screen-reader-compatible, and meet WCAG 2.1 AA contrast ratios. Charts must have tabular data alternatives.

6. **One component, two roles.** Components should work for both owners and viewers through props and context, not through separate codepaths. Conditional rendering within a component is preferred over duplicating components.

7. **Explicit loading, error, and empty states.** Every data-dependent component must handle three states: loading (skeleton), error (retry action), and empty (call to action). No component should render nothing or break silently.

---

## 5. Requirements

### 5.1 Functional Requirements

| ID       | Requirement                                                                            | Source                |
| -------- | -------------------------------------------------------------------------------------- | --------------------- |
| FR-UI-1  | Landing page with value proposition, feature summary, and sign-up CTA                  | PRD                   |
| FR-UI-2  | Clerk-powered sign-in and sign-up pages with 2FA enrollment                            | Arch: Section 2       |
| FR-UI-3  | Dashboard with interactive time-series charts for health metrics                       | PRD: Dashboard        |
| FR-UI-4  | One-click provider OAuth connection flow from dashboard                                | PRD: Dashboard        |
| FR-UI-5  | Metric selector supporting up to 3 simultaneous overlays                               | PRD: Dashboard        |
| FR-UI-6  | Date range selector with zoom presets (1W, 1M, 3M, 6M, 1Y, 5Y, All)                    | PRD: Dashboard        |
| FR-UI-7  | Resolution toggle (daily/weekly/monthly)                                               | API: resolution param |
| FR-UI-8  | Share creation wizard (metrics, date range, expiration, note)                          | PRD: Secure Sharing   |
| FR-UI-9  | Share management page with list, revoke, and delete actions                            | PRD: Secure Sharing   |
| FR-UI-10 | Audit log viewer with filters (event type, actor, date range) and pagination           | PRD: Transparency     |
| FR-UI-11 | Viewer page (`/v/[token]`) with read-only dashboard, constrained to grant scope        | Arch: Section 3       |
| FR-UI-12 | Settings page with display name edit, data export, and account deletion                | PRD: Data Control     |
| FR-UI-13 | Connection management (connect, disconnect, sync status, manual sync trigger)          | API: Connections      |
| FR-UI-14 | Toast notifications for async operations (share created, data exported, sync complete) | UX best practice      |
| FR-UI-15 | Copy-to-clipboard for share URLs                                                       | PRD: Secure Sharing   |

### 5.2 Non-Functional Requirements

| ID        | Requirement                                | Target                                                | Source             |
| --------- | ------------------------------------------ | ----------------------------------------------------- | ------------------ |
| NFR-UI-1  | Dashboard initial load (LCP)               | < 2 seconds on 4G                                     | PRD                |
| NFR-UI-2  | Time to Interactive (TTI)                  | < 3 seconds on 4G                                     | Web Vitals         |
| NFR-UI-3  | Cumulative Layout Shift (CLS)              | < 0.1                                                 | Web Vitals         |
| NFR-UI-4  | First Input Delay (FID)                    | < 100ms                                               | Web Vitals         |
| NFR-UI-5  | Client JavaScript bundle (initial)         | < 150 KB gzipped                                      | Performance budget |
| NFR-UI-6  | Accessibility                              | WCAG 2.1 AA compliance                                | Tenet 5            |
| NFR-UI-7  | Browser support                            | Last 2 versions of Chrome, Firefox, Safari, Edge      | MVP scope          |
| NFR-UI-8  | Responsive design                          | Functional at 375px (mobile) through 1920px (desktop) | UX                 |
| NFR-UI-9  | Dark mode                                  | System-preference detection with manual toggle        | UX                 |
| NFR-UI-10 | Chart rendering with 5 years of daily data | < 500ms after data arrives                            | PRD                |

### 5.3 Out of Scope

- Native mobile applications
- Offline support / service workers
- Real-time data updates (WebSocket/SSE)
- PDF export of charts
- Custom chart themes beyond light/dark
- Internationalization (i18n) — English only for MVP
- Animation library (Framer Motion) — CSS transitions only for MVP

---

## 6. Architecture Overview

### 6.1 Component Tree (High-Level)

```
app/
  layout.tsx                    (RootLayout — RSC, Clerk provider, theme)
  page.tsx                      (Landing page — RSC)
  sign-in/[[...sign-in]]/
    page.tsx                    (Clerk SignIn — Client)
  sign-up/[[...sign-up]]/
    page.tsx                    (Clerk SignUp — Client)
  dashboard/
    layout.tsx                  (DashboardLayout — RSC, auth gate, sidebar)
    page.tsx                    (Dashboard — RSC shell + Client charts)
    share/
      page.tsx                  (Share management — RSC shell + Client list)
      new/
        page.tsx                (Share wizard — Client)
    audit/
      page.tsx                  (Audit log — RSC shell + Client table)
    settings/
      page.tsx                  (Settings — RSC shell + Client forms)
  v/[token]/
    page.tsx                    (Viewer — RSC validation + Client charts)
```

### 6.2 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER                                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              React Server Components                      │   │
│  │                                                          │   │
│  │  1. Middleware produces RequestContext (role, perms)      │   │
│  │  2. RSC reads context, fetches initial data server-side  │   │
│  │  3. RSC renders HTML + passes serialized data as props   │   │
│  │     to Client Components                                 │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                          │ Props (serialized)                    │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │              Client Components                            │   │
│  │                                                          │   │
│  │  ViewContextProvider (role, permissions)                  │   │
│  │    ├── DashboardShell (layout)                           │   │
│  │    │   ├── Header (role-aware nav)                       │   │
│  │    │   ├── MetricSelector (toggle metrics)               │   │
│  │    │   ├── DateRangeSelector (pick date range)           │   │
│  │    │   └── ChartGrid (render charts)                     │   │
│  │    │       └── MetricChart (Recharts time-series)        │   │
│  │    └── ActionBar (owner-only: share, export)             │   │
│  │                                                          │   │
│  │  TanStack Query manages:                                 │   │
│  │    - Client-side data refetching on filter changes       │   │
│  │    - Mutations (share create, revoke, profile update)    │   │
│  │    - Cache invalidation                                  │   │
│  │    - Optimistic updates                                  │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                          │ fetch()                               │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  /api/*     │
                    │  (Next.js   │
                    │  API routes)│
                    └─────────────┘
```

### 6.3 Server vs Client Component Strategy

| Component Type                             | Server or Client | Rationale                                   |
| ------------------------------------------ | ---------------- | ------------------------------------------- |
| Page shells (layout, initial data)         | Server           | Fetch data without client JS, stream HTML   |
| Auth gates (redirect if not authenticated) | Server           | Middleware + RSC check, no flash of content |
| Charts (Recharts)                          | Client           | Requires DOM, event handlers, canvas        |
| Form inputs (selectors, wizards)           | Client           | Requires state, event handlers              |
| Toasts and modals                          | Client           | Requires portal, state management           |
| Static content (landing, error pages)      | Server           | No interactivity needed                     |
| Data tables (audit log, share list)        | Client           | Sorting, pagination interactions            |

### 6.4 File Structure

```
src/
  app/                          # Next.js App Router pages
    layout.tsx                  # Root layout (RSC)
    page.tsx                    # Landing page (RSC)
    globals.css                 # Tailwind imports + CSS custom properties
    sign-in/[[...sign-in]]/page.tsx
    sign-up/[[...sign-up]]/page.tsx
    dashboard/
      layout.tsx                # Dashboard layout with sidebar (RSC)
      page.tsx                  # Main dashboard (RSC)
      share/page.tsx            # Share management (RSC)
      share/new/page.tsx        # Share wizard (Client)
      audit/page.tsx            # Audit log (RSC)
      settings/page.tsx         # Settings (RSC)
    v/[token]/page.tsx          # Viewer page (RSC)
    not-found.tsx               # Custom 404
    error.tsx                   # Global error boundary (Client)

  components/
    layout/
      RootProviders.tsx         # Client: ThemeProvider, QueryClientProvider
      DashboardShell.tsx        # Client: sidebar + content area
      Header.tsx                # Client: role-aware header
      Sidebar.tsx               # Client: navigation sidebar
      Footer.tsx                # Server: landing page footer
    dashboard/
      MetricSelector.tsx        # Client: metric chip toggles
      DateRangeSelector.tsx     # Client: date range picker + presets
      ResolutionToggle.tsx      # Client: daily/weekly/monthly
      ChartGrid.tsx             # Client: responsive chart layout
      MetricChart.tsx           # Client: single Recharts time-series
      ChartTooltip.tsx          # Client: custom tooltip for charts
      OverlayLegend.tsx         # Client: legend for overlaid metrics
      ProviderConnectionCard.tsx # Client: provider connection status (one per connected provider)
      AddProviderDialog.tsx     # Client: dialog to connect a new data source
      SourceBadge.tsx           # Client: small provider icon + name badge on data points
      SourcePreferenceSelector.tsx # Client: per-metric source preference picker
      EmptyDashboard.tsx        # Client: empty state with connect CTA
      IntradayChart.tsx         # Client: intraday series chart (glucose, heart rate)
      PeriodTimeline.tsx        # Client: duration event timeline (sleep stages, workouts, meals)
    share/
      ShareWizard.tsx           # Client: multi-step share creation
      ShareWizardStepMetrics.tsx
      ShareWizardStepDateRange.tsx
      ShareWizardStepExpiration.tsx
      ShareWizardStepReview.tsx
      ShareList.tsx             # Client: paginated share list
      ShareCard.tsx             # Client: single share grant card
      ShareUrlDialog.tsx        # Client: modal showing new share URL
      RevokeDialog.tsx          # Client: confirmation dialog
    audit/
      AuditTable.tsx            # Client: paginated audit event table
      AuditEventRow.tsx         # Client: single audit event
      AuditFilters.tsx          # Client: filter controls
    settings/
      ProfileForm.tsx           # Client: display name form
      ExportSection.tsx         # Client: data export trigger
      DeleteAccountDialog.tsx   # Client: account deletion with confirm
      ConnectionsManager.tsx    # Client: manage all provider connections + source preferences
    viewer/
      ViewerHeader.tsx          # Client: viewer-specific header
      ViewerBanner.tsx          # Client: "Shared by X" banner
      ShareExpiredPage.tsx      # Server: expired/invalid share page
    landing/
      Hero.tsx                  # Server: hero section
      Features.tsx              # Server: feature cards
      HowItWorks.tsx            # Server: 3-step process
      CallToAction.tsx          # Server: sign-up CTA
    ui/                         # shadcn/ui primitives (generated)
      button.tsx
      card.tsx
      dialog.tsx
      dropdown-menu.tsx
      input.tsx
      label.tsx
      popover.tsx
      select.tsx
      separator.tsx
      skeleton.tsx
      switch.tsx
      tabs.tsx
      toast.tsx
      toaster.tsx
      tooltip.tsx
      badge.tsx
      calendar.tsx
      command.tsx
      scroll-area.tsx
      sheet.tsx
      table.tsx

  hooks/
    useViewContext.tsx           # View context hook (role, permissions)
    useHealthData.ts            # TanStack Query: GET /api/health-data (daily aggregates)
    useSeriesData.ts            # TanStack Query: GET /api/health-data/series (intraday)
    usePeriodsData.ts           # TanStack Query: GET /api/health-data/periods (events)
    useHealthDataTypes.ts       # TanStack Query: GET /api/health-data/types
    useConnections.ts           # TanStack Query: GET /api/connections
    useSourcePreferences.ts     # TanStack Query: GET /api/metric-preferences
    useSetSourcePreference.ts   # TanStack Query mutation: PUT /api/metric-preferences/:metricType
    useClearSourcePreference.ts # TanStack Query mutation: DELETE /api/metric-preferences/:metricType
    useShares.ts                # TanStack Query: GET /api/shares
    useCreateShare.ts           # TanStack Query mutation: POST /api/shares
    useRevokeShare.ts           # TanStack Query mutation: PATCH /api/shares/:id
    useDeleteShare.ts           # TanStack Query mutation: DELETE /api/shares/:id
    useAuditLog.ts              # TanStack Query: GET /api/audit (infinite)
    useUserProfile.ts           # TanStack Query: GET /api/user/profile
    useUpdateProfile.ts         # TanStack Query mutation: PATCH /api/user/profile
    useExportData.ts            # TanStack Query mutation: POST /api/user/export
    useDeleteAccount.ts         # TanStack Query mutation: DELETE /api/user
    useTriggerSync.ts           # TanStack Query mutation: POST /api/connections/:id/sync
    useDisconnect.ts            # TanStack Query mutation: DELETE /api/connections/:id
    useViewerValidate.ts        # TanStack Query mutation: POST /api/viewer/validate
    useViewerData.ts            # TanStack Query: GET /api/viewer/data
    useMediaQuery.ts            # Responsive breakpoint detection
    useCopyToClipboard.ts       # Clipboard API wrapper
    useChartDimensions.ts       # ResizeObserver for responsive charts

  lib/
    api-client.ts               # Typed fetch wrapper with error handling
    view-context.tsx            # ViewContext definition and provider
    query-client.ts             # TanStack Query client configuration
    metric-config.ts            # Metric type registry (labels, units, colors, categories)
    date-utils.ts               # Date range calculations, presets, formatting
    chart-utils.ts              # Chart color palette, axis formatting, data transforms
    format.ts                   # Number formatting, relative time, truncation
    constants.ts                # Route paths, breakpoints, limits
    validators.ts               # Shared Zod schemas (re-exported from API layer)
    cn.ts                       # Tailwind class merge utility (clsx + tailwind-merge)

  types/
    api.ts                      # API response types (generated from Zod schemas)
    metrics.ts                  # Metric type enum and config types
    view-context.ts             # ViewContext and permissions types
    chart.ts                    # Chart data types and options
```

---

## 7. Page Designs

### 7.1 Landing Page — `/`

**Access:** Public (no auth required)
**Component Type:** React Server Component (static, no client JS)
**Purpose:** Marketing page that communicates value proposition and drives sign-up.

**Component Hierarchy:**

```
RootLayout (RSC)
  └── LandingPage (RSC)
      ├── Header (RSC) — logo, "Sign In" link, "Get Started" CTA button
      ├── Hero (RSC) — headline, subheadline, CTA, hero illustration
      ├── Features (RSC) — 4 feature cards (Dashboard, Sharing, Audit, Control)
      ├── HowItWorks (RSC) — 3-step visual (Connect, Visualize, Share)
      ├── CallToAction (RSC) — final CTA section
      └── Footer (RSC) — links, copyright
```

**Data Fetching:** None. Fully static. Eligible for ISR (Incremental Static Regeneration) or static export.

**Key Interactions:** CTA buttons link to `/sign-up`. "Sign In" links to `/sign-in`.

**Loading State:** Not applicable (static page).
**Error State:** Not applicable (no data dependencies).
**Empty State:** Not applicable.

---

### 7.2 Sign-In / Sign-Up — `/sign-in`, `/sign-up`

**Access:** Public (redirect to `/dashboard` if already authenticated)
**Component Type:** Client Component (Clerk UI components require browser)
**Purpose:** Authentication pages powered by Clerk's pre-built components.

**Component Hierarchy:**

```
RootLayout (RSC)
  └── AuthLayout (RSC) — centered card layout
      └── SignIn / SignUp (Client) — Clerk components
```

**Implementation:**

File: `src/app/sign-in/[[...sign-in]]/page.tsx`

```typescript
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "shadow-lg",
          },
        }}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        afterSignInUrl="/dashboard"
      />
    </div>
  );
}
```

**Data Fetching:** Handled by Clerk SDK internally.
**Loading State:** Clerk provides its own loading skeleton.
**Error State:** Clerk handles auth errors (wrong password, rate limits).

---

### 7.3 Dashboard — `/dashboard`

**Access:** Owner only (Clerk session required; middleware redirects to `/sign-in` if unauthenticated)
**Component Type:** RSC shell with Client Component children
**Purpose:** Primary interface for viewing health data with interactive charts.

**Component Hierarchy:**

```
DashboardLayout (RSC) — auth gate, fetches user profile + connections
  └── DashboardShell (Client) — sidebar + content wrapper
      └── DashboardPage (RSC)
          ├── ProviderConnectionBar (Client) — row of connected provider badges + "Add Source" button
          │   ├── ProviderConnectionCard (Client) — per-provider: icon, name, status, last sync, "Sync" / "Reconnect"
          │   └── AddProviderDialog (Client) — pick a provider to connect via OAuth
          │   [If no connections: EmptyDashboard with "Connect a Data Source" button + provider grid]
          │   [If connected:]
          ├── DashboardToolbar (Client)
          │   ├── MetricSelector (Client) — chip toggles for metrics (grouped by category)
          │   │   └── Chips show SourceBadge(s) for providers that supply each metric
          │   ├── DateRangeSelector (Client) — preset buttons + custom picker
          │   └── ResolutionToggle (Client) — daily / weekly / monthly
          ├── ChartGrid (Client) — responsive grid of charts
          │   ├── MetricChart (Client) — one per selected daily metric (or overlay)
          │   │   ├── ChartTooltip (Client) — hover tooltip with source attribution
          │   │   └── SourceToggle (Client) — when multiple sources exist: toggle all/preferred
          │   ├── IntradayChart (Client) — intraday series (glucose, heart rate)
          │   ├── PeriodTimeline (Client) — duration events (sleep stages, workouts, meals)
          │   └── OverlayLegend (Client) — when 2-3 metrics overlaid
          └── ActionBar (Client) — "Share Data" + "Export" buttons
```

**Data Fetching Strategy:**

1. **Server-side (RSC):** `DashboardLayout` uses Clerk's `auth()` to get the user ID, then fetches the user profile and connections list. These are passed as props to Client Components. This ensures the page shell renders immediately with correct layout.

2. **Client-side (TanStack Query):** `ChartGrid` uses `useHealthData()` to fetch metric data based on the current metric selection, date range, and resolution. These are client-side because the user interactively changes filters.

```typescript
// DashboardLayout (RSC) — src/app/dashboard/layout.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Fetch initial data server-side for immediate rendering
  const [profile, connections] = await Promise.all([
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/user/profile`, {
      headers: { Cookie: cookies().toString() },
    }).then((r) => r.json()),
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/connections`, {
      headers: { Cookie: cookies().toString() },
    }).then((r) => r.json()),
  ]);

  return (
    <ViewContextProvider
      value={{
        role: "owner",
        userId,
        permissions: { metrics: "all", dataStart: null, dataEnd: null },
      }}
    >
      <DashboardShell profile={profile.data} connections={connections.data}>
        {children}
      </DashboardShell>
    </ViewContextProvider>
  );
}
```

**Key Interactions:**

| Interaction        | UI Element                         | Effect                                                                         |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------ |
| Toggle metric      | MetricSelector chip                | Add/remove metric from chart display; triggers `useHealthData` refetch         |
| Change date range  | DateRangeSelector preset or picker | Updates date range; triggers refetch across daily, series, and periods hooks   |
| Change resolution  | ResolutionToggle                   | Switches daily/weekly/monthly; triggers `useHealthData` refetch                |
| Add provider       | ProviderConnectionBar "Add Source" | Opens `AddProviderDialog` with provider grid; selecting one starts OAuth flow  |
| Connect provider   | AddProviderDialog provider card    | Calls `GET /api/connections/{provider}/authorize`, redirects to provider OAuth |
| Manual sync        | ProviderConnectionCard "Sync Now"  | Calls `POST /api/connections/:id/sync`, shows progress                         |
| Toggle all sources | MetricChart SourceToggle           | Switches between preferred source and all sources for a multi-source metric    |
| Share Data         | ActionBar "Share" button           | Navigates to `/dashboard/share/new`                                            |
| Export Data        | ActionBar "Export" button          | Triggers export flow (see Settings)                                            |

**Loading State:**

- DashboardShell renders immediately (server-rendered)
- ChartGrid shows skeleton chart cards (animated gray rectangles matching chart dimensions)
- MetricSelector shows skeleton chips
- ConnectionCard shows skeleton status

**Error State:**

- API failure: ChartGrid shows error card with "Failed to load data" message and "Retry" button
- Connection failure: ConnectionCard shows "Connection error" with reconnect CTA

**Empty State (no data yet):**

- No connections: Full-page `EmptyDashboard` with illustration, "Connect a Data Source to Get Started" heading, and a grid of available providers (Oura, Dexcom, Garmin, Whoop, Withings, Cronometer) with status badges (e.g., "Self-serve", "Partner application required"). Clicking a provider opens the OAuth flow.
- Connected but no data synced yet: "Syncing your data from [provider]..." with progress animation
- Connected but selected metrics have no data: "No data available for [metric] in this date range"

**Provider OAuth Callback Handling:**

When the user returns from a provider's OAuth, they land on `/dashboard?connected={provider}` or `/dashboard?error={provider}_connect_failed`. The dashboard page reads these query params:

```typescript
// src/app/dashboard/page.tsx (RSC)
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <DashboardContent
      connectedProvider={params.connected ?? undefined}
      connectionError={params.error ?? undefined}
    />
  );
}
```

The `DashboardContent` Client Component displays a toast on mount (e.g., "Oura Ring connected! Syncing your data..."), then removes the query params from the URL via `router.replace("/dashboard")` to prevent the toast on page refresh. The toast text is dynamically derived from the provider's `displayName` in the provider registry.

---

### 7.4 Share Management — `/dashboard/share`

**Access:** Owner only
**Component Type:** RSC shell with Client Component table
**Purpose:** View and manage all share grants.

**Component Hierarchy:**

```
DashboardLayout (RSC)
  └── DashboardShell (Client)
      └── ShareManagementPage (RSC)
          ├── PageHeader — "Shared Links" title + "Create New Share" button
          ├── ShareFilters (Client) — status filter (All, Active, Expired, Revoked)
          └── ShareList (Client) — paginated list of share cards
              └── ShareCard (Client) — one per share grant
                  ├── Share label, status badge, metrics chips
                  ├── Date range, expiration, view count
                  ├── "Revoke" button (if active)
                  ├── "Delete" button (if revoked/expired)
                  └── Expandable: recent views from audit log
```

**Data Fetching:**

- `ShareList` uses `useShares({ status })` — TanStack Query with cursor pagination
- `useInfiniteQuery` for "Load More" pagination pattern
- Status filter changes invalidate and refetch

**Key Interactions:**

| Interaction      | UI Element                        | Effect                                                                                  |
| ---------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| Filter by status | ShareFilters tabs                 | Refetch shares with status filter                                                       |
| Revoke share     | ShareCard "Revoke" button         | Opens `RevokeDialog` confirmation; calls `PATCH /api/shares/:id` with optimistic update |
| Delete share     | ShareCard "Delete" button         | Opens confirmation dialog; calls `DELETE /api/shares/:id`                               |
| Create new       | "Create New Share" button         | Navigates to `/dashboard/share/new`                                                     |
| Load more        | "Load More" button at list bottom | Fetches next page via cursor                                                            |

**Loading State:** Skeleton card list (3 skeleton cards with animated pulse).
**Error State:** Error banner with retry button.
**Empty State:** "No shared links yet. Create your first share to let a doctor or coach view your data." with CTA button.

---

### 7.5 Share Wizard — `/dashboard/share/new`

**Access:** Owner only
**Component Type:** Client Component (multi-step form with state)
**Purpose:** Guided flow for creating a new share grant.

**Component Hierarchy:**

```
DashboardLayout (RSC)
  └── DashboardShell (Client)
      └── ShareWizardPage (Client)
          └── ShareWizard (Client) — manages step state
              ├── StepIndicator — shows progress (1/4, 2/4, etc.)
              ├── [Step 1] ShareWizardStepMetrics
              │   └── Metric chips organized by category (Sleep, Cardio, Activity, Body, Metabolic, Recovery, Nutrition)
              │       Includes both scalar metrics (daily) and event types (sleep stages, workouts, meals)
              │       User toggles which data to share
              ├── [Step 2] ShareWizardStepDateRange
              │   └── DateRangePicker with preset buttons (Last 30 days, 90 days, etc.)
              │       Shows preview of data availability
              ├── [Step 3] ShareWizardStepExpiration
              │   └── Radio buttons: 7 days, 30 days, 90 days, Custom
              │       Optional note textarea
              ├── [Step 4] ShareWizardStepReview
              │   └── Summary of all selections
              │       "Create Share Link" button
              └── ShareUrlDialog (Client) — modal shown after creation
                  └── Share URL display with copy button
                      Warning: "This link will only be shown once"
```

**Data Fetching:**

- On mount: `useHealthDataTypes()` to know which metrics the user has data for (prevents sharing empty metrics)
- On submit: `useCreateShare()` mutation — `POST /api/shares`

**Wizard State Management:**

```typescript
// ShareWizard internal state (React useState, not context or global store)
interface ShareWizardState {
  step: 1 | 2 | 3 | 4;
  selectedMetrics: string[]; // metric type IDs
  dateRange: { start: string; end: string } | null;
  expiresInDays: number; // 7, 30, 90, or custom
  label: string; // auto-generated or user-edited
  note: string; // optional
}
```

Form validation uses React Hook Form + Zod. The Zod schema is shared with the API layer:

```typescript
// Shared validation schema — src/lib/validators.ts
import { z } from "zod";
import { METRIC_TYPES } from "./metric-config";

export const createShareSchema = z.object({
  label: z.string().min(1).max(255),
  allowed_metrics: z
    .array(z.enum(METRIC_TYPES as [string, ...string[]]))
    .min(1, "Select at least one metric")
    .max(21),
  data_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expires_in_days: z.number().int().min(1).max(365),
  note: z.string().max(1000).optional(),
});
```

**Key Interactions:**

| Interaction       | UI Element                      | Effect                                                      |
| ----------------- | ------------------------------- | ----------------------------------------------------------- |
| Toggle metric     | Metric chip in Step 1           | Add/remove from `selectedMetrics`                           |
| Select date range | Preset button or custom picker  | Sets `dateRange`                                            |
| Back / Next       | Navigation buttons              | Changes step, validates current step                        |
| Submit            | "Create Share Link" in Step 4   | Calls `POST /api/shares`, shows `ShareUrlDialog` on success |
| Copy URL          | Copy button in `ShareUrlDialog` | Copies URL to clipboard, shows toast                        |
| Close dialog      | Close button or backdrop        | Navigates to `/dashboard/share`                             |

**Loading State:** Submit button shows spinner during creation.
**Error State:** Inline form errors from Zod validation; toast for API errors.
**Post-Creation:** The `ShareUrlDialog` modal displays the URL with a prominent copy button and a warning: "Save this link now. It will not be shown again." The dialog cannot be dismissed without an explicit close action to reduce accidental loss.

---

### 7.6 Audit Log — `/dashboard/audit`

**Access:** Owner only
**Component Type:** RSC shell with Client Component table
**Purpose:** Transparent log of all data access and account activity.

**Component Hierarchy:**

```
DashboardLayout (RSC)
  └── DashboardShell (Client)
      └── AuditLogPage (RSC)
          ├── PageHeader — "Activity Log" title
          ├── AuditFilters (Client)
          │   ├── EventTypeFilter — dropdown (All, Data Viewed, Share Created, etc.)
          │   ├── ActorFilter — dropdown (All, You, Viewers, System)
          │   └── DateRangeFilter — date picker
          └── AuditTable (Client)
              ├── AuditEventRow (Client) — one per event
              │   ├── Timestamp (relative + absolute on hover)
              │   ├── Actor badge (YOU / VIEWER / SYSTEM)
              │   ├── Event description (human-readable)
              │   ├── Details (metrics accessed, share label, IP)
              │   └── Expandable detail row
              └── LoadMoreButton — cursor pagination
```

**Data Fetching:**

- `useAuditLog({ eventType, actorType, start, end })` — TanStack `useInfiniteQuery`
- Default: last 30 days, all event types
- Filter changes reset the query (new cursor chain)

**Event Description Formatting:**

```typescript
// src/lib/format.ts
function formatAuditEvent(event: AuditEvent): string {
  switch (event.event_type) {
    case "data.viewed":
      if (event.actor_type === "viewer") {
        return `Viewer via "${event.grant_label}" viewed ${event.resource_detail.metrics.join(", ")}`;
      }
      return `You viewed ${event.resource_detail.metrics.join(", ")}`;
    case "share.created":
      return `You created share "${event.resource_detail.label}"`;
    case "share.revoked":
      return `You revoked share "${event.resource_detail.label}"`;
    case "share.viewed":
      return `Viewer opened "${event.grant_label}" share link`;
    case "data.imported":
      return `Imported ${event.resource_detail.data_points} data points from ${event.resource_detail.source}`;
    case "data.exported":
      return `You exported all data`;
    case "account.connected":
      return `Connected ${event.resource_detail.provider}`;
    case "account.disconnected":
      return `Disconnected ${event.resource_detail.provider}`;
    default:
      return event.event_type;
  }
}
```

**Loading State:** Skeleton table rows (8 rows with pulse animation).
**Error State:** Error banner with retry button.
**Empty State:** "No activity recorded yet. Activity will appear here as you use Totus."

---

### 7.7 Settings — `/dashboard/settings`

**Access:** Owner only
**Component Type:** RSC shell with Client Component forms
**Purpose:** Account management — profile, connections, export, delete.

**Component Hierarchy:**

```
DashboardLayout (RSC)
  └── DashboardShell (Client)
      └── SettingsPage (RSC)
          ├── PageHeader — "Settings" title
          ├── ProfileForm (Client)
          │   ├── Display name input
          │   └── Save button
          ├── ConnectionsManager (Client)
          │   ├── ProviderConnectionCard (Client) — per connected provider: status, last sync, disconnect
          │   │   └── [One card per connected provider: Oura, Dexcom, Garmin, Whoop, Withings, Cronometer]
          │   ├── AddProviderDialog (Client) — "Add Data Source" button opens provider selection
          │   └── SourcePreferencesSection (Client) — per-metric source preference management
          │       └── SourcePreferenceSelector — for each metric with multiple sources, pick preferred
          ├── ExportSection (Client)
          │   ├── "Export All Data" button
          │   └── Export status / download link
          ├── Separator
          └── DangerZone (Client)
              └── DeleteAccountDialog (Client)
                  ├── "Delete Account" button (red)
                  └── Confirmation dialog with "DELETE MY ACCOUNT" input
```

**Data Fetching:**

- `useUserProfile()` for profile data (pre-fetched server-side, hydrated on client)
- `useConnections()` for connection status
- `useUpdateProfile()` mutation
- `useExportData()` mutation
- `useDeleteAccount()` mutation

**Account Deletion Flow:**

1. User clicks "Delete Account" in danger zone
2. `DeleteAccountDialog` opens with clear warning text
3. User must type "DELETE MY ACCOUNT" exactly in a text input
4. Button becomes enabled only when input matches
5. On confirm: calls `DELETE /api/user` with `{ confirmation: "DELETE MY ACCOUNT" }`
6. On success: Clerk signs out, redirects to landing page

**Loading States:** Form-specific (save button spinners, export progress).
**Error States:** Inline form errors, toast for API failures.

---

### 7.8 Viewer Page — `/v/[token]`

**Access:** Public (token validated server-side)
**Component Type:** RSC for validation + Client Components for dashboard
**Purpose:** Read-only health data view for doctors/coaches via share link.

**Component Hierarchy:**

```
RootLayout (RSC)
  └── ViewerPage (RSC) — validates token, sets context
      ├── [If token invalid: ShareExpiredPage]
      │   └── "This link is no longer available" message
      │       "It may have expired, been revoked, or never existed."
      └── [If token valid:]
          ViewContextProvider (role="viewer", permissions=grant scope)
            └── ViewerLayout (Client)
                ├── ViewerHeader (Client)
                │   ├── Totus logo
                │   ├── "Shared by [owner_display_name]" text
                │   └── Optional: note from share grant
                ├── ViewerBanner (Client)
                │   └── "You are viewing shared health data. [metrics] from [start] to [end]."
                ├── DashboardToolbar (Client) — same component, restricted
                │   ├── MetricSelector — only granted metrics, all pre-selected
                │   ├── DateRangeSelector — locked to grant range (presets hidden)
                │   └── ResolutionToggle — same as owner
                ├── ChartGrid (Client) — same component
                │   └── MetricChart — same component, identical charts
                └── [No ActionBar — hidden for viewers]
```

**Token Validation Flow (Server-Side):**

```typescript
// src/app/v/[token]/page.tsx (RSC)
import { cookies } from "next/headers";

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Step 1: Call validate endpoint (sets viewer cookie on success)
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/viewer/validate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }
  );

  if (!res.ok) {
    return <ShareExpiredPage />;
  }

  const { data: grant } = await res.json();

  return (
    <ViewContextProvider
      value={{
        role: "viewer",
        grantId: grant.id,
        permissions: {
          metrics: grant.allowed_metrics,
          dataStart: grant.data_start,
          dataEnd: grant.data_end,
        },
        ownerDisplayName: grant.owner_display_name,
        note: grant.note,
      }}
    >
      <ViewerLayout grant={grant} />
    </ViewContextProvider>
  );
}
```

**Viewer vs Owner Differences (same components, different behavior):**

| Component         | Owner                                         | Viewer                                                          |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------- |
| MetricSelector    | All user metrics, toggleable                  | Only granted metrics, all pre-selected, toggleable within grant |
| DateRangeSelector | Any range, presets available                  | Locked to `data_start`–`data_end`, presets hidden               |
| ChartGrid         | Fetches via `/api/health-data`                | Fetches via `/api/viewer/data`                                  |
| ActionBar         | Visible (Share, Export)                       | Hidden                                                          |
| Header            | Full nav (Dashboard, Shares, Audit, Settings) | Totus logo + "Shared by" text                                   |
| Sidebar           | Visible                                       | Hidden                                                          |

**Data Fetching:**

- Viewer charts use `useViewerData()` hook (calls `GET /api/viewer/data`)
- Same response shape as owner's `GET /api/health-data`, so chart components are identical

**Loading State:** Same skeleton charts as owner dashboard.
**Error State:** Same error card with retry.
**Empty State:** "No data available for the shared metrics in this date range."

**Expired/Invalid Token Page (`ShareExpiredPage`):**

- Clean, centered card layout
- Totus logo at top
- Heading: "This link is no longer available"
- Body: "It may have expired, been revoked, or never existed. If you believe this is an error, contact the person who shared it."
- No login CTA (the viewer does not need an account)
- No information leakage (same message for expired, revoked, and invalid tokens)

---

### 7.9 404 Page — `not-found.tsx`

**Access:** Public
**Component Type:** RSC
**Content:** "Page not found" with link back to home.

### 7.10 Error Boundary — `error.tsx`

**Access:** All
**Component Type:** Client Component (Next.js requirement)
**Content:** "Something went wrong" with retry button and link to home. Logs error to Sentry.

```typescript
// src/app/error.tsx
"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        An unexpected error occurred. Please try again.
      </p>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Try Again
        </button>
        <a
          href="/"
          className="rounded-md border px-4 py-2"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}
```

---

## 8. Component Library

### 8.1 Layout Components

#### DashboardShell

The primary layout wrapper for all authenticated dashboard pages. Contains sidebar navigation and main content area.

```typescript
// src/components/layout/DashboardShell.tsx
"use client";

interface DashboardShellProps {
  profile: {
    id: string;
    display_name: string;
    email: string;
  };
  connections: Array<{
    id: string;
    provider: string;
    status: "active" | "expired" | "error" | "paused";
    sync_status: "idle" | "queued" | "syncing" | "error";
    last_sync_at: string | null;
    connected_at: string;
  }>;
  children: React.ReactNode;
}
```

**Behavior:**

- Renders a collapsible sidebar on desktop (>= 1024px), a bottom sheet on mobile (< 1024px)
- Sidebar contains: logo, navigation links, user avatar + name, sign-out button
- Content area fills remaining space with padding and max-width constraint
- Sidebar navigation items: Dashboard, Shared Links, Activity Log, Settings
- Active route is highlighted based on `usePathname()`

#### Header

Role-aware top bar within the content area.

```typescript
interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode; // right-aligned action buttons
}
```

**Owner header:** Shows page title, optional description, action buttons.
**Viewer header:** Shows "Shared by [name]", note (if any), Totus branding.

#### Sidebar

Navigation sidebar for owner dashboard.

```typescript
interface SidebarProps {
  profile: {
    display_name: string;
    email: string;
  };
}

// Navigation items
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Shared Links", href: "/dashboard/share", icon: Share2 },
  { label: "Activity Log", href: "/dashboard/audit", icon: ScrollText },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
] as const;
```

### 8.2 Data Visualization Components

#### MetricChart

The core chart component. Renders a single time-series line chart for one or more metrics using Recharts.

```typescript
interface MetricChartProps {
  /** Metric data keyed by metric type */
  data: Record<
    string,
    {
      unit: string;
      points: Array<{ date: string; value: number; source: string }>;
    }
  >;
  /** Which metrics to display (1-3 for overlay) */
  metrics: string[];
  /** Chart height in pixels */
  height?: number;
  /** Whether to show the chart in compact mode (no axis labels) */
  compact?: boolean;
  /** Whether the chart is in a loading state */
  isLoading?: boolean;
}
```

**Rendering Strategy:**

- Single metric: Line chart with area fill, Y-axis labeled with unit
- Two metrics: Dual Y-axis (left and right), two colored lines, legend at top
- Three metrics: Tri-axis (two on left with offset, one on right), three colored lines, legend at top
- X-axis: date labels (adaptive density based on date range span)
- Tooltip: shows all active metrics' values for the hovered date
- Responsive: uses `ResponsiveContainer` from Recharts

**Color Palette (per metric, from design tokens):**

```typescript
// src/lib/chart-utils.ts
export const METRIC_COLORS: Record<string, { line: string; fill: string }> = {
  sleep_score: { line: "hsl(250, 80%, 60%)", fill: "hsl(250, 80%, 60%, 0.1)" },
  sleep_duration: {
    line: "hsl(260, 70%, 55%)",
    fill: "hsl(260, 70%, 55%, 0.1)",
  },
  sleep_efficiency: {
    line: "hsl(270, 60%, 50%)",
    fill: "hsl(270, 60%, 50%, 0.1)",
  },
  sleep_latency: {
    line: "hsl(280, 50%, 55%)",
    fill: "hsl(280, 50%, 55%, 0.1)",
  },
  deep_sleep: { line: "hsl(240, 70%, 50%)", fill: "hsl(240, 70%, 50%, 0.1)" },
  rem_sleep: { line: "hsl(220, 70%, 55%)", fill: "hsl(220, 70%, 55%, 0.1)" },
  light_sleep: { line: "hsl(200, 60%, 60%)", fill: "hsl(200, 60%, 60%, 0.1)" },
  awake_time: { line: "hsl(30, 80%, 55%)", fill: "hsl(30, 80%, 55%, 0.1)" },
  hrv: { line: "hsl(160, 70%, 45%)", fill: "hsl(160, 70%, 45%, 0.1)" },
  rhr: { line: "hsl(0, 70%, 55%)", fill: "hsl(0, 70%, 55%, 0.1)" },
  respiratory_rate: {
    line: "hsl(180, 60%, 45%)",
    fill: "hsl(180, 60%, 45%, 0.1)",
  },
  spo2: { line: "hsl(200, 80%, 50%)", fill: "hsl(200, 80%, 50%, 0.1)" },
  body_temperature_deviation: {
    line: "hsl(15, 80%, 55%)",
    fill: "hsl(15, 80%, 55%, 0.1)",
  },
  readiness_score: {
    line: "hsl(140, 70%, 45%)",
    fill: "hsl(140, 70%, 45%, 0.1)",
  },
  activity_score: { line: "hsl(40, 80%, 50%)", fill: "hsl(40, 80%, 50%, 0.1)" },
  steps: { line: "hsl(45, 90%, 50%)", fill: "hsl(45, 90%, 50%, 0.1)" },
  active_calories: {
    line: "hsl(25, 85%, 55%)",
    fill: "hsl(25, 85%, 55%, 0.1)",
  },
  total_calories: { line: "hsl(35, 75%, 50%)", fill: "hsl(35, 75%, 50%, 0.1)" },
  glucose: { line: "hsl(340, 70%, 55%)", fill: "hsl(340, 70%, 55%, 0.1)" },
  weight: { line: "hsl(190, 60%, 50%)", fill: "hsl(190, 60%, 50%, 0.1)" },
  body_fat_pct: { line: "hsl(310, 50%, 55%)", fill: "hsl(310, 50%, 55%, 0.1)" },
  // Body composition (Withings, Garmin)
  bmi: { line: "hsl(185, 55%, 45%)", fill: "hsl(185, 55%, 45%, 0.1)" },
  muscle_mass_kg: {
    line: "hsl(160, 65%, 45%)",
    fill: "hsl(160, 65%, 45%, 0.1)",
  },
  bone_mass_kg: { line: "hsl(210, 40%, 55%)", fill: "hsl(210, 40%, 55%, 0.1)" },
  hydration_kg: { line: "hsl(195, 70%, 50%)", fill: "hsl(195, 70%, 50%, 0.1)" },
  visceral_fat_index: {
    line: "hsl(10, 70%, 55%)",
    fill: "hsl(10, 70%, 55%, 0.1)",
  },
  // Nutrition (Cronometer)
  calories_consumed: {
    line: "hsl(30, 85%, 50%)",
    fill: "hsl(30, 85%, 50%, 0.1)",
  },
  protein_g: { line: "hsl(0, 65%, 55%)", fill: "hsl(0, 65%, 55%, 0.1)" },
  carbs_g: { line: "hsl(45, 80%, 50%)", fill: "hsl(45, 80%, 50%, 0.1)" },
  fat_g: { line: "hsl(20, 75%, 55%)", fill: "hsl(20, 75%, 55%, 0.1)" },
};
```

**Implementation Pattern:**

```typescript
// src/components/dashboard/MetricChart.tsx
"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, ComposedChart,
} from "recharts";
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { METRIC_COLORS } from "@/lib/chart-utils";
import { METRIC_REGISTRY } from "@/lib/metric-config";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartTooltip } from "./ChartTooltip";

export function MetricChart({ data, metrics, height = 300, compact = false, isLoading }: MetricChartProps) {
  // Transform API data into Recharts format
  const chartData = useMemo(() => {
    if (!data || metrics.length === 0) return [];
    // Merge all metric points by date
    const dateMap = new Map<string, Record<string, number>>();
    for (const metric of metrics) {
      const metricData = data[metric];
      if (!metricData) continue;
      for (const point of metricData.points) {
        const existing = dateMap.get(point.date) || {};
        existing[metric] = point.value;
        dateMap.set(point.date, existing);
      }
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [data, metrics]);

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full rounded-lg" />;
  }

  const isOverlay = metrics.length > 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
          className="text-xs text-muted-foreground"
          tick={{ fontSize: 12 }}
        />
        {metrics.map((metric, i) => (
          <YAxis
            key={metric}
            yAxisId={isOverlay ? `y-${i}` : "y-0"}
            orientation={i === 0 ? "left" : "right"}
            label={
              !compact
                ? {
                    value: METRIC_REGISTRY[metric]?.unit ?? "",
                    angle: -90,
                    position: "insideLeft",
                  }
                : undefined
            }
            tick={{ fontSize: 12 }}
            width={compact ? 30 : 50}
          />
        ))}
        <Tooltip content={<ChartTooltip metrics={metrics} />} />
        {metrics.map((metric, i) => (
          <Line
            key={metric}
            yAxisId={isOverlay ? `y-${i}` : "y-0"}
            type="monotone"
            dataKey={metric}
            stroke={METRIC_COLORS[metric]?.line ?? "hsl(0, 0%, 50%)"}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

#### ChartGrid

Responsive grid layout for multiple chart cards.

```typescript
interface ChartGridProps {
  /** Currently selected metrics */
  selectedMetrics: string[];
  /** Whether to overlay metrics (true) or show separate charts (false) */
  overlayMode: boolean;
  /** Date range for data fetching */
  dateRange: { start: string; end: string };
  /** Resolution */
  resolution: "daily" | "weekly" | "monthly";
}
```

**Layout:**

- Overlay mode (2-3 metrics): single full-width chart
- Separate mode (1-3 metrics): responsive grid — 1 column on mobile, 2 on tablet, 3 on desktop
- Each chart is wrapped in a `Card` from shadcn/ui with the metric name as title

#### ChartTooltip

Custom tooltip displayed on chart hover.

```typescript
interface ChartTooltipProps {
  metrics: string[];
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string; // date string
}
```

**Display:** Shows date (formatted), then each metric with its color dot, label, value, and unit. Example:

```
March 8, 2026
● Sleep Score: 85 score
● HRV: 42.5 ms
```

#### OverlayLegend

Legend displayed above a chart when multiple metrics are overlaid.

```typescript
interface OverlayLegendProps {
  metrics: string[]; // metric type IDs
}
```

**Display:** Horizontal row of colored dots with metric labels. Interactive: clicking a legend item toggles that metric's visibility.

### 8.3 Form Components

#### MetricSelector

Toggleable chip list for selecting which metrics to display.

```typescript
interface MetricSelectorProps {
  /** All available metric types (from useHealthDataTypes) */
  availableMetrics: Array<{
    metric_type: string;
    label: string;
    category: string;
    data_point_count: number;
  }>;
  /** Currently selected metric type IDs */
  selectedMetrics: string[];
  /** Callback when selection changes */
  onSelectionChange: (metrics: string[]) => void;
  /** Maximum number of selectable metrics (default: 3) */
  maxSelection?: number;
  /** Whether the selector is read-only (viewer with all granted metrics pre-selected) */
  readOnly?: boolean;
}
```

**Behavior:**

- Chips grouped by category (Sleep, Cardiovascular, Activity, Body, Metabolic, Recovery, Nutrition)
- Selected chips are filled with the metric's color; unselected are outlined
- When `maxSelection` is reached, unselected chips become disabled with tooltip "Maximum 3 metrics selected"
- Owner: all metrics with data are available
- Viewer: only granted metrics are shown, all pre-selected, `maxSelection` still applies for overlay management
- Chips show a small data count badge (e.g., "784 days") to indicate data density
- Multi-source metrics show one or more small `SourceBadge` icons next to the chip to indicate which providers supply this metric (e.g., HRV chip shows both Oura and Whoop icons if both are connected and syncing HRV)

#### DateRangeSelector

Date range picker with preset buttons and custom range.

```typescript
interface DateRangeSelectorProps {
  /** Current date range */
  value: { start: string; end: string };
  /** Callback when range changes */
  onChange: (range: { start: string; end: string }) => void;
  /** Minimum selectable date (viewer: grant data_start) */
  minDate?: string;
  /** Maximum selectable date (viewer: grant data_end) */
  maxDate?: string;
  /** Whether to show preset buttons */
  showPresets?: boolean;
}

// Preset definitions
const DATE_PRESETS = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 1825 },
  { label: "All", days: null }, // uses earliest/latest data dates
] as const;
```

**Behavior:**

- Owner: all presets visible, custom picker available, no min/max constraints
- Viewer: presets hidden, custom picker locked to grant's `data_start`/`data_end`, range is pre-set to the full grant window
- "All" preset uses the earliest and latest data dates from `useHealthDataTypes()`
- Custom picker uses shadcn/ui `Calendar` component with range selection

#### ResolutionToggle

Toggle between daily, weekly, and monthly data resolution.

```typescript
interface ResolutionToggleProps {
  value: "daily" | "weekly" | "monthly";
  onChange: (resolution: "daily" | "weekly" | "monthly") => void;
}
```

**Implementation:** shadcn/ui `Tabs` component with three segments.

#### ShareWizard

Multi-step form for creating share grants. (Detailed in Section 7.5.)

```typescript
interface ShareWizardProps {
  /** Available metrics from useHealthDataTypes */
  availableMetrics: Array<{
    metric_type: string;
    label: string;
    category: string;
    earliest_date: string;
    latest_date: string;
  }>;
  /** Callback on successful creation */
  onCreated: (share: { id: string; share_url: string; token: string }) => void;
  /** Callback on cancel */
  onCancel: () => void;
}
```

### 8.4 Feedback Components

#### Toast (via shadcn/ui Sonner integration)

Non-blocking notifications.

```typescript
// Usage pattern (not a component definition — uses sonner)
import { toast } from "sonner";

// Success
toast.success("Share link copied to clipboard");

// Error
toast.error("Failed to create share. Please try again.");

// With action
toast("Data export ready", {
  action: {
    label: "Download",
    onClick: () => window.open(downloadUrl),
  },
});
```

**Configuration:** Toasts appear at bottom-right, auto-dismiss after 5 seconds, max 3 visible simultaneously.

#### EmptyState

Reusable empty state component.

```typescript
interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}
```

#### ErrorCard

Reusable error display with retry.

```typescript
interface ErrorCardProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}
```

#### LoadingSkeleton

Configurable skeleton placeholder.

```typescript
interface LoadingSkeletonProps {
  /** Skeleton variant matching the expected content */
  variant: "chart" | "card" | "table-row" | "text" | "metric-chip";
  /** Number of skeleton items to render */
  count?: number;
}
```

### 8.5 Multi-Provider Components

These components support the multi-provider architecture introduced in `integrations-pipeline-lld.md`. They handle provider connection management, source attribution, source preference selection, intraday series visualization, and duration event timelines.

#### ProviderConnectionCard

Displays connection status for a single provider. Replaces the former Oura-specific `ConnectionCard`.

```typescript
interface ProviderConnectionCardProps {
  connection: {
    id: string;
    provider: string; // 'oura', 'dexcom', 'garmin', 'whoop', 'withings', 'cronometer'
    status: "active" | "expired" | "error" | "paused";
    last_sync_at: string | null;
    sync_status: "idle" | "queued" | "syncing" | "error";
    sync_error: string | null;
    connected_at: string;
  };
  onSync: (connectionId: string) => void;
  onDisconnect: (connectionId: string) => void;
}
```

**Display:**

- Provider icon (from static asset map) + display name
- Status badge: green "Active", yellow "Expired" (with "Reconnect" CTA), red "Error" (with error message tooltip)
- Last sync time (relative, e.g., "2 hours ago"), sync-in-progress spinner
- "Sync Now" button (disabled while syncing), "Disconnect" button (danger style, triggers confirmation dialog)
- Compact mode: renders as a horizontal pill in the `ProviderConnectionBar` on the dashboard; full card layout in Settings

**Provider icon map:**

```typescript
// src/lib/provider-config.ts
export const PROVIDER_REGISTRY: Record<
  string,
  {
    displayName: string;
    icon: string; // path to SVG icon in /public/providers/
    color: string; // brand color for badges and chart attribution
    category: "wearable" | "cgm" | "smart_scale" | "nutrition";
    accessStatus: "self-serve" | "partner-required" | "blocked";
  }
> = {
  oura: {
    displayName: "Oura Ring",
    icon: "/providers/oura.svg",
    color: "hsl(250, 80%, 60%)",
    category: "wearable",
    accessStatus: "self-serve",
  },
  dexcom: {
    displayName: "Dexcom CGM",
    icon: "/providers/dexcom.svg",
    color: "hsl(340, 70%, 55%)",
    category: "cgm",
    accessStatus: "self-serve",
  },
  garmin: {
    displayName: "Garmin Connect",
    icon: "/providers/garmin.svg",
    color: "hsl(200, 80%, 45%)",
    category: "wearable",
    accessStatus: "partner-required",
  },
  whoop: {
    displayName: "Whoop",
    icon: "/providers/whoop.svg",
    color: "hsl(0, 0%, 20%)",
    category: "wearable",
    accessStatus: "self-serve",
  },
  withings: {
    displayName: "Withings Health Mate",
    icon: "/providers/withings.svg",
    color: "hsl(190, 60%, 50%)",
    category: "smart_scale",
    accessStatus: "self-serve",
  },
  cronometer: {
    displayName: "Cronometer",
    icon: "/providers/cronometer.svg",
    color: "hsl(30, 85%, 50%)",
    category: "nutrition",
    accessStatus: "blocked",
  },
};
```

#### AddProviderDialog

Modal dialog for connecting a new data source.

```typescript
interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedProviders: string[]; // already connected — shown as disabled
}
```

**Layout:**

- Grid of provider cards (2 columns on mobile, 3 on desktop)
- Each card shows: provider icon, display name, category label, access status badge
- Already-connected providers shown as disabled with "Connected" badge
- Providers with `accessStatus: 'blocked'` show "Coming Soon" badge and are disabled
- Clicking an available provider calls `GET /api/connections/{provider}/authorize` and redirects to the provider's OAuth flow

#### SourceBadge

Small inline badge showing a provider's icon and optional name, used in chart tooltips and metric chips.

```typescript
interface SourceBadgeProps {
  provider: string;
  showName?: boolean; // default false — icon only
  size?: "sm" | "md"; // sm: 16px, md: 20px
}
```

#### SourcePreferenceSelector

Lets the user choose which provider is authoritative for a metric when multiple providers supply it.

```typescript
interface SourcePreferenceSelectorProps {
  metricType: string;
  availableSources: Array<{
    provider: string;
    dataPointCount: number;
    latestDate: string;
  }>;
  currentPreference: string | null; // null = auto-resolve
  onChange: (provider: string | null) => void;
}
```

**Display:**

- Dropdown or radio group listing each available source with provider icon, name, and data density ("784 days of data")
- "Auto (most recent)" option at top — default when no explicit preference is set
- Changing the selection calls `PUT /api/metric-preferences/{metricType}` (or `DELETE` to revert to auto)
- Shown in Settings > Connections > Source Preferences section, and optionally as a popover on the chart's SourceToggle

#### SourceToggle

Small toggle control on a chart card header that switches between showing only the preferred source or all sources overlaid.

```typescript
interface SourceToggleProps {
  /** Whether to show all sources or just the preferred one */
  showAllSources: boolean;
  onChange: (showAll: boolean) => void;
  /** Provider names that supply this metric */
  sources: string[];
}
```

**Behavior:**

- Only rendered when a metric has data from 2+ providers
- Default: show preferred source only (clean single-line chart)
- Toggle on: show all sources as separate lines with distinct provider colors and a legend
- This is the primary UX for "compare what my Oura says vs. what my Whoop says for HRV"

#### IntradayChart

Time-series chart for high-frequency intraday data (series metrics: glucose, heart rate, SpO2).

```typescript
interface IntradayChartProps {
  data: {
    metric_type: string;
    source: string;
    readings: Array<{ recorded_at: string; value: number }>;
  };
  /** Height in pixels */
  height?: number;
  /** Date range for x-axis */
  dateRange: { from: string; to: string };
}
```

**Rendering:**

- Uses Recharts `AreaChart` with high-density data (e.g., 288 CGM readings/day, ~1,700 HR readings/day)
- X-axis: hourly ticks within a single day, daily ticks across multi-day range
- Tooltip shows exact timestamp + value + source
- For glucose: optional horizontal reference lines at 70 mg/dL (low) and 180 mg/dL (high) — common clinical thresholds
- Data downsampling: for ranges >7 days, downsample to 1-hour averages client-side to keep chart responsive (raw data is still available on zoom)
- Fetched via `useSeriesData({ metric_type, from, to })` → `GET /api/health-data/series`

#### PeriodTimeline

Visual timeline for duration events (sleep stages, workouts, meals).

```typescript
interface PeriodTimelineProps {
  data: {
    event_type: string;
    periods: Array<{
      subtype: string;
      started_at: string;
      ended_at: string;
      duration_sec: number;
      source: string;
      metadata?: Record<string, unknown>; // decrypted on server, passed as props
    }>;
  };
  /** Timeline date range */
  dateRange: { from: string; to: string };
}
```

**Rendering by event type:**

- **Sleep stages (`event_type: 'sleep_stage'`):** Horizontal stacked bar chart (hypnogram-style). X-axis = time (10pm–8am typical), colored segments for `rem` (purple), `deep` (navy), `light` (sky blue), `awake` (amber). One row per night in the date range. Tooltip shows stage name, duration, and source.

- **Workouts (`event_type: 'workout'`):** Card list sorted by date. Each card shows: subtype icon (run, cycle, swim, strength, yoga, generic), start time, duration, and summary metrics from `metadata` (calories, distance, avg HR if present). Source badge in corner.

- **Meals (`event_type: 'meal'`):** Card list grouped by date. Each date shows meals in chronological order (breakfast → lunch → dinner → snack). Each card shows: meal subtype, time, calorie total, and a macro summary bar (protein / carbs / fat proportions as a horizontal stacked bar). Expandable to show individual food items from `metadata.food_items` if present. Source badge (Cronometer).

- Fetched via `usePeriodsData({ event_type, from, to })` → `GET /api/health-data/periods`

### 8.6 Multi-Provider UX Patterns

#### Use Case: Correlating Sleep, Nutrition, and Activity

When a user has Oura (sleep + activity), Cronometer (nutrition), and Withings (body composition) connected, the dashboard naturally presents cross-domain insights:

- **Daily view:** MetricSelector chips span categories. User selects `sleep_score` (Oura) + `calories_consumed` (Cronometer) + `weight` (Withings) → overlay chart with three Y-axes showing the relationship between caloric intake, sleep quality, and weight trend over time.

- **Drill-down:** Clicking a date in the daily chart expands to show:
  - Sleep stage timeline for that night (PeriodTimeline)
  - Meals logged that day (PeriodTimeline with `event_type: 'meal'`)
  - Activity/workouts (PeriodTimeline with `event_type: 'workout'`)

#### Use Case: Glucose + Heart Rate Intraday

A user with Dexcom (glucose) and Oura or Whoop (heart rate) can:

- Select a single day in the date range
- See glucose trend (IntradayChart) and heart rate trend (IntradayChart) aligned on the same time axis
- Meal periods from Cronometer overlaid as shaded regions on the glucose chart (when connected), showing how specific foods correlate with glucose spikes

#### Use Case: Comparing Wearable Sources

A user wearing both Oura and Whoop sees both as data sources for HRV, RHR, and sleep duration:

- Default: charts show the preferred source (per `metric_source_preferences` or auto-resolved)
- SourceToggle: user clicks "Show all sources" → both Oura and Whoop HRV lines appear on the same chart with distinct colors (Oura in purple, Whoop in dark gray)
- Source preferences: in Settings, user sets "HRV → Oura" and "Sleep Duration → Whoop" as their preferred sources

#### Provider Connection Bar Design

The `ProviderConnectionBar` at the top of the dashboard provides at-a-glance status for all connections:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Oura ●]  [Whoop ●]  [Withings ●]  [Dexcom ◌ syncing...]  [+ Add]   │
└─────────────────────────────────────────────────────────────────────────┘
```

- Each pill shows provider icon + status dot (green=active, yellow=expired, red=error, gray=paused)
- Clicking a pill opens a popover with last sync time, error details, and Sync/Disconnect actions
- The bar is horizontally scrollable on mobile when many providers are connected
- `[+ Add]` button opens `AddProviderDialog`

---

## 9. State Management

### 9.1 State Management Philosophy

Totus uses a **minimal state architecture** with three tiers:

1. **Server State (React Server Components):** Initial page data fetched server-side and passed as props. No client-side state needed for this data until user interacts.

2. **Remote Server State (TanStack Query):** All data fetched from `/api/*` endpoints after initial page load. TanStack Query manages caching, deduplication, background refetching, and error/loading states.

3. **Local Client State (React useState/useReducer):** UI-only state such as selected metrics, date range, resolution, wizard step, modal open/close. This state lives in the component that owns it and is passed down via props. No global state store is needed.

**Why no Zustand / Redux / Jotai?** The application state is predominantly server state (health data, shares, audit log, profile). TanStack Query handles this category extremely well. The remaining local state (filter selections, form inputs, UI toggles) is component-scoped and does not need a global store. Adding a global state management library would add complexity without solving a real problem for this application's scope.

### 9.2 View Context

The one piece of "global" state is the View Context, which encodes the current user's role and permissions.

```typescript
// src/types/view-context.ts
export interface ViewContextValue {
  role: "owner" | "viewer";
  userId?: string; // present for owners
  grantId?: string; // present for viewers
  permissions: {
    metrics: string[] | "all"; // "all" for owners, specific list for viewers
    dataStart: string | null; // null for owners (unrestricted)
    dataEnd: string | null; // null for owners (unrestricted)
  };
  ownerDisplayName?: string; // present for viewers
  note?: string; // present for viewers (share note)
}
```

```typescript
// src/lib/view-context.tsx
"use client";

import { createContext, useContext } from "react";
import type { ViewContextValue } from "@/types/view-context";

const ViewContext = createContext<ViewContextValue | null>(null);

export function ViewContextProvider({
  value,
  children,
}: {
  value: ViewContextValue;
  children: React.ReactNode;
}) {
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useViewContext(): ViewContextValue {
  const ctx = useContext(ViewContext);
  if (!ctx) {
    throw new Error(
      "useViewContext must be used within a ViewContextProvider"
    );
  }
  return ctx;
}
```

**Where it is set:**

- Owner: `DashboardLayout` (RSC) creates the value from `auth()` and passes it to `ViewContextProvider`
- Viewer: `ViewerPage` (RSC) creates the value from the validated grant and passes it to `ViewContextProvider`

**Where it is consumed:**

- `MetricSelector` — reads `permissions.metrics` to determine available options
- `DateRangeSelector` — reads `permissions.dataStart/dataEnd` to set bounds
- `Header` — reads `role` to show owner nav or viewer info
- `ActionBar` — reads `role` to show/hide owner actions
- `ChartGrid` — reads `role` to choose between owner and viewer data hooks
- `Sidebar` — reads `role` to show/hide (hidden for viewers)

### 9.3 Dashboard Filter State

The dashboard's interactive filters (selected metrics, date range, resolution) are managed as local state in a parent component and passed down as props. This state drives TanStack Query keys for data fetching.

```typescript
// src/components/dashboard/DashboardContent.tsx
"use client";

import { useState, useCallback } from "react";
import { subDays, format } from "date-fns";

// Default selected metrics for new users
const DEFAULT_METRICS = [
  "sleep_score",
  "hrv",
  "rhr",
  "steps",
  "readiness_score",
];

interface DashboardFilterState {
  selectedMetrics: string[];
  dateRange: { start: string; end: string };
  resolution: "daily" | "weekly" | "monthly";
  overlayMode: boolean;
}

export function DashboardContent() {
  const { permissions } = useViewContext();

  const [filters, setFilters] = useState<DashboardFilterState>({
    selectedMetrics:
      permissions.metrics === "all"
        ? DEFAULT_METRICS
        : permissions.metrics.slice(0, 3),
    dateRange: {
      start:
        permissions.dataStart ?? format(subDays(new Date(), 30), "yyyy-MM-dd"),
      end: permissions.dataEnd ?? format(new Date(), "yyyy-MM-dd"),
    },
    resolution: "daily",
    overlayMode: false,
  });

  const updateMetrics = useCallback((metrics: string[]) => {
    setFilters((prev) => ({ ...prev, selectedMetrics: metrics }));
  }, []);

  const updateDateRange = useCallback(
    (range: { start: string; end: string }) => {
      setFilters((prev) => ({ ...prev, dateRange: range }));
    },
    [],
  );

  const updateResolution = useCallback(
    (resolution: "daily" | "weekly" | "monthly") => {
      setFilters((prev) => ({ ...prev, resolution }));
    },
    [],
  );

  // ... render toolbar + chart grid with these filters
}
```

---

## 10. Data Fetching Patterns

### 10.1 API Client

A typed fetch wrapper that handles authentication cookies, error parsing, and base URL resolution.

```typescript
// src/lib/api-client.ts

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api${path}`;

  const res = await fetch(url, {
    ...options,
    credentials: "include", // send cookies (Clerk session or viewer cookie)
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      error: { code: "UNKNOWN", message: "An unexpected error occurred" },
    }));
    throw new ApiError(
      res.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? "Request failed",
      body.error?.details,
    );
  }

  return res.json();
}

// Convenience methods
export const api = {
  get: <T>(path: string) => apiClient<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiClient<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiClient<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    apiClient<T>(path, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    }),
};
```

### 10.2 TanStack Query Configuration

```typescript
// src/lib/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is fresh for 30 seconds; background refetch after that
        staleTime: 30 * 1000,
        // Keep unused data in cache for 5 minutes
        gcTime: 5 * 60 * 1000,
        // Retry failed queries once with exponential backoff
        retry: 1,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
        // Do not refetch on window focus for health data (manual refresh preferred)
        refetchOnWindowFocus: false,
      },
      mutations: {
        // No automatic retry on mutations
        retry: 0,
      },
    },
  });
}
```

**Provider setup:**

```typescript
// src/components/layout/RootProviders.tsx
"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { makeQueryClient } from "@/lib/query-client";

export function RootProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </ThemeProvider>
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
```

### 10.3 Query Key Factory

All query keys follow a structured factory pattern for consistent cache management.

```typescript
// src/lib/query-keys.ts
export const queryKeys = {
  healthData: {
    all: ["health-data"] as const,
    list: (params: {
      metrics: string[];
      start: string;
      end: string;
      resolution: string;
    }) => ["health-data", params] as const,
    types: () => ["health-data", "types"] as const,
    series: (params: {
      metric_type: string;
      from: string;
      to: string;
      source?: string;
    }) => ["health-data", "series", params] as const,
    periods: (params: {
      event_type: string;
      from: string;
      to: string;
      source?: string;
    }) => ["health-data", "periods", params] as const,
  },
  viewerData: {
    all: ["viewer-data"] as const,
    list: (params: {
      metrics: string[];
      start: string;
      end: string;
      resolution: string;
    }) => ["viewer-data", params] as const,
  },
  connections: {
    all: ["connections"] as const,
    list: () => ["connections", "list"] as const,
  },
  sourcePreferences: {
    all: ["source-preferences"] as const,
    list: () => ["source-preferences", "list"] as const,
  },
  shares: {
    all: ["shares"] as const,
    list: (status?: string) => ["shares", "list", status] as const,
    detail: (id: string) => ["shares", id] as const,
  },
  audit: {
    all: ["audit"] as const,
    list: (filters: {
      eventType?: string;
      actorType?: string;
      start?: string;
      end?: string;
    }) => ["audit", "list", filters] as const,
  },
  user: {
    profile: () => ["user", "profile"] as const,
  },
} as const;
```

### 10.4 Hook Examples

#### useHealthData

Fetches health metric data for the owner dashboard.

```typescript
// src/hooks/useHealthData.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface HealthDataResponse {
  data: {
    metrics: Record<
      string,
      {
        unit: string;
        points: Array<{ date: string; value: number; source: string }>;
      }
    >;
    query: {
      start: string;
      end: string;
      resolution: string;
      metrics_requested: string[];
      metrics_returned: string[];
    };
  };
}

export function useHealthData(params: {
  metrics: string[];
  start: string;
  end: string;
  resolution: "daily" | "weekly" | "monthly";
}) {
  return useQuery({
    queryKey: queryKeys.healthData.list(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        metrics: params.metrics.join(","),
        start: params.start,
        end: params.end,
        resolution: params.resolution,
      });
      return api.get<HealthDataResponse>(
        `/health-data?${searchParams.toString()}`,
      );
    },
    // Only fetch if at least one metric is selected
    enabled: params.metrics.length > 0,
    // Health data changes infrequently; keep fresh for 2 minutes
    staleTime: 2 * 60 * 1000,
  });
}
```

#### useViewerData

Same interface as `useHealthData` but calls the viewer endpoint.

```typescript
// src/hooks/useViewerData.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

// Same HealthDataResponse type — response shape is identical
export function useViewerData(params: {
  metrics: string[];
  start: string;
  end: string;
  resolution: "daily" | "weekly" | "monthly";
}) {
  return useQuery({
    queryKey: queryKeys.viewerData.list(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        metrics: params.metrics.join(","),
        start: params.start,
        end: params.end,
        resolution: params.resolution,
      });
      return api.get<HealthDataResponse>(
        `/viewer/data?${searchParams.toString()}`,
      );
    },
    enabled: params.metrics.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
```

#### useSeriesData

Fetches intraday series data for a single metric (e.g., glucose, heart rate).

```typescript
// src/hooks/useSeriesData.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface SeriesDataResponse {
  data: {
    metric_type: string;
    source: string;
    readings: Array<{ recorded_at: string; value: number }>;
  };
}

export function useSeriesData(params: {
  metric_type: string;
  from: string;
  to: string;
  source?: string;
}) {
  return useQuery({
    queryKey: queryKeys.healthData.series(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        metric_type: params.metric_type,
        from: params.from,
        to: params.to,
      });
      if (params.source) searchParams.set("source", params.source);
      return api.get<SeriesDataResponse>(
        `/health-data/series?${searchParams.toString()}`,
      );
    },
    enabled: !!params.metric_type,
    staleTime: 2 * 60 * 1000,
  });
}
```

#### usePeriodsData

Fetches duration events (sleep stages, workouts, meals).

```typescript
// src/hooks/usePeriodsData.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface PeriodsDataResponse {
  data: {
    event_type: string;
    periods: Array<{
      subtype: string;
      started_at: string;
      ended_at: string;
      duration_sec: number;
      source: string;
      metadata?: Record<string, unknown>;
    }>;
  };
}

export function usePeriodsData(params: {
  event_type: string;
  from: string;
  to: string;
  source?: string;
}) {
  return useQuery({
    queryKey: queryKeys.healthData.periods(params),
    queryFn: () => {
      const searchParams = new URLSearchParams({
        event_type: params.event_type,
        from: params.from,
        to: params.to,
      });
      if (params.source) searchParams.set("source", params.source);
      return api.get<PeriodsDataResponse>(
        `/health-data/periods?${searchParams.toString()}`,
      );
    },
    enabled: !!params.event_type,
    staleTime: 2 * 60 * 1000,
  });
}
```

#### useSourcePreferences

Fetches the user's source preferences.

```typescript
// src/hooks/useSourcePreferences.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface SourcePreferencesResponse {
  data: Array<{
    metric_type: string;
    provider: string;
  }>;
}

export function useSourcePreferences() {
  return useQuery({
    queryKey: queryKeys.sourcePreferences.list(),
    queryFn: () => api.get<SourcePreferencesResponse>("/metric-preferences"),
    staleTime: 5 * 60 * 1000,
  });
}
```

#### useSetSourcePreference (Mutation)

```typescript
// src/hooks/useSetSourcePreference.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useSetSourcePreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      metricType,
      provider,
    }: {
      metricType: string;
      provider: string;
    }) => api.put(`/metric-preferences/${metricType}`, { provider }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourcePreferences.all,
      });
      // Also invalidate health data since source resolution may have changed
      queryClient.invalidateQueries({ queryKey: queryKeys.healthData.all });
    },
  });
}
```

#### useShares (Infinite Query)

Paginated share list with cursor-based pagination.

```typescript
// src/hooks/useShares.ts
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface SharesResponse {
  data: Array<{
    id: string;
    label: string;
    allowed_metrics: string[];
    data_start: string;
    data_end: string;
    grant_expires: string;
    status: "active" | "expired" | "revoked";
    revoked_at: string | null;
    view_count: number;
    last_viewed_at: string | null;
    created_at: string;
  }>;
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

export function useShares(status?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.shares.list(status),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "20");
      return api.get<SharesResponse>(`/shares?${params.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.has_more
        ? (lastPage.pagination.next_cursor ?? undefined)
        : undefined,
  });
}
```

#### useCreateShare (Mutation with Cache Invalidation)

```typescript
// src/hooks/useCreateShare.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface CreateShareRequest {
  label: string;
  allowed_metrics: string[];
  data_start: string;
  data_end: string;
  expires_in_days: number;
  note?: string;
}

interface CreateShareResponse {
  data: {
    id: string;
    token: string;
    share_url: string;
    label: string;
    allowed_metrics: string[];
    data_start: string;
    data_end: string;
    grant_expires: string;
    note: string | null;
    created_at: string;
  };
}

export function useCreateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateShareRequest) =>
      api.post<CreateShareResponse>("/shares", data),
    onSuccess: () => {
      // Invalidate shares list to show the new share
      queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
    },
  });
}
```

#### useRevokeShare (Mutation with Optimistic Update)

```typescript
// src/hooks/useRevokeShare.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

export function useRevokeShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shareId: string) =>
      api.patch(`/shares/${shareId}`, { action: "revoke" }),
    onMutate: async (shareId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.shares.all });

      // Snapshot current data for rollback
      const previousShares = queryClient.getQueriesData({
        queryKey: queryKeys.shares.all,
      });

      // Optimistically update: mark the share as revoked
      queryClient.setQueriesData(
        { queryKey: queryKeys.shares.all },
        (old: any) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              data: page.data.map((share: any) =>
                share.id === shareId
                  ? {
                      ...share,
                      status: "revoked",
                      revoked_at: new Date().toISOString(),
                    }
                  : share,
              ),
            })),
          };
        },
      );

      return { previousShares };
    },
    onError: (_err, _shareId, context) => {
      // Rollback on error
      if (context?.previousShares) {
        for (const [key, data] of context.previousShares) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      // Refetch to ensure server state consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
    },
  });
}
```

#### useAuditLog (Infinite Query with Filters)

```typescript
// src/hooks/useAuditLog.ts
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface AuditResponse {
  data: Array<{
    id: string;
    event_type: string;
    actor_type: "owner" | "viewer" | "system";
    actor_id: string | null;
    grant_id: string | null;
    grant_label: string | null;
    resource_type: string | null;
    resource_detail: Record<string, unknown> | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
  }>;
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

interface AuditFilters {
  eventType?: string;
  actorType?: string;
  start?: string;
  end?: string;
}

export function useAuditLog(filters: AuditFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.audit.list(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.eventType) params.set("event_type", filters.eventType);
      if (filters.actorType) params.set("actor_type", filters.actorType);
      if (filters.start) params.set("start", filters.start);
      if (filters.end) params.set("end", filters.end);
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "50");
      return api.get<AuditResponse>(`/audit?${params.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.has_more
        ? (lastPage.pagination.next_cursor ?? undefined)
        : undefined,
  });
}
```

### 10.5 Data Fetching for Owner vs Viewer (Unified Pattern)

The `ChartGrid` component uses the View Context to choose the correct data hook:

```typescript
// Inside ChartGrid component
const { role } = useViewContext();

// Select the appropriate hook based on role — daily aggregates
const { data, isLoading, error } =
  role === "owner"
    ? useHealthData({ metrics: dailyMetrics, start, end, resolution })
    : useViewerData({ metrics: dailyMetrics, start, end, resolution });

// Series data (intraday) — fetched separately per metric
const seriesQueries = seriesMetrics.map((metric) =>
  useSeriesData({ metric_type: metric, from: start, to: end }),
);

// Period data (events) — fetched separately per event type
const periodQueries = periodTypes.map((eventType) =>
  usePeriodsData({ event_type: eventType, from: start, to: end }),
);
```

**Why separate hooks per data type?** Daily aggregates, intraday series, and duration periods live in different database tables with different query patterns and response shapes. Daily data uses date-based keys; series data uses timestamp-based keys; periods have start/end ranges. Keeping them separate avoids conflating these concerns and lets each chart type consume exactly the shape it needs.

**Why separate owner/viewer hooks?** The endpoints differ (`/api/health-data` vs `/api/viewer/data`), the authentication mechanisms differ (Clerk cookie vs viewer cookie), and the response includes different metadata (viewer response has a `scope` field). However, the response's `data.metrics` shape is identical, so all chart components work without modification regardless of which hook provided the data.

---

## 11. Styling Architecture

### 11.1 Tailwind CSS v4 Configuration

Totus uses Tailwind CSS v4 with the new CSS-first configuration approach. Design tokens are defined as CSS custom properties in `globals.css` and consumed by Tailwind's utility classes.

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  /* Colors — HSL format for opacity support */
  --color-background: hsl(0, 0%, 100%);
  --color-foreground: hsl(222, 47%, 11%);
  --color-card: hsl(0, 0%, 100%);
  --color-card-foreground: hsl(222, 47%, 11%);
  --color-popover: hsl(0, 0%, 100%);
  --color-popover-foreground: hsl(222, 47%, 11%);
  --color-primary: hsl(222, 80%, 50%);
  --color-primary-foreground: hsl(0, 0%, 100%);
  --color-secondary: hsl(210, 40%, 96%);
  --color-secondary-foreground: hsl(222, 47%, 11%);
  --color-muted: hsl(210, 40%, 96%);
  --color-muted-foreground: hsl(215, 16%, 47%);
  --color-accent: hsl(210, 40%, 96%);
  --color-accent-foreground: hsl(222, 47%, 11%);
  --color-destructive: hsl(0, 84%, 60%);
  --color-destructive-foreground: hsl(0, 0%, 100%);
  --color-border: hsl(214, 32%, 91%);
  --color-input: hsl(214, 32%, 91%);
  --color-ring: hsl(222, 80%, 50%);
  --color-success: hsl(142, 71%, 45%);
  --color-success-foreground: hsl(0, 0%, 100%);
  --color-warning: hsl(38, 92%, 50%);
  --color-warning-foreground: hsl(0, 0%, 100%);

  /* Typography */
  --font-family-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-family-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Border radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg:
    0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}

/* Dark mode overrides */
.dark {
  --color-background: hsl(222, 47%, 6%);
  --color-foreground: hsl(210, 40%, 98%);
  --color-card: hsl(222, 47%, 8%);
  --color-card-foreground: hsl(210, 40%, 98%);
  --color-popover: hsl(222, 47%, 8%);
  --color-popover-foreground: hsl(210, 40%, 98%);
  --color-primary: hsl(222, 80%, 60%);
  --color-primary-foreground: hsl(0, 0%, 100%);
  --color-secondary: hsl(217, 33%, 17%);
  --color-secondary-foreground: hsl(210, 40%, 98%);
  --color-muted: hsl(217, 33%, 17%);
  --color-muted-foreground: hsl(215, 20%, 65%);
  --color-accent: hsl(217, 33%, 17%);
  --color-accent-foreground: hsl(210, 40%, 98%);
  --color-destructive: hsl(0, 62%, 50%);
  --color-destructive-foreground: hsl(0, 0%, 100%);
  --color-border: hsl(217, 33%, 20%);
  --color-input: hsl(217, 33%, 20%);
  --color-ring: hsl(222, 80%, 60%);
  --color-success: hsl(142, 71%, 40%);
  --color-warning: hsl(38, 92%, 45%);
}
```

### 11.2 Dark Mode Strategy

- **Detection:** `next-themes` with `attribute="class"` — adds/removes `.dark` class on `<html>`
- **Default:** System preference (`prefers-color-scheme`)
- **Toggle:** Manual toggle in the header (sun/moon icon)
- **Persistence:** `next-themes` stores preference in `localStorage`
- **Charts:** Recharts uses CSS custom properties for colors. The chart grid and axis strokes reference `--color-border` and `--color-muted-foreground` so they adapt automatically.

### 11.3 Responsive Breakpoints

| Breakpoint | Width  | Target Device                     |
| ---------- | ------ | --------------------------------- |
| `sm`       | 640px  | Large phones (landscape)          |
| `md`       | 768px  | Tablets                           |
| `lg`       | 1024px | Small laptops / tablets landscape |
| `xl`       | 1280px | Desktops                          |
| `2xl`      | 1536px | Large desktops                    |

**Key layout changes:**

- `< lg` (mobile/tablet): Bottom navigation bar instead of sidebar; single-column chart grid; stacked toolbar controls
- `>= lg` (desktop): Sidebar navigation; multi-column chart grid; horizontal toolbar

### 11.4 Typography Scale

| Token       | Size            | Weight | Usage                               |
| ----------- | --------------- | ------ | ----------------------------------- |
| `text-xs`   | 12px / 0.75rem  | 400    | Captions, timestamps, badge text    |
| `text-sm`   | 14px / 0.875rem | 400    | Body text, table cells, form labels |
| `text-base` | 16px / 1rem     | 400    | Default body text                   |
| `text-lg`   | 18px / 1.125rem | 500    | Card titles, section headers        |
| `text-xl`   | 20px / 1.25rem  | 600    | Page subtitles                      |
| `text-2xl`  | 24px / 1.5rem   | 700    | Page titles                         |
| `text-3xl`  | 30px / 1.875rem | 700    | Landing page headings               |
| `text-4xl`  | 36px / 2.25rem  | 800    | Hero headline                       |

**Font Loading:** Inter (variable font) loaded via `next/font/google` for optimal performance:

```typescript
// src/app/layout.tsx
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
```

### 11.5 Spacing System

Standard Tailwind spacing scale (multiples of 4px). Key conventions:

- Page padding: `p-4` (mobile), `p-6` (tablet+)
- Card padding: `p-4` (mobile), `p-6` (desktop)
- Section gaps: `gap-6` (between major sections)
- Inline gaps: `gap-2` (between chips, buttons), `gap-3` (between form fields)
- Max content width: `max-w-7xl` (1280px) centered

### 11.6 Class Merge Utility

```typescript
// src/lib/cn.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

All component class names use `cn()` for safe merging and conditional application.

---

## 12. Tooling Stack

### 12.1 Complete Tool Inventory

| Tool                       | Version            | Purpose                                           | Rationale                                                                                                                                                                                               |
| -------------------------- | ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bun**                    | ^1.2               | Package manager, script runner, local dev runtime | Significantly faster installs and script execution; built-in TypeScript transpilation; Vercel GA support as package manager. Production runtime remains Node.js (Bun runtime on Vercel is public beta). |
| **Next.js**                | ^15.0              | React framework                                   | App Router, RSC, API routes, middleware, Vercel-native deployment                                                                                                                                       |
| **TypeScript**             | ^5.5               | Type safety                                       | Strict mode enabled; catches entire categories of bugs at compile time                                                                                                                                  |
| **Tailwind CSS**           | ^4.0               | Utility-first CSS                                 | Rapid styling, design token system, tree-shakeable (unused utilities stripped)                                                                                                                          |
| **shadcn/ui**              | latest (generated) | Component primitives                              | Radix UI-based; accessible, unstyled primitives that we own (copied into project, not a dependency)                                                                                                     |
| **Recharts**               | ^2.13              | Charts                                            | React-native API, composable, good time-series support, active maintenance                                                                                                                              |
| **Lucide React**           | ^0.450             | Icons                                             | Tree-shakeable, consistent design language, MIT licensed, 1500+ icons                                                                                                                                   |
| **TanStack Query**         | ^5.60              | Data fetching/caching                             | Declarative server state management; caching, deduplication, background refetching, optimistic updates                                                                                                  |
| **React Hook Form**        | ^7.53              | Form management                                   | Minimal re-renders, uncontrolled inputs by default, Zod integration via `@hookform/resolvers`                                                                                                           |
| **Zod**                    | ^3.23              | Schema validation                                 | Shared between frontend and API for type safety; generates TypeScript types                                                                                                                             |
| **date-fns**               | ^4.1               | Date utilities                                    | Tree-shakeable (vs Moment.js), immutable, comprehensive formatting                                                                                                                                      |
| **next-themes**            | ^0.4               | Dark mode                                         | Handles system preference, manual toggle, SSR-safe (no flash)                                                                                                                                           |
| **sonner**                 | ^1.7               | Toast notifications                               | Beautiful default styling, accessible, Radix-compatible                                                                                                                                                 |
| **@clerk/nextjs**          | ^6.0               | Authentication UI                                 | Pre-built sign-in/up components, session management, middleware integration                                                                                                                             |
| **clsx**                   | ^2.1               | Conditional classes                               | Tiny utility for constructing className strings                                                                                                                                                         |
| **tailwind-merge**         | ^2.5               | Class conflict resolution                         | Merges conflicting Tailwind classes intelligently (e.g., `p-2 p-4` -> `p-4`)                                                                                                                            |
| **Vitest**                 | ^2.1               | Unit/component testing                            | Vite-native, fast, Jest-compatible API, excellent TypeScript support                                                                                                                                    |
| **@testing-library/react** | ^16.0              | Component testing                                 | Tests components as users interact with them, not implementation details                                                                                                                                |
| **Playwright**             | ^1.48              | E2E testing                                       | Cross-browser, reliable waits, excellent DX with codegen                                                                                                                                                |
| **ESLint**                 | ^9.0               | Linting                                           | Flat config format; catches code quality and import issues                                                                                                                                              |
| **typescript-eslint**      | ^8.0               | TS linting                                        | Type-aware linting rules for TypeScript                                                                                                                                                                 |
| **Prettier**               | ^3.4               | Code formatting                                   | Consistent formatting; integrates with ESLint via `eslint-config-prettier`                                                                                                                              |
| **@next/bundle-analyzer**  | ^15.0              | Bundle analysis                                   | Visualize what is in the client bundle; catch unintended large dependencies                                                                                                                             |
| **@sentry/nextjs**         | ^8.0               | Error tracking                                    | Captures unhandled exceptions, provides breadcrumbs and context                                                                                                                                         |

### 12.2 ESLint Configuration

```typescript
// eslint.config.mjs
import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@next/next": nextPlugin,
    },
    rules: {
      // Strict TypeScript rules
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/strict-boolean-expressions": "warn",

      // React rules
      "react/no-unescaped-entities": "off", // Allows ' in JSX

      // Import ordering
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling"],
          "newlines-between": "always",
        },
      ],
    },
  },
  prettierConfig,
];
```

### 12.3 TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    },
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Key strict settings:**

- `strict: true` — enables all strict type checks
- `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined`, catching common null reference bugs
- `forceConsistentCasingInFileNames: true` — prevents case-sensitivity bugs across OS

### 12.4 Development Scripts

```json
// package.json (scripts section)
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --max-warnings 0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "analyze": "ANALYZE=true next build",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "precommit": "bun run lint && bun run typecheck && bun run test"
  }
}
```

---

## 13. Accessibility

### 13.1 WCAG 2.1 AA Compliance Strategy

Accessibility is built into every component from the start, not retrofitted. The strategy relies on three pillars:

1. **Radix UI primitives (via shadcn/ui):** All interactive components (dialogs, dropdowns, tabs, tooltips) use Radix UI under the hood, which implements WAI-ARIA patterns correctly — focus traps, keyboard navigation, screen reader announcements, and proper role attributes.

2. **Semantic HTML:** Pages use proper heading hierarchy (`h1` > `h2` > `h3`), landmark regions (`<main>`, `<nav>`, `<aside>`, `<header>`), and `<button>` vs `<a>` for actions vs navigation.

3. **Testing:** Automated axe-core checks in component tests (via `@axe-core/react` in development and `vitest-axe` in tests).

### 13.2 Chart Accessibility

Charts are the hardest accessibility challenge. Recharts renders SVG, which is not inherently accessible. The approach:

**ARIA Labels:**

```typescript
// Each chart has a descriptive aria-label
<div
  role="img"
  aria-label={`Line chart showing ${metrics.map(m => METRIC_REGISTRY[m].label).join(", ")} from ${formatDate(start)} to ${formatDate(end)}`}
>
  <ResponsiveContainer>
    {/* Recharts chart */}
  </ResponsiveContainer>
</div>
```

**Data Table Alternative:**

Below each chart, a collapsible "View as table" button reveals a `<table>` with the same data:

```typescript
interface ChartDataTableProps {
  data: Record<
    string,
    { unit: string; points: Array<{ date: string; value: number }> }
  >;
  metrics: string[];
}

// Renders an HTML table with:
// - <caption> describing the data
// - <thead> with date column + one column per metric
// - <tbody> with one row per date
// - Properly associated <th scope="col"> and <th scope="row">
```

This satisfies WCAG 1.1.1 (Non-text Content) by providing a text alternative for the visual chart.

**Keyboard Navigation:**

- Charts are not focusable themselves (they are `role="img"`)
- The "View as table" button is keyboard-focusable
- Table rows can be navigated with Tab/Arrow keys

### 13.3 Focus Management

| Scenario                 | Focus Behavior                                                   |
| ------------------------ | ---------------------------------------------------------------- |
| Dialog opens             | Focus moves to first focusable element inside dialog             |
| Dialog closes            | Focus returns to the trigger element                             |
| Toast appears            | Announced via `aria-live="polite"`; does not steal focus         |
| Page navigation          | Focus moves to page heading (`h1`) via `useEffect`               |
| Share wizard step change | Focus moves to the new step's heading                            |
| Error message appears    | Focus moves to error text; announced via `aria-live="assertive"` |

### 13.4 Color Contrast

- All text meets 4.5:1 contrast ratio against its background (AA standard)
- Chart lines use colors with sufficient contrast against the chart background in both light and dark modes
- Status badges (active/expired/revoked) use both color AND text labels, not color alone (WCAG 1.4.1: Use of Color)
- Focus rings use `ring-2 ring-ring ring-offset-2` — visible in both themes

### 13.5 Motion

- `prefers-reduced-motion` media query is respected: skeleton animations and transitions are disabled
- No auto-playing animations
- Chart tooltips appear immediately (no entrance animation that could cause issues)

---

## 14. Performance

### 14.1 Core Web Vitals Targets

| Metric                              | Target  | Strategy                                                                      |
| ----------------------------------- | ------- | ----------------------------------------------------------------------------- |
| **LCP** (Largest Contentful Paint)  | < 2.0s  | Server-render dashboard shell; stream chart skeletons; prefetch critical data |
| **FID** (First Input Delay)         | < 100ms | Minimize main thread blocking; lazy-load chart library                        |
| **CLS** (Cumulative Layout Shift)   | < 0.1   | Fixed-dimension chart containers; skeleton matching final layout              |
| **INP** (Interaction to Next Paint) | < 200ms | Avoid synchronous renders on filter changes; use `startTransition`            |
| **TTFB** (Time to First Byte)       | < 400ms | Vercel Edge + RSC streaming                                                   |

### 14.2 Code Splitting Strategy

```
Initial Bundle (loaded on every page):
  - React runtime (~45 KB gzipped)
  - Next.js router (~20 KB gzipped)
  - Tailwind CSS (~8 KB gzipped, only used utilities)
  - Clerk auth (~15 KB gzipped)
  - Layout components (~10 KB gzipped)
  Total: ~98 KB gzipped — under 150 KB budget

Route-Level Splits (loaded on navigation):
  /dashboard         → +Recharts (~45 KB), TanStack Query (~12 KB), chart components (~15 KB)
  /dashboard/share   → +ShareWizard (~8 KB), React Hook Form (~10 KB)
  /dashboard/audit   → +AuditTable (~5 KB)
  /dashboard/settings → +ProfileForm (~3 KB)
  /v/[token]         → +Recharts (~45 KB), TanStack Query (~12 KB), viewer components (~10 KB)
```

**Key code splitting decisions:**

- Recharts is loaded only on pages with charts (dashboard and viewer) via dynamic import
- React Hook Form + Zod resolver are loaded only on the share wizard page
- shadcn/ui components are tree-shaken — only imported components are bundled
- Lucide icons are individually imported (not the full icon set)

**Dynamic Import Pattern for Recharts:**

```typescript
// src/components/dashboard/MetricChart.tsx
"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const RechartsChart = dynamic(
  () => import("./MetricChartInner").then((mod) => mod.MetricChartInner),
  {
    loading: () => <Skeleton className="h-[300px] w-full rounded-lg" />,
    ssr: false, // Recharts requires DOM; skip SSR entirely
  }
);

export function MetricChart(props: MetricChartProps) {
  return <RechartsChart {...props} />;
}
```

### 14.3 Data Optimization for Large Date Ranges

**Problem:** 5 years of daily data = ~1,825 data points per metric. Rendering 1,825 SVG `<circle>` elements per line in Recharts is feasible but sluggish on mobile.

**Solution: Client-Side Data Decimation**

When the viewport cannot display more than ~200 distinct x-axis positions, downsample the data before passing to Recharts:

```typescript
// src/lib/chart-utils.ts
export function decimateForDisplay(
  points: Array<{ date: string; value: number }>,
  maxPoints: number,
): Array<{ date: string; value: number }> {
  if (points.length <= maxPoints) return points;

  const step = Math.ceil(points.length / maxPoints);
  const result: Array<{ date: string; value: number }> = [];

  for (let i = 0; i < points.length; i += step) {
    // Use the point with the highest value in each window (preserves peaks)
    const window = points.slice(i, Math.min(i + step, points.length));
    const maxPoint = window.reduce((max, p) => (p.value > max.value ? p : max));
    result.push(maxPoint);
  }

  // Always include first and last points for correct axis range
  if (result[0]?.date !== points[0]?.date) result.unshift(points[0]!);
  if (result[result.length - 1]?.date !== points[points.length - 1]?.date) {
    result.push(points[points.length - 1]!);
  }

  return result;
}
```

Additionally, for ranges > 90 days, auto-switch resolution to `weekly`. For ranges > 1 year, auto-switch to `monthly`. The API handles aggregation server-side, returning fewer data points.

### 14.4 Font Loading

```typescript
// src/app/layout.tsx
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap", // show fallback font immediately, swap when Inter loads
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

`next/font` automatically self-hosts the font (no external request to Google Fonts), optimizes with `font-display: swap`, and generates `@font-face` declarations with preload hints.

### 14.5 Image Optimization

- Landing page illustrations: SVG inline or `next/image` with automatic WebP/AVIF conversion
- No user-uploaded images in MVP
- Totus logo: SVG component (no image request)
- `next/image` handles responsive sizing and lazy loading

### 14.6 Prefetching

- `<Link>` components in Next.js App Router automatically prefetch linked route data on viewport visibility
- Dashboard layout prefetches health data types on mount (even before user interacts with charts)
- Share management page prefetches the first page of shares

---

## 15. Testing Strategy

### 15.1 Testing Pyramid

```
                    ┌───────────┐
                    │   E2E     │  5-10 tests (critical flows)
                    │ Playwright│
                    ├───────────┤
                    │ Component │  30-50 tests (key components)
                    │ RTL +     │
                    │ Vitest    │
                    ├───────────┤
                    │   Unit    │  50-100 tests (utils, hooks, validators)
                    │  Vitest   │
                    └───────────┘
```

### 15.2 Unit Tests (Vitest)

**What to test:** Pure functions, utility libraries, Zod schemas, formatting functions.

**Example: Metric Config Validation**

```typescript
// src/lib/__tests__/metric-config.test.ts
import { describe, it, expect } from "vitest";
import { METRIC_REGISTRY, METRIC_TYPES } from "../metric-config";

describe("METRIC_REGISTRY", () => {
  it("defines all 21 MVP metric types", () => {
    expect(METRIC_TYPES).toHaveLength(21);
  });

  it("every metric has required fields", () => {
    for (const id of METRIC_TYPES) {
      const metric = METRIC_REGISTRY[id];
      expect(metric).toBeDefined();
      expect(metric.label).toBeTruthy();
      expect(metric.unit).toBeTruthy();
      expect(metric.category).toMatch(
        /^(sleep|cardiovascular|body|readiness|activity)$/,
      );
    }
  });
});
```

**Example: Date Utility Tests**

```typescript
// src/lib/__tests__/date-utils.test.ts
import { describe, it, expect } from "vitest";
import { getDatePresetRange, formatDateRange } from "../date-utils";

describe("getDatePresetRange", () => {
  it("returns 7-day range for 1W preset", () => {
    const range = getDatePresetRange("1W", "2026-03-09");
    expect(range.start).toBe("2026-03-02");
    expect(range.end).toBe("2026-03-09");
  });

  it("clamps to minDate/maxDate for viewer", () => {
    const range = getDatePresetRange("1Y", "2026-03-09", {
      minDate: "2025-06-01",
      maxDate: "2026-03-08",
    });
    expect(range.start).toBe("2025-06-01");
    expect(range.end).toBe("2026-03-08");
  });
});
```

**Example: Shared Zod Schema Tests**

```typescript
// src/lib/__tests__/validators.test.ts
import { describe, it, expect } from "vitest";
import { createShareSchema } from "../validators";

describe("createShareSchema", () => {
  it("validates a correct share creation request", () => {
    const result = createShareSchema.safeParse({
      label: "For Dr. Patel",
      allowed_metrics: ["sleep_score", "hrv"],
      data_start: "2025-06-01",
      data_end: "2026-03-08",
      expires_in_days: 30,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty metrics array", () => {
    const result = createShareSchema.safeParse({
      label: "Test",
      allowed_metrics: [],
      data_start: "2025-06-01",
      data_end: "2026-03-08",
      expires_in_days: 30,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid metric types", () => {
    const result = createShareSchema.safeParse({
      label: "Test",
      allowed_metrics: ["not_a_real_metric"],
      data_start: "2025-06-01",
      data_end: "2026-03-08",
      expires_in_days: 30,
    });
    expect(result.success).toBe(false);
  });

  it("rejects expiration over 365 days", () => {
    const result = createShareSchema.safeParse({
      label: "Test",
      allowed_metrics: ["sleep_score"],
      data_start: "2025-06-01",
      data_end: "2026-03-08",
      expires_in_days: 500,
    });
    expect(result.success).toBe(false);
  });
});
```

### 15.3 Component Tests (Vitest + React Testing Library)

**What to test:** Component rendering, conditional rendering based on role, user interactions.

**Example: MetricSelector**

```typescript
// src/components/dashboard/__tests__/MetricSelector.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetricSelector } from "../MetricSelector";

const mockMetrics = [
  { metric_type: "sleep_score", label: "Sleep Score", category: "sleep", data_point_count: 100 },
  { metric_type: "hrv", label: "HRV", category: "cardiovascular", data_point_count: 100 },
  { metric_type: "rhr", label: "Resting Heart Rate", category: "cardiovascular", data_point_count: 100 },
  { metric_type: "steps", label: "Steps", category: "activity", data_point_count: 100 },
];

describe("MetricSelector", () => {
  it("renders all available metrics as chips", () => {
    render(
      <MetricSelector
        availableMetrics={mockMetrics}
        selectedMetrics={["sleep_score"]}
        onSelectionChange={vi.fn()}
      />
    );
    expect(screen.getByText("Sleep Score")).toBeInTheDocument();
    expect(screen.getByText("HRV")).toBeInTheDocument();
    expect(screen.getByText("Steps")).toBeInTheDocument();
  });

  it("calls onSelectionChange when a chip is toggled", () => {
    const onChange = vi.fn();
    render(
      <MetricSelector
        availableMetrics={mockMetrics}
        selectedMetrics={["sleep_score"]}
        onSelectionChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("HRV"));
    expect(onChange).toHaveBeenCalledWith(["sleep_score", "hrv"]);
  });

  it("disables unselected chips when maxSelection is reached", () => {
    render(
      <MetricSelector
        availableMetrics={mockMetrics}
        selectedMetrics={["sleep_score", "hrv", "rhr"]}
        onSelectionChange={vi.fn()}
        maxSelection={3}
      />
    );
    const stepsChip = screen.getByText("Steps").closest("button");
    expect(stepsChip).toBeDisabled();
  });

  it("renders as read-only when readOnly is true", () => {
    render(
      <MetricSelector
        availableMetrics={mockMetrics}
        selectedMetrics={["sleep_score", "hrv"]}
        onSelectionChange={vi.fn()}
        readOnly
      />
    );
    const chips = screen.getAllByRole("button");
    chips.forEach((chip) => expect(chip).toHaveAttribute("aria-disabled", "true"));
  });
});
```

### 15.4 E2E Tests (Playwright)

**What to test:** Critical user flows end-to-end.

**Test Scenarios:**

| #     | Scenario            | Steps                                                                                                                 | Assertions                                           |
| ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| E2E-1 | Provider Connection | Sign in -> click "Add Source" -> select provider -> complete OAuth mock -> verify connection card shows "Active"      | Connection status visible, toast shown               |
| E2E-2 | Dashboard Data View | Sign in -> navigate to dashboard -> verify charts render with data -> change date range -> verify charts update       | Charts render, date range picker works, data updates |
| E2E-3 | Share Creation      | Sign in -> click "Share" -> complete wizard -> copy URL -> navigate to share management -> verify new share listed    | Share appears in list, URL was copyable              |
| E2E-4 | Share Revocation    | Sign in -> navigate to shares -> click "Revoke" on active share -> confirm -> verify status changes                   | Status badge shows "Revoked", revoke button gone     |
| E2E-5 | Viewer Flow         | Open share URL -> verify viewer dashboard renders -> verify only granted metrics shown -> verify date range is locked | Correct metrics, date range locked, no owner nav     |
| E2E-6 | Expired Share       | Open expired share URL -> verify "link no longer available" page                                                      | Error page shown, no data leaked                     |
| E2E-7 | Audit Log           | Sign in -> navigate to audit -> verify events listed -> filter by "Viewers" -> verify filtered results                | Events render, filters work, pagination works        |
| E2E-8 | Account Deletion    | Sign in -> settings -> click "Delete Account" -> type confirmation -> submit -> verify redirect to landing            | Redirected to "/", signed out                        |

**Playwright Configuration:**

```typescript
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "bun run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

**Auth Helpers for E2E:**

```typescript
// e2e/helpers/auth.ts
import { Page } from "@playwright/test";

// Use Clerk testing tokens for E2E
// See: https://clerk.com/docs/testing/overview
export async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(process.env.TEST_USER_EMAIL!);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("/dashboard");
}
```

### 15.5 Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/components/ui/**", // shadcn generated components
        "src/app/**/layout.tsx",
        "src/app/**/page.tsx", // RSC pages tested via E2E
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

```typescript
// src/test-setup.ts
import "@testing-library/jest-dom/vitest";
```

---

## 16. Security (Frontend)

### 16.1 Content Security Policy

The CSP is set via Next.js middleware response headers. This is the frontend's primary defense against XSS.

```typescript
// Applied in next.config.ts via headers()
const cspHeader = [
  "default-src 'self'",
  // Clerk requires its scripts and inline scripts for hydration
  "script-src 'self' 'unsafe-inline' https://clerk.com https://*.clerk.accounts.dev",
  "style-src 'self' 'unsafe-inline'", // Tailwind injects inline styles
  "img-src 'self' data: https:", // Allow data URIs for SVG and external images
  "font-src 'self'", // Self-hosted fonts via next/font
  "connect-src 'self' https://api.clerk.com https://*.clerk.accounts.dev",
  "frame-src 'self' https://clerk.com https://*.clerk.accounts.dev",
  "frame-ancestors 'none'", // Prevent framing (clickjacking)
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
```

**Note:** `'unsafe-inline'` for scripts is required by Clerk and Next.js hydration. This is mitigated by the other CSP directives (no external script sources beyond Clerk). A nonce-based CSP is possible but adds complexity that is not warranted for MVP.

### 16.2 XSS Prevention

1. **React's default escaping:** React escapes all interpolated values in JSX. `{userInput}` in JSX is safe by default.
2. **No `dangerouslySetInnerHTML`:** This pattern is banned in the codebase. If needed for rich text (e.g., share notes), use a sanitizer like DOMPurify. For MVP, all user-generated text is rendered as plain text.
3. **Zod validation on both sides:** User inputs (share labels, notes, display names) are validated with Zod schemas on both the frontend (for immediate feedback) and the API (as the security boundary).
4. **No HTML in API responses:** All API responses are `Content-Type: application/json`. No user-provided data is rendered as HTML by the server.

### 16.3 CSRF Protection

- **Owner sessions:** Clerk's session cookies use `SameSite=Lax`, which prevents CSRF for state-changing requests (POST, PATCH, DELETE) from cross-origin pages. Clerk additionally validates the origin header.
- **Viewer sessions:** The `totus_viewer` cookie uses `SameSite=Lax` and `httpOnly`. Viewer sessions are read-only (no mutations), so CSRF is not a concern.
- **No CSRF tokens needed for MVP:** The combination of `SameSite=Lax` cookies and origin validation provides sufficient CSRF protection for a cookie-based SPA.

### 16.4 Secure Cookie Handling

| Cookie              | httpOnly | Secure | SameSite | Domain       | Path | Max-Age          |
| ------------------- | -------- | ------ | -------- | ------------ | ---- | ---------------- |
| `__session` (Clerk) | Yes      | Yes    | Lax      | `.totus.com` | `/`  | Session (7 days) |
| `totus_viewer`      | Yes      | Yes    | Lax      | `.totus.com` | `/`  | 4 hours (max)    |

- `httpOnly` prevents JavaScript access (XSS cannot steal cookies)
- `Secure` ensures cookies are only sent over HTTPS
- `SameSite=Lax` prevents cross-origin requests from sending cookies (CSRF protection)

### 16.5 No Secrets in Client Bundles

**Rule:** No environment variable without the `NEXT_PUBLIC_` prefix is available in client-side code. This is enforced by Next.js at build time.

**Allowed in client bundle:**

- `NEXT_PUBLIC_APP_URL` — the application URL (e.g., `https://totus.com`)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk's publishable key (safe to expose)

**NOT in client bundle (server-only):**

- `CLERK_SECRET_KEY`
- `DATABASE_URL`
- `VIEWER_JWT_SECRET`
- `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`
- AWS credentials (KMS, S3)

**Enforcement:** A build-time check verifies no `process.env.` references without `NEXT_PUBLIC_` exist in client components.

### 16.6 Additional Frontend Security Headers

Set in `next.config.ts`:

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Content-Security-Policy", value: cspHeader },
        ],
      },
    ];
  },
};
```

---

## 17. Dependencies

### 17.1 Production Dependencies

| Package                 | Pinned Range | Size (gzip)      | Rationale                                                     |
| ----------------------- | ------------ | ---------------- | ------------------------------------------------------------- |
| `next`                  | `^15.0.0`    | — (framework)    | App Router, RSC, streaming, API routes                        |
| `react`                 | `^19.0.0`    | ~6 KB            | Required by Next.js 15                                        |
| `react-dom`             | `^19.0.0`    | ~40 KB           | Required by Next.js 15                                        |
| `@clerk/nextjs`         | `^6.0.0`     | ~15 KB           | Auth provider with pre-built UI and middleware                |
| `@tanstack/react-query` | `^5.60.0`    | ~12 KB           | Server state management; caching, mutations, infinite queries |
| `recharts`              | `^2.13.0`    | ~45 KB           | Time-series charts; React-native API, composable              |
| `react-hook-form`       | `^7.53.0`    | ~9 KB            | Performant form state; minimal re-renders                     |
| `@hookform/resolvers`   | `^3.9.0`     | ~2 KB            | Zod integration for React Hook Form                           |
| `zod`                   | `^3.23.0`    | ~14 KB           | Schema validation shared with API layer                       |
| `date-fns`              | `^4.1.0`     | ~7 KB (used)     | Tree-shakeable date utilities                                 |
| `next-themes`           | `^0.4.0`     | ~2 KB            | Dark mode with SSR support                                    |
| `sonner`                | `^1.7.0`     | ~5 KB            | Toast notifications                                           |
| `lucide-react`          | `^0.450.0`   | ~1 KB (per icon) | Tree-shakeable icon library                                   |
| `clsx`                  | `^2.1.0`     | <1 KB            | Conditional class names                                       |
| `tailwind-merge`        | `^2.5.0`     | ~3 KB            | Resolve Tailwind class conflicts                              |
| `@radix-ui/*`           | varies       | varies           | Primitive components (via shadcn/ui); aria-compliant          |

### 17.2 Development Dependencies

| Package                            | Pinned Range | Purpose                                          |
| ---------------------------------- | ------------ | ------------------------------------------------ |
| `typescript`                       | `^5.5.0`     | Type checking                                    |
| `tailwindcss`                      | `^4.0.0`     | CSS framework                                    |
| `@tailwindcss/vite`                | `^4.0.0`     | Tailwind CSS v4 Vite integration                 |
| `vitest`                           | `^2.1.0`     | Test runner                                      |
| `@testing-library/react`           | `^16.0.0`    | Component testing utilities                      |
| `@testing-library/jest-dom`        | `^6.6.0`     | DOM assertion matchers                           |
| `@playwright/test`                 | `^1.48.0`    | E2E testing                                      |
| `eslint`                           | `^9.0.0`     | Linting                                          |
| `@typescript-eslint/eslint-plugin` | `^8.0.0`     | TypeScript lint rules                            |
| `@typescript-eslint/parser`        | `^8.0.0`     | TypeScript parser for ESLint                     |
| `eslint-config-prettier`           | `^9.1.0`     | Disable ESLint rules that conflict with Prettier |
| `prettier`                         | `^3.4.0`     | Code formatting                                  |
| `prettier-plugin-tailwindcss`      | `^0.6.0`     | Sort Tailwind classes                            |
| `@next/bundle-analyzer`            | `^15.0.0`    | Bundle size analysis                             |
| `@sentry/nextjs`                   | `^8.0.0`     | Error tracking                                   |
| `@tanstack/react-query-devtools`   | `^5.60.0`    | Query state debugging                            |
| `@vitejs/plugin-react`             | `^4.3.0`     | React support in Vitest                          |
| `jsdom`                            | `^25.0.0`    | DOM simulation for Vitest                        |

### 17.3 Dependency Update Policy

- **Security patches:** Applied immediately (automated via Dependabot or Renovate)
- **Minor versions:** Reviewed and updated weekly during active development
- **Major versions:** Evaluated per-package; only adopted when there is a clear benefit (new feature, performance, security)
- **Lock file:** `bun.lock` is committed and used for all installs (deterministic builds). Playwright E2E tests run via `bunx playwright test` which delegates to Node.js (Playwright does not support the Bun runtime)

---

## 18. Design Alternatives Considered

### 18.1 Chart Library: Recharts vs Alternatives

| Library                        | Pros                                                                                      | Cons                                                                                                | Verdict                                                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recharts** (chosen)          | React-native API (JSX); composable; good time-series defaults; active maintenance; ~45 KB | Not the fastest for very large datasets; SVG-based                                                  | **Selected.** Best DX for a React project. Composable API matches our component architecture. SVG rendering is fine for our data volumes (max ~1,825 points with decimation). |
| **Chart.js (react-chartjs-2)** | Canvas-based (faster for large datasets); smaller bundle                                  | Imperative API wrapped in React; less composable; tooltip/legend customization is harder            | Rejected. Canvas performance is unnecessary for our scale. The imperative API fights React's declarative model.                                                               |
| **D3**                         | Maximum flexibility; handles any visualization                                            | Steep learning curve; not React-native; requires manual DOM management; massive scope               | Rejected. Overkill for time-series line charts. D3 is for custom/novel visualizations.                                                                                        |
| **Tremor**                     | Pre-styled charts with Tailwind integration; beautiful defaults                           | Less customizable; smaller ecosystem; tied to their design system                                   | Rejected. Too opinionated. We need control over chart colors, tooltips, and overlay behavior. Also, Tremor uses Recharts internally.                                          |
| **Visx (Airbnb)**              | Low-level D3-powered React primitives; maximum flexibility                                | Requires building everything from scratch (axes, tooltips, legends); no high-level chart components | Rejected. Too low-level for MVP velocity. Would require building a chart abstraction layer.                                                                                   |
| **Nivo**                       | Beautiful defaults; server-side rendering support                                         | Less customization of time-series; heavier bundle; smaller community                                | Rejected. Good library but Recharts has better community support and time-series patterns.                                                                                    |

### 18.2 Component Library: shadcn/ui vs Alternatives

| Library                         | Pros                                                                                                 | Cons                                                                              | Verdict                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **shadcn/ui** (chosen)          | Copy-paste model (you own the code); Radix UI primitives (accessible); Tailwind-native; customizable | Not a versioned dependency; must maintain copies                                  | **Selected.** The copy-paste model gives us full control. Radix primitives ensure accessibility. Tailwind integration is native. No CSS-in-JS runtime. |
| **Chakra UI**                   | Comprehensive; good DX; accessible                                                                   | CSS-in-JS runtime (Emotion); conflicts with Tailwind; larger bundle; less control | Rejected. CSS-in-JS runtime adds overhead and conflicts with Tailwind as primary styling.                                                              |
| **Mantine**                     | Feature-rich; good hooks library                                                                     | CSS Modules or CSS-in-JS; less Tailwind-native; opinionated                       | Rejected. Does not integrate cleanly with Tailwind v4.                                                                                                 |
| **Headless UI (Tailwind Labs)** | Tailwind-native; simple                                                                              | Fewer primitives than Radix; missing some components we need (Calendar, Command)  | Rejected. Insufficient primitive coverage. Would need supplementing with Radix anyway.                                                                 |
| **Radix UI (direct)**           | Full primitive set; accessible; unstyled                                                             | Requires building all styling from scratch                                        | shadcn/ui IS Radix UI with Tailwind styling applied. Using shadcn saves us the styling work.                                                           |

### 18.3 Data Fetching: TanStack Query vs Alternatives

| Library                     | Pros                                                                                                                                 | Cons                                                                                                              | Verdict                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TanStack Query** (chosen) | Purpose-built for server state; caching, deduplication, background refetch, optimistic updates, infinite queries; excellent DevTools | Additional dependency (~12 KB)                                                                                    | **Selected.** Server state management is the core UI challenge (filter changes trigger refetches, pagination, cache invalidation on mutations). TanStack Query handles all of this declaratively.             |
| **SWR**                     | Simpler API; smaller bundle (~5 KB)                                                                                                  | Missing features we need: no built-in optimistic updates, no infinite query primitive, simpler cache invalidation | Rejected. Missing optimistic update support for share revocation. Missing infinite query support for paginated lists. These would require manual implementation.                                              |
| **Native fetch + useState** | No dependencies; full control                                                                                                        | Must manually handle: loading state, error state, caching, deduplication, stale data, refetching, pagination      | Rejected. Would reinvent 80% of what TanStack Query provides. Error-prone and time-consuming.                                                                                                                 |
| **Next.js Server Actions**  | Tight framework integration; no separate API client                                                                                  | Less control over caching; no client-side cache management; mutations less flexible                               | Rejected for data reads. Server Actions are great for mutations but do not provide client-side caching. We would still need TanStack Query for read queries. Could use Server Actions for mutations post-MVP. |

### 18.4 Form Management: React Hook Form vs Alternatives

| Library                              | Pros                                                                             | Cons                                                      | Verdict                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React Hook Form** (chosen)         | Minimal re-renders (uncontrolled); Zod integration; small bundle (~9 KB); mature | Uncontrolled model can be confusing initially             | **Selected.** The share wizard has a multi-step form with validation at each step. RHF handles this efficiently with minimal re-renders. Zod resolver shares schemas with the API. |
| **Formik**                           | Popular; controlled model is intuitive                                           | Larger bundle; more re-renders; less active maintenance   | Rejected. Performance concerns with controlled inputs in a multi-step wizard.                                                                                                      |
| **Native React (controlled inputs)** | No dependencies                                                                  | Verbose; manual validation; re-renders on every keystroke | Rejected. Too much boilerplate for a 4-step wizard with Zod validation.                                                                                                            |

### 18.5 Toast Library: Sonner vs Alternatives

| Library                           | Pros                                                                                     | Cons                                                | Verdict                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Sonner** (chosen)               | Beautiful defaults; promise-based API; customizable; small (~5 KB); works with shadcn/ui | Newer library                                       | **Selected.** Clean API. Styled well with shadcn/ui themes. Promise integration allows `toast.promise()` for async operations. |
| **react-hot-toast**               | Simple API; popular                                                                      | Less customizable; no built-in action buttons       | Rejected. Sonner has better integration with our design system.                                                                |
| **shadcn/ui Toast (Radix Toast)** | Native to our component library                                                          | More boilerplate; requires imperative API with refs | Rejected. Sonner's API is simpler.                                                                                             |

---

## 19. Risks and Mitigations

| #       | Risk                                                                                                              | Severity | Likelihood | Mitigation                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-UI-1  | Recharts SVG rendering is slow with 5 years of daily data on mobile devices                                       | Medium   | Medium     | Client-side data decimation to max 200 points per chart (Section 14.3). Auto-switch to weekly/monthly resolution for large ranges. Profile on low-end devices during development.                                                                                                                                             |
| R-UI-2  | Clerk SDK update breaks auth flow or middleware                                                                   | Medium   | Low        | Pin `@clerk/nextjs` to a specific minor version. Test auth flows in E2E suite on every Clerk upgrade. Clerk has backwards-compatible versioning.                                                                                                                                                                              |
| R-UI-3  | TanStack Query cache becomes stale after background sync imports new data                                         | Low      | Medium     | After a manual sync trigger completes, invalidate `queryKeys.healthData.all` and `queryKeys.healthData.types`. For automatic background syncs, the 30-second stale time means the dashboard updates within 30 seconds of any data change (or on next page focus).                                                             |
| R-UI-4  | Tailwind CSS v4 is newer and may have ecosystem compatibility issues with shadcn/ui or plugins                    | Medium   | Low        | shadcn/ui has released Tailwind v4 compatible versions. If issues arise, the CSS-first config is backwards-compatible. Pin Tailwind to a known-good version.                                                                                                                                                                  |
| R-UI-5  | Share URL is lost if user closes the creation dialog before copying                                               | High     | Medium     | ShareUrlDialog cannot be dismissed by clicking the backdrop. Close button is labeled "I've copied the link." A secondary "Copy" button is in the dialog body. URL is also displayed as selectable text. Consider adding "Email this link" as a fallback.                                                                      |
| R-UI-6  | Viewer page initial load is slow because token validation requires a server round trip before data can be fetched | Medium   | Medium     | Token validation happens in the RSC (server-side), so it does not block client hydration. The validated grant data (metrics, dates) is streamed as props to the client, which immediately begins fetching chart data. Total added latency: ~200ms (token validation p95 from API LLD Section 5.2).                            |
| R-UI-7  | Large number of audit events causes infinite scroll performance issues                                            | Low      | Low        | Virtual scrolling (not needed for MVP with 50 events per page). Cursor pagination ensures consistent performance regardless of total event count.                                                                                                                                                                             |
| R-UI-8  | Dark mode chart colors are not distinguishable from each other                                                    | Medium   | Medium     | All chart colors are tested in both themes. Colors use HSL with varying hue (not just lightness). Each color is assigned a distinct metric and is always paired with a text label (legend).                                                                                                                                   |
| R-UI-9  | Bundle size exceeds 150 KB budget for initial load                                                                | Medium   | Low        | Recharts is dynamically imported (not in initial bundle). Run `@next/bundle-analyzer` on every PR. Set a CI check that fails if initial bundle exceeds budget.                                                                                                                                                                |
| R-UI-10 | Client-side routing to `/v/[token]` leaks the share token in browser history                                      | Low      | High       | The token IS the URL path and will be in browser history. This is acceptable because: (1) the token is a one-time credential that starts a session, (2) the session cookie is what actually authenticates data requests, (3) clearing history clears the URL. Viewer devices are presumably the doctor's/coach's own devices. |

---

## 20. Appendix

### 20.1 Complete Route Table

| Route                  | Access | Page Component        | Auth Gate                          | RSC/Client         |
| ---------------------- | ------ | --------------------- | ---------------------------------- | ------------------ |
| `/`                    | Public | `LandingPage`         | None                               | RSC                |
| `/sign-in`             | Public | `SignInPage`          | Redirect to `/dashboard` if authed | Client             |
| `/sign-up`             | Public | `SignUpPage`          | Redirect to `/dashboard` if authed | Client             |
| `/dashboard`           | Owner  | `DashboardPage`       | Clerk session required             | RSC shell + Client |
| `/dashboard/share`     | Owner  | `ShareManagementPage` | Clerk session required             | RSC shell + Client |
| `/dashboard/share/new` | Owner  | `ShareWizardPage`     | Clerk session required             | Client             |
| `/dashboard/audit`     | Owner  | `AuditLogPage`        | Clerk session required             | RSC shell + Client |
| `/dashboard/settings`  | Owner  | `SettingsPage`        | Clerk session required             | RSC shell + Client |
| `/v/[token]`           | Viewer | `ViewerPage`          | Token validation (server)          | RSC shell + Client |

### 20.2 Wireframe Descriptions

#### Dashboard (Owner, Desktop)

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌───────────────────────────────────────────────┐  │
│ │          │ │  Dashboard                    🌙  Wes E. ▼   │  │
│ │  TOTUS   │ ├───────────────────────────────────────────────┤  │
│ │          │ │                                               │  │
│ │ Dashboard│ │  [Oura ●] [Whoop ●] [Withings ●]  [+ Add]   │  │
│ │ Shares   │ │                                               │  │
│ │ Activity │ │                                               │  │
│ │ Settings │ │                                               │  │
│ │          │ │                                               │  │
│ │          │ │  [Sleep Score✓] [HRV✓] [RHR✓] [Steps] ...   │  │
│ │          │ │                                               │  │
│ │          │ │  [1W] [1M] [3M✓] [6M] [1Y] [5Y] [All]      │  │
│ │          │ │  [Daily✓] [Weekly] [Monthly]                 │  │
│ │          │ │                                               │  │
│ │          │ │  ┌─────────────────────────────────────────┐  │  │
│ │          │ │  │  Sleep Score                     ▲ 85   │  │  │
│ │          │ │  │                                         │  │  │
│ │          │ │  │  ╱\    /\      /╲                       │  │  │
│ │          │ │  │ /  \  /  \    /  \                      │  │  │
│ │          │ │  │/    \/    \  /    \     ╱\              │  │  │
│ │          │ │  │            \/      \   /  \             │  │  │
│ │          │ │  │                     \_/    \            │  │  │
│ │          │ │  │                                         │  │  │
│ │          │ │  │  Dec    Jan    Feb    Mar               │  │  │
│ │          │ │  └─────────────────────────────────────────┘  │  │
│ │          │ │                                               │  │
│ │          │ │  ┌──────────────────┐ ┌──────────────────┐   │  │
│ │          │ │  │  HRV        42ms │ │  RHR        62bpm│   │  │
│ │          │ │  │  ╱\    /\       │ │                   │   │  │
│ │          │ │  │ /  \  /  \      │ │  ─────────        │   │  │
│ │          │ │  │/    \/    ╲     │ │        ─────      │   │  │
│ │          │ │  │                  │ │                   │   │  │
│ │          │ │  └──────────────────┘ └──────────────────┘   │  │
│ │          │ │                                               │  │
│ │          │ │         [Share Data]  [Export]                │  │
│ │          │ │                                               │  │
│ └──────────┘ └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### Dashboard (Owner, Mobile)

```
┌───────────────────────┐
│  Dashboard    🌙  ≡   │
├───────────────────────┤
│                       │
│  [Oura●][Whoop●][+Add]│
│                       │
│                       │
│  [SleepScore✓] [HRV✓] │
│  [RHR✓] [Steps] ...   │
│                       │
│  [1W][1M][3M✓][6M]...│
│  [Daily✓][Wkly][Mo]  │
│                       │
│  ┌─────────────────┐  │
│  │ Sleep Score  85  │  │
│  │  ╱\   /\        │  │
│  │ /  \ /  \       │  │
│  │/    \/    ╲     │  │
│  │  Dec  Jan  Feb  │  │
│  └─────────────────┘  │
│                       │
│  ┌─────────────────┐  │
│  │ HRV      42 ms  │  │
│  │  ╱\   /\        │  │
│  │ /  \ /  \       │  │
│  └─────────────────┘  │
│                       │
│ [Share Data] [Export] │
│                       │
├───────────────────────┤
│ 📊  📤  📋  ⚙️      │
│ Dash Share Audit Set  │
└───────────────────────┘
```

#### Share Wizard (Step 1 — Select Metrics)

```
┌───────────────────────────────────────────────┐
│  ← Back                                       │
│                                               │
│  Create a Share Link                          │
│  Step 1 of 4: Select Metrics                  │
│                                               │
│  Choose which health metrics to share.        │
│                                               │
│  Sleep                                        │
│  [Sleep Score ✓] [Sleep Duration] [Efficiency]│
│  [Latency] [Deep Sleep] [REM] [Light] [Awake]│
│                                               │
│  Cardiovascular                               │
│  [HRV ✓] [RHR ✓] [Respiratory] [SpO2]       │
│                                               │
│  Activity                                     │
│  [Steps] [Active Cal] [Total Cal] [Score]    │
│                                               │
│  Body                                         │
│  [Body Temp]                                  │
│                                               │
│  Readiness                                    │
│  [Readiness Score]                            │
│                                               │
│  3 metrics selected                           │
│                                               │
│                              [Cancel] [Next →]│
└───────────────────────────────────────────────┘
```

#### Viewer Page

```
┌─────────────────────────────────────────────────────┐
│  TOTUS              Shared by Wes E.                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  📋 Shared health data                      │    │
│  │  Metrics: Sleep Score, HRV, RHR             │    │
│  │  Period: Jun 1, 2025 – Mar 8, 2026          │    │
│  │  Note: "Please review my sleep trends"      │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  [Sleep Score ✓] [HRV ✓] [RHR ✓]                   │
│                                                     │
│  Jun 2025 ──────────────────── Mar 2026  🔒        │
│  [Daily ✓] [Weekly] [Monthly]                       │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Sleep Score                          ▲ 85  │    │
│  │  ╱\    /\      /╲                           │    │
│  │ /  \  /  \    /  \                          │    │
│  │/    \/    \  /    \     ╱\                  │    │
│  │            \/      \   /  \                 │    │
│  │                     \_/    \                │    │
│  │  Jun  Jul  Aug  Sep  Oct  Nov  Dec  Jan  Feb│    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌──────────────────┐ ┌──────────────────┐          │
│  │  HRV        42ms │ │  RHR        62bpm│          │
│  │  chart...        │ │  chart...        │          │
│  └──────────────────┘ └──────────────────┘          │
│                                                     │
│  Powered by Totus · totus.com                       │
└─────────────────────────────────────────────────────┘
```

### 20.3 Metric Type Registry (Complete)

```typescript
// src/lib/metric-config.ts

export interface MetricConfig {
  id: string;
  label: string;
  unit: string;
  category: "sleep" | "cardiovascular" | "body" | "readiness" | "activity";
  valueType: "integer" | "float";
  description: string;
}

export const METRIC_TYPES = [
  "sleep_score",
  "sleep_duration",
  "sleep_efficiency",
  "sleep_latency",
  "deep_sleep",
  "rem_sleep",
  "light_sleep",
  "awake_time",
  "hrv",
  "rhr",
  "respiratory_rate",
  "spo2",
  "body_temperature_deviation",
  "readiness_score",
  "activity_score",
  "steps",
  "active_calories",
  "total_calories",
  "glucose",
  "weight",
  "body_fat",
] as const;

export type MetricType = (typeof METRIC_TYPES)[number];

export const METRIC_REGISTRY: Record<MetricType, MetricConfig> = {
  sleep_score: {
    id: "sleep_score",
    label: "Sleep Score",
    unit: "score",
    category: "sleep",
    valueType: "integer",
    description: "Overall sleep quality score (0-100)",
  },
  sleep_duration: {
    id: "sleep_duration",
    label: "Sleep Duration",
    unit: "hr",
    category: "sleep",
    valueType: "float",
    description: "Total time asleep",
  },
  sleep_efficiency: {
    id: "sleep_efficiency",
    label: "Sleep Efficiency",
    unit: "%",
    category: "sleep",
    valueType: "integer",
    description: "Percentage of time in bed spent asleep",
  },
  sleep_latency: {
    id: "sleep_latency",
    label: "Sleep Latency",
    unit: "min",
    category: "sleep",
    valueType: "integer",
    description: "Time to fall asleep",
  },
  deep_sleep: {
    id: "deep_sleep",
    label: "Deep Sleep",
    unit: "hr",
    category: "sleep",
    valueType: "float",
    description: "Time in deep sleep stage",
  },
  rem_sleep: {
    id: "rem_sleep",
    label: "REM Sleep",
    unit: "hr",
    category: "sleep",
    valueType: "float",
    description: "Time in REM sleep stage",
  },
  light_sleep: {
    id: "light_sleep",
    label: "Light Sleep",
    unit: "hr",
    category: "sleep",
    valueType: "float",
    description: "Time in light sleep stage",
  },
  awake_time: {
    id: "awake_time",
    label: "Awake Time",
    unit: "min",
    category: "sleep",
    valueType: "integer",
    description: "Time awake during the night",
  },
  hrv: {
    id: "hrv",
    label: "Heart Rate Variability",
    unit: "ms",
    category: "cardiovascular",
    valueType: "float",
    description: "Average nighttime HRV (RMSSD)",
  },
  rhr: {
    id: "rhr",
    label: "Resting Heart Rate",
    unit: "bpm",
    category: "cardiovascular",
    valueType: "integer",
    description: "Lowest nighttime heart rate",
  },
  respiratory_rate: {
    id: "respiratory_rate",
    label: "Respiratory Rate",
    unit: "bpm",
    category: "cardiovascular",
    valueType: "float",
    description: "Average nighttime breaths per minute",
  },
  spo2: {
    id: "spo2",
    label: "Blood Oxygen",
    unit: "%",
    category: "cardiovascular",
    valueType: "float",
    description: "Average blood oxygen saturation",
  },
  body_temperature_deviation: {
    id: "body_temperature_deviation",
    label: "Body Temp Deviation",
    unit: "°C",
    category: "body",
    valueType: "float",
    description: "Deviation from personal baseline body temperature",
  },
  readiness_score: {
    id: "readiness_score",
    label: "Readiness Score",
    unit: "score",
    category: "readiness",
    valueType: "integer",
    description: "Overall readiness score (0-100)",
  },
  activity_score: {
    id: "activity_score",
    label: "Activity Score",
    unit: "score",
    category: "activity",
    valueType: "integer",
    description: "Overall activity score (0-100)",
  },
  steps: {
    id: "steps",
    label: "Steps",
    unit: "steps",
    category: "activity",
    valueType: "integer",
    description: "Total daily steps",
  },
  active_calories: {
    id: "active_calories",
    label: "Active Calories",
    unit: "kcal",
    category: "activity",
    valueType: "integer",
    description: "Calories burned through activity",
  },
  total_calories: {
    id: "total_calories",
    label: "Total Calories",
    unit: "kcal",
    category: "activity",
    valueType: "integer",
    description: "Total calories burned (active + basal)",
  },
  glucose: {
    id: "glucose",
    label: "Glucose",
    unit: "mg/dL",
    category: "body",
    valueType: "float",
    description: "Blood glucose level",
  },
  weight: {
    id: "weight",
    label: "Weight",
    unit: "kg",
    category: "body",
    valueType: "float",
    description: "Body weight",
  },
  body_fat: {
    id: "body_fat",
    label: "Body Fat",
    unit: "%",
    category: "body",
    valueType: "float",
    description: "Body fat percentage",
  },
};

// Category groupings for the MetricSelector UI
export const METRIC_CATEGORIES = [
  {
    id: "sleep",
    label: "Sleep",
    metrics: [
      "sleep_score",
      "sleep_duration",
      "sleep_efficiency",
      "sleep_latency",
      "deep_sleep",
      "rem_sleep",
      "light_sleep",
      "awake_time",
    ],
  },
  {
    id: "cardiovascular",
    label: "Cardiovascular",
    metrics: ["hrv", "rhr", "respiratory_rate", "spo2"],
  },
  { id: "readiness", label: "Readiness", metrics: ["readiness_score"] },
  {
    id: "activity",
    label: "Activity",
    metrics: ["activity_score", "steps", "active_calories", "total_calories"],
  },
  {
    id: "body",
    label: "Body",
    metrics: ["body_temperature_deviation", "glucose", "weight", "body_fat"],
  },
] as const;

// Default metrics shown on first dashboard load
export const DEFAULT_SELECTED_METRICS: MetricType[] = [
  "sleep_score",
  "hrv",
  "rhr",
  "steps",
  "readiness_score",
];
```

### 20.4 API Types (Generated from API LLD)

```typescript
// src/types/api.ts

// --- Health Data ---

export interface HealthDataPoint {
  date: string; // YYYY-MM-DD
  value: number;
  source: string;
}

export interface MetricData {
  unit: string;
  points: HealthDataPoint[];
}

export interface HealthDataResponse {
  data: {
    metrics: Record<string, MetricData>;
    query: {
      start: string;
      end: string;
      resolution: "daily" | "weekly" | "monthly";
      metrics_requested: string[];
      metrics_returned: string[];
    };
  };
}

export interface HealthDataTypesResponse {
  data: {
    types: Array<{
      metric_type: string;
      label: string;
      unit: string;
      category: string;
      source: string;
      earliest_date: string;
      latest_date: string;
      data_point_count: number;
    }>;
  };
}

// --- Connections ---

export interface Connection {
  id: string;
  provider: string;
  status: "connected" | "expired" | "error";
  last_sync_at: string | null;
  connected_at: string;
}

export interface ConnectionsResponse {
  data: Connection[];
}

// --- Shares ---

export interface ShareGrant {
  id: string;
  label: string;
  allowed_metrics: string[];
  data_start: string;
  data_end: string;
  grant_expires: string;
  status: "active" | "expired" | "revoked";
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export interface SharesResponse {
  data: ShareGrant[];
  pagination: PaginationMeta;
}

export interface CreateShareResponse {
  data: ShareGrant & {
    token: string; // Only returned at creation
    share_url: string; // Only returned at creation
    note: string | null;
  };
}

// --- Audit ---

export interface AuditEvent {
  id: string;
  event_type: string;
  actor_type: "owner" | "viewer" | "system";
  actor_id: string | null;
  grant_id: string | null;
  grant_label: string | null;
  resource_type: string | null;
  resource_detail: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditResponse {
  data: AuditEvent[];
  pagination: PaginationMeta;
}

// --- User ---

export interface UserProfile {
  id: string;
  display_name: string;
  email: string;
  has_2fa: boolean;
  created_at: string;
  stats: {
    total_data_points: number;
    connected_sources: string[];
    active_shares: number;
    earliest_data: string | null;
    latest_data: string | null;
  };
}

export interface UserProfileResponse {
  data: UserProfile;
}

// --- Viewer ---

export interface ViewerValidateResponse {
  data: {
    valid: boolean;
    owner_display_name: string;
    label: string;
    note: string | null;
    allowed_metrics: string[];
    data_start: string;
    data_end: string;
    expires_at: string;
  };
}

export interface ViewerDataResponse extends HealthDataResponse {
  data: HealthDataResponse["data"] & {
    scope: {
      grant_id: string;
      allowed_metrics: string[];
      data_start: string;
      data_end: string;
    };
  };
}

// --- Common ---

export interface PaginationMeta {
  next_cursor: string | null;
  has_more: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
}
```

### 20.5 Implementation Roadmap (Frontend-Specific)

#### Phase 1: Foundation

| Task                                                            | Deliverable                                   | Dependencies           |
| --------------------------------------------------------------- | --------------------------------------------- | ---------------------- |
| Initialize Next.js 15 project with TypeScript, Tailwind v4, Bun | Working `bun run dev` with empty app          | None                   |
| Configure ESLint, Prettier, Vitest, Playwright                  | Passing `bun run lint`, `bun run test`        | Project init           |
| Install and configure shadcn/ui                                 | Generated primitives in `src/components/ui/`  | Tailwind config        |
| Set up Clerk integration                                        | Working sign-in/sign-up, middleware auth gate | Clerk account          |
| Create RootLayout with providers (theme, query, toast)          | Working layout with dark mode toggle          | shadcn/ui, next-themes |
| Build DashboardShell (sidebar, header, content area)            | Working dashboard layout shell                | Clerk auth             |
| Build landing page (static)                                     | Marketing page at `/`                         | Tailwind               |
| Set up View Context provider                                    | `useViewContext()` hook working               | None                   |

#### Phase 2: Dashboard Core

| Task                                        | Deliverable                          | Dependencies                |
| ------------------------------------------- | ------------------------------------ | --------------------------- |
| Build MetricSelector component              | Chip toggles with category grouping  | shadcn/ui, metric config    |
| Build DateRangeSelector component           | Preset buttons + custom range picker | shadcn/ui Calendar          |
| Build ResolutionToggle component            | Daily/weekly/monthly tabs            | shadcn/ui Tabs              |
| Build MetricChart component (Recharts)      | Time-series line chart with tooltip  | Recharts                    |
| Build ChartGrid component                   | Responsive chart layout              | MetricChart                 |
| Implement `useHealthData` hook              | TanStack Query integration           | API client                  |
| Implement `useHealthDataTypes` hook         | Metric type discovery                | API client                  |
| Wire up DashboardContent (filters + charts) | Interactive dashboard with real data | All above                   |
| Build ProviderConnectionCard component      | Provider status + connect/sync       | API client, provider-config |
| Build AddProviderDialog component           | Provider selection grid              | provider-config             |
| Build ProviderConnectionBar                 | Dashboard provider status row        | ProviderConnectionCard      |
| Build EmptyDashboard component              | Empty state with provider grid CTA   | AddProviderDialog           |
| Handle OAuth callback query params          | Toast on connection success          | Dashboard, provider-config  |
| Build IntradayChart component               | Intraday series line chart           | Recharts                    |
| Build PeriodTimeline component              | Duration event timeline              | Recharts                    |
| Build SourceBadge + SourceToggle components | Multi-source attribution UI          | provider-config             |
| Implement `useSeriesData` hook              | Intraday series data fetching        | API client                  |
| Implement `usePeriodsData` hook             | Duration event data fetching         | API client                  |
| Implement `useSourcePreferences` hooks      | Source preference CRUD               | API client                  |
| Build SourcePreferenceSelector              | Per-metric source picker             | useSourcePreferences        |

#### Phase 3: Sharing

| Task                                             | Deliverable                         | Dependencies            |
| ------------------------------------------------ | ----------------------------------- | ----------------------- |
| Build ShareWizard (4 steps)                      | Multi-step form with validation     | RHF, Zod, metric config |
| Build ShareUrlDialog                             | Post-creation URL display with copy | useCopyToClipboard      |
| Implement `useCreateShare` mutation              | Create share via API                | API client              |
| Build ShareList + ShareCard                      | Paginated share management          | `useShares`             |
| Build RevokeDialog                               | Confirmation dialog                 | shadcn/ui Dialog        |
| Implement `useRevokeShare` mutation (optimistic) | Instant revoke with rollback        | TanStack Query          |
| Implement `useDeleteShare` mutation              | Delete revoked/expired shares       | API client              |
| Build ViewerPage (RSC + token validation)        | Working `/v/[token]` route          | API client              |
| Build ViewerHeader + ViewerBanner                | Viewer-specific chrome              | View Context            |
| Build ShareExpiredPage                           | Error page for invalid tokens       | None                    |
| Wire up viewer data fetching (`useViewerData`)   | Charts with scoped data             | ChartGrid               |

#### Phase 4: Audit and Settings

| Task                             | Deliverable                           | Dependencies       |
| -------------------------------- | ------------------------------------- | ------------------ |
| Build AuditTable + AuditEventRow | Paginated audit event list            | `useAuditLog`      |
| Build AuditFilters               | Event type, actor, date range filters | shadcn/ui          |
| Implement audit event formatting | Human-readable event descriptions     | format.ts          |
| Build ProfileForm                | Display name edit                     | `useUpdateProfile` |
| Build ConnectionsManager         | Connect/disconnect/sync management    | Connections API    |
| Build ExportSection              | Export trigger with download          | `useExportData`    |
| Build DeleteAccountDialog        | Account deletion with confirmation    | `useDeleteAccount` |

#### Phase 5: Polish

| Task                                                     | Deliverable                    | Dependencies   |
| -------------------------------------------------------- | ------------------------------ | -------------- |
| Loading states (skeletons) for all pages                 | No blank screens               | All components |
| Error states and retry for all data-dependent components | Graceful degradation           | All components |
| Empty states for all lists                               | Helpful CTAs                   | All components |
| Dark mode testing and color fixes                        | Both themes look correct       | Theme system   |
| Mobile responsive testing (375px-768px)                  | All pages functional on mobile | All components |
| Accessibility audit (axe-core, keyboard nav)             | WCAG 2.1 AA compliance         | All components |
| Chart data table alternatives (accessibility)            | "View as table" for each chart | MetricChart    |
| Performance profiling (bundle size, LCP, CLS)            | Under budget                   | All components |
| Write unit tests (utilities, validators, hooks)          | >80% coverage on lib/          | Vitest         |
| Write component tests (key components)                   | 30-50 tests                    | RTL + Vitest   |
| Write E2E tests (8 critical flows)                       | Green E2E suite                | Playwright     |

### 20.6 Delegation Recommendations

| Component/Module              | Recommended Agent/Specialist      | Notes                                                        |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------ |
| Project scaffolding (Phase 1) | Full-stack agent                  | Needs Next.js, Clerk, Tailwind, and tooling knowledge        |
| MetricChart + ChartGrid       | Frontend visualization specialist | Recharts expertise, responsive SVG, performance optimization |
| ShareWizard                   | Form/UX specialist                | Multi-step form state, Zod validation, React Hook Form       |
| Viewer token validation (RSC) | Full-stack agent                  | Server-side fetch, cookie handling, RSC patterns             |
| Audit log formatting          | Frontend agent                    | Pure function mapping, date formatting, i18n-ready patterns  |
| Accessibility audit           | Accessibility specialist          | axe-core, ARIA patterns, keyboard navigation testing         |
| E2E test suite                | QA/testing specialist             | Playwright, auth mocking, cross-browser                      |
| Performance optimization      | Performance specialist            | Bundle analysis, code splitting, Recharts optimization       |

---

_End of document._
