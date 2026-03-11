# Totus Architecture Design: Auth, Permissions, Unified Viewer, and Audit

### Version 1.0 — March 2026

### Status: Draft — Awaiting Founder Review

---

## 1. Requirements Summary

### Functional Requirements

- **FR-1**: User registration and login with email/password, 2FA (TOTP), and OAuth. Health data integration via multi-provider OAuth pipeline (see `integrations-pipeline-lld.md`).
- **FR-2**: Unified web application where owners see full dashboard with edit/admin actions and viewers see the same dashboard in read-only mode, driven by permissions
- **FR-3**: Granular permission grants scoped by metric type, data date range, and expiration timestamp, revocable at any time
- **FR-4**: Every data access (owner or viewer) is recorded in an immutable audit log with who, what, when, IP, and user-agent
- **FR-5**: Owner can review the complete audit log for their data with high confidence

### Non-Functional Requirements

- **NFR-1**: Dashboard loads in under 2 seconds even with years of data
- **NFR-2**: Per-user encryption at rest via AWS KMS
- **NFR-3**: HTTPS everywhere, GDPR-aligned data handling
- **NFR-4**: OpenAPI-compliant API
- **NFR-5**: Deploy on Vercel (Next.js) with AWS backend services (RDS/Aurora for PostgreSQL, KMS, potentially SQS)
- **NFR-6**: Audit log must be immutable (append-only, no user-facing delete)

### Constraints and Assumptions

- **C-1**: Single founder building MVP, likely with AI coding assistance. Complexity must be minimized.
- **C-2**: Next.js App Router on Vercel is the deployment target.
- **C-3**: PostgreSQL is the database (likely AWS RDS or Aurora Serverless v2).
- **C-4**: Free tier during MVP; cost-sensitive infrastructure choices.
- **C-5**: The viewer (doctor/coach) must NOT need an account. The share link IS their credential.
- **A-1**: Vercel deployment (not self-hosted Next.js on EC2/ECS). This affects auth provider choice.
- **A-2**: The audit log volume at MVP scale (500 users) is manageable in PostgreSQL without a dedicated log store.

---

## 2. Auth Provider Comparison and Recommendation

### Evaluation Criteria

The requirements demand: email/password, TOTP 2FA, OAuth (multi-provider health data integration, plus standard social login later), JWT-compatible sessions, clean Next.js App Router integration, support for "anonymous" token-based viewer sessions (share links), and a permission model that is NOT managed by the auth provider but by the application.

### Comparison Matrix

```
+------------------+----------+---------+----------+---------+-----------+
| Criterion        | Cognito  | Clerk   | Auth0    | Supabase| NextAuth  |
|                  |          |         |          | Auth    | (DIY)     |
+==================+==========+=========+==========+=========+===========+
| Email/Password   | Yes      | Yes     | Yes      | Yes     | Yes       |
+------------------+----------+---------+----------+---------+-----------+
| TOTP 2FA         | Yes      | Yes     | Yes      | Yes(1)  | Manual(2) |
+------------------+----------+---------+----------+---------+-----------+
| Custom OAuth     | Yes(3)   | Yes     | Yes      | Yes     | Yes       |
| (Oura)           |          |         |          |         |           |
+------------------+----------+---------+----------+---------+-----------+
| Social Login     | Yes      | Yes     | Yes      | Yes     | Yes       |
| (Google, etc.)   |          |         |          |         |           |
+------------------+----------+---------+----------+---------+-----------+
| Next.js App      | Poor(4)  | Best    | Good     | Good    | Good(5)   |
| Router support   |          |         |          |         |           |
+------------------+----------+---------+----------+---------+-----------+
| Vercel-friendly  | Moderate | Best    | Good     | Good    | Good      |
+------------------+----------+---------+----------+---------+-----------+
| Custom session   | Hard(6)  | Yes(7)  | Yes(8)   | Yes     | Yes       |
| claims (roles)   |          |         |          |         |           |
+------------------+----------+---------+----------+---------+-----------+
| Viewer (anon)    | No fit   | Partial | Partial  | Partial | Full ctrl |
| token sessions   |   (9)    |  (10)   |  (10)    |  (10)   |   (11)    |
+------------------+----------+---------+----------+---------+-----------+
| Hosted UI quality| Poor     | Best    | Good     | Good    | N/A (own) |
+------------------+----------+---------+----------+---------+-----------+
| MVP cost (500    | Free(12) | Free    | Free     | Free    | Free      |
| users)           |          | (13)    | (14)     | (15)    |           |
+------------------+----------+---------+----------+---------+-----------+
| Operational      | High     | Low     | Low      | Low     | Medium    |
| complexity       |          |         |          |         |           |
+------------------+----------+---------+----------+---------+-----------+
| Lock-in risk     | High     | Medium  | Medium   | Low(16) | None      |
+------------------+----------+---------+----------+---------+-----------+
| Pre-built UI     | Ugly(17) | Best    | Good     | Basic   | None      |
| components       |          |         |          |         |           |
+------------------+----------+---------+----------+---------+-----------+
```

**Notes:**

1. Supabase Auth has TOTP support but it was added more recently and the DX is less polished than Clerk or Auth0.
2. NextAuth (now Auth.js v5) does NOT provide 2FA out of the box. You must build TOTP enrollment, verification, and recovery flows yourself. This is significant effort.
3. Cognito supports custom OIDC providers, but Oura uses plain OAuth2, not OIDC. This requires a Lambda bridge or custom adapter, adding complexity.
4. Cognito's SDK (Amplify) has historically poor App Router support. The `@aws-amplify/adapter-nextjs` exists but is clunky, and Amplify pulls in a large dependency graph. Server Component support is awkward.
5. NextAuth v5 (Auth.js) has good App Router support but you own all the session logic.
6. Cognito tokens have a fixed claim structure. Adding custom claims requires a Pre Token Generation Lambda trigger, which adds latency and operational surface.
7. Clerk allows custom session claims via its Backend API and has a `sessionClaims` mechanism.
8. Auth0 uses "Actions" (post-login hooks) to inject custom claims into JWTs.
9. Cognito has no concept of "anonymous sessions with scoped permissions." You would have to create Cognito guest users or bypass Cognito entirely for viewers. Both paths are messy.
10. Clerk, Auth0, and Supabase Auth are all designed around "users with accounts." A viewer who has no account does not map cleanly to any of them. You would need to handle viewer tokens separately regardless.
11. With NextAuth/Auth.js, you have full control of the session. You can issue a custom JWT for viewers that encodes the share_grant_id and viewer role, using the same session middleware.
12. Cognito: 50,000 MAU free tier (generous).
13. Clerk: 10,000 MAU free, then $0.02/MAU. Well within MVP budget.
14. Auth0: Free tier is 7,500 MAU, 2 social connections. Sufficient for MVP.
15. Supabase Auth: Free tier is 50,000 MAU.
16. Supabase Auth uses standard PostgreSQL tables you can inspect/migrate.
17. Cognito's hosted UI is notoriously rigid and difficult to customize.

### Recommendation: Clerk

**Primary recommendation: Clerk. Fallback: Auth.js (NextAuth v5) if the founder prefers zero vendor dependency.**

Rationale for Clerk:

1. **Best-in-class Next.js integration.** Clerk was built for Next.js. `@clerk/nextjs` provides `clerkMiddleware()` that runs in the Vercel Edge Runtime, `auth()` in Server Components, `useAuth()` in Client Components. No gymnastics.

2. **2FA is built in.** TOTP enrollment, verification, backup codes, and the UI components are all provided. With NextAuth you would spend 1-2 weeks building this from scratch.

3. **Custom OAuth (Oura).** Clerk supports custom OAuth2 providers via its dashboard configuration. You add Oura's authorize/token/userinfo endpoints and it handles the flow.

4. **Pre-built UI components.** `<SignIn>`, `<SignUp>`, `<UserProfile>` components that are polished and themeable. For a solo founder, this saves weeks of UI work.

5. **Session metadata.** Clerk's `publicMetadata` and `sessionClaims` let you attach custom data (like `role: owner`) to the session, accessible in middleware.

6. **The viewer session is handled separately anyway.** No auth provider cleanly handles "anonymous viewer with a scoped token." This is true for Clerk too, but Clerk does not get in the way. You will have a parallel, thin session mechanism for viewers (detailed below), and Clerk's middleware can be configured to allow it.

**Why NOT Cognito:**

Cognito is the worst fit here despite being an AWS service. The Amplify SDK is heavy and fights with App Router patterns. The hosted UI is ugly. Custom OAuth (non-OIDC) requires Lambda workarounds. Injecting custom claims requires Lambda triggers. It adds operational complexity (CloudFormation, Lambda maintenance) that is inappropriate for a solo founder deploying on Vercel. The only advantage is deep AWS integration (IAM role mapping), which as addressed in Section 5, is not the right pattern for this use case anyway.

**Why NOT Auth0:**

Auth0 is a solid product but it is more enterprise-oriented (pricing scales aggressively), the Next.js SDK is slightly behind Clerk's in App Router ergonomics, and the "Actions" system for custom claims is heavier than necessary for MVP. It is a reasonable choice but Clerk is simpler for this exact use case.

**Why NOT NextAuth/Auth.js (DIY):**

Auth.js v5 is good middleware and gives you maximum control. But "maximum control" means building 2FA from scratch (TOTP secret generation, QR code enrollment, verification, backup codes, recovery), building all auth UI, and handling edge cases that Clerk solves out of the box. For a solo founder racing to MVP, the 2-3 weeks saved on auth UI and 2FA is worth the Clerk dependency.

### Auth Architecture With Clerk

```
                        Request Flow
                        ============

Browser ──HTTPS──> Vercel Edge ──> clerkMiddleware()
                                       │
                           ┌───────────┴────────────┐
                           │                        │
                    Has Clerk session?        Has viewer token?
                    (cookie: __session)       (URL: /v/[token])
                           │                        │
                      Yes: Clerk                Yes: Custom
                      resolves user             JWT validation
                      + userId                  + grant lookup
                           │                        │
                      ctx.role = "owner"       ctx.role = "viewer"
                      ctx.userId = "usr_xxx"   ctx.grantId = "grt_xxx"
                           │                        │
                           └───────────┬────────────┘
                                       │
                                  Next.js App
                              (same routes, same
                               components, same API)
```

**Key design point:** The middleware produces a unified `RequestContext` object regardless of whether the session is from Clerk (owner) or from a viewer token. Downstream code never cares which auth path was used; it only sees `{ role, userId?, grantId?, permissions }`.

---

## 3. Unified Viewer Architecture

### Core Principle: One App, Two Roles, Permission-Driven Rendering

The same Next.js application, the same React components, and the same API routes serve both owners and viewers. The difference is entirely in what the permission layer allows.

### Route Structure

```
/                         -> Landing/marketing (public)
/sign-in                  -> Clerk sign-in (public)
/sign-up                  -> Clerk sign-up (public)
/dashboard                -> Main dashboard (owner only)
/dashboard/share          -> Share management (owner only)
/dashboard/audit          -> Audit log viewer (owner only)
/dashboard/settings       -> Account settings (owner only)
/v/[token]                -> Shared view (viewer, via token)
/api/health-data          -> Data API (both, permission-gated)
/api/shares               -> Share management API (owner only)
/api/audit                -> Audit log API (owner only)
```

### How the Viewer Session Works

When a viewer opens `/v/[token]`, the following happens:

```
1. Viewer clicks link:  https://totus.com/v/abc123def456
                              │
2. Middleware intercepts:     │
   - No Clerk session         │
   - Extracts token from URL  │
   - Looks up share_grant     │
     in database              │
                              │
3. Validation checks:         │
   - Does the grant exist?    │
   - Is it revoked?           │
   - Is it expired?           │
   - Is current time within   │
     the grant's valid window?│
                              │
4. If valid:                  │
   - Set a short-lived,       │
     httpOnly, signed cookie: │
     viewer_session = JWT     │
     containing:              │
       { grantId, ownerId,    │
         metrics, dataStart,  │
         dataEnd, exp }       │
   - Cookie exp = min(grant   │
     expiration, now + 4hr)   │
   - Redirect to /v/[token]   │
     (now with cookie set)    │
                              │
5. Page renders:              │
   - Middleware reads cookie   │
   - Populates RequestContext  │
     with viewer permissions  │
   - Dashboard components     │
     render in read-only mode │
                              │
6. If invalid:                │
   - Render "Link expired"    │
     or "Link revoked" page   │
```

**Why a cookie, not just the URL token on every request?**

The URL token is the initial credential. Once validated, a short-lived session cookie avoids database lookups on every single API call within a viewing session. The cookie JWT contains the full permission grant (which metrics, which date range), so API routes can enforce permissions from the JWT alone without hitting the database on every request. The grant is re-validated from the database on cookie issuance only (and on explicit refresh if the cookie expires during a session).

**Why NOT use Clerk for viewers?**

Creating a Clerk "user" for every doctor who clicks a link would be wrong: the PRD explicitly says no account needed. Clerk would also charge per-MAU for these phantom users. A separate, thin JWT mechanism for viewers is simpler and cheaper.

### Conditional Rendering Pattern

The component architecture uses a `ViewContext` that is populated from the request context and passed via React Context (server-side) and client-side provider.

```
┌─────────────────────────────────────────────────────┐
│                   DashboardShell                    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ Header                                      │    │
│  │  - Owner: shows settings, share, logout     │    │
│  │  - Viewer: shows "Shared by [name]" + note  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌──────────────────┐  ┌──────────────────────┐    │
│  │ MetricSelector   │  │ DateRangeSelector    │    │
│  │  - Owner: all    │  │  - Owner: any range  │    │
│  │    metrics,      │  │  - Viewer: locked to │    │
│  │    add/remove    │  │    granted range     │    │
│  │  - Viewer: only  │  │                      │    │
│  │    granted       │  │                      │    │
│  │    metrics,      │  │                      │    │
│  │    read-only     │  │                      │    │
│  └──────────────────┘  └──────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ ChartGrid                                   │    │
│  │  - Same chart components for both roles     │    │
│  │  - Data fetched through same API            │    │
│  │  - API enforces: only permitted metrics     │    │
│  │    and date range returned                  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ ActionBar (owner only)                      │    │
│  │  - Share, Export, Delete                    │    │
│  │  - Hidden entirely for viewers              │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Implementation approach for conditional rendering:**

A `useViewContext()` hook returns `{ role, permissions }`. Components use this to decide what to render:

- Components that are owner-only (ActionBar, ShareManager, AuditLog) check `role === "owner"` and return `null` for viewers.
- Components that behave differently (MetricSelector, DateRangeSelector) use `permissions` to constrain their options.
- Chart components are identical for both roles; the data they receive is already permission-filtered by the API layer.

**Critical enforcement rule:** The frontend role check is for UX only. The API layer is the security boundary. Even if someone manipulates the frontend to show extra UI, the API will reject unauthorized requests. Defense in depth.

### API Route Permission Enforcement (Middleware Design)

```
┌──────────────────────────────────────────────────────────┐
│                     Middleware Chain                      │
│                                                          │
│  1. clerkMiddleware()  ──or──  viewerTokenMiddleware()   │
│     │                            │                       │
│     ▼                            ▼                       │
│  2. buildRequestContext()                                │
│     Produces: { role, userId?, grantId?, permissions }   │
│     │                                                    │
│     ▼                                                    │
│  3. API Route Handler                                    │
│     │                                                    │
│     ├── Reads requested metrics + date range from query  │
│     │                                                    │
│     ├── Calls enforcePermissions(ctx, requestedScope)    │
│     │   - Owner: always allowed for own data             │
│     │   - Viewer: intersect request with grant scope     │
│     │     - Reject if any metric not in grant            │
│     │     - Clamp date range to grant boundaries         │
│     │     - Reject if grant expired or revoked           │
│     │                                                    │
│     ├── Fetch data (only permitted scope)                │
│     │                                                    │
│     ├── Emit audit event (async, non-blocking)           │
│     │                                                    │
│     └── Return response                                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

The `enforcePermissions` function is a pure function that takes the request context and the requested data scope, and returns either an allowed scope (possibly narrowed) or a rejection. It is the single place where permission logic lives. Every API route calls it. There is no way to bypass it.

---

## 4. Permission Model Design

### Data Model

```
┌──────────────────────────────────────────────────────────┐
│                      share_grants                         │
├──────────────────────────────────────────────────────────┤
│ id              UUID PRIMARY KEY DEFAULT gen_random_uuid()│
│ token           VARCHAR(64) UNIQUE NOT NULL               │
│                 (cryptographically random, URL-safe)      │
│ owner_id        VARCHAR(64) NOT NULL                      │
│                 (Clerk user ID, e.g., "user_2x...")       │
│ label           VARCHAR(255)                              │
│                 (e.g., "For Dr. Patel - annual checkup")  │
│ allowed_metrics TEXT[] NOT NULL                            │
│                 (e.g., {"sleep_score","hrv","rhr"})       │
│ data_start      DATE NOT NULL                             │
│                 (viewer can see data FROM this date)      │
│ data_end        DATE NOT NULL                             │
│                 (viewer can see data THROUGH this date)   │
│ grant_expires   TIMESTAMPTZ NOT NULL                      │
│                 (when the link stops working entirely)    │
│ revoked_at      TIMESTAMPTZ                               │
│                 (NULL = active, set = revoked)            │
│ created_at      TIMESTAMPTZ NOT NULL DEFAULT now()        │
│ updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()        │
│ view_count      INTEGER NOT NULL DEFAULT 0                │
│ last_viewed_at  TIMESTAMPTZ                               │
│                                                          │
│ INDEXES:                                                 │
│   - UNIQUE(token)                                        │
│   - (owner_id, created_at DESC) for listing user's shares│
│   - (token) WHERE revoked_at IS NULL                     │
│     AND grant_expires > now()  -- partial index for fast │
│     active grant lookups                                 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                      audit_events                         │
├──────────────────────────────────────────────────────────┤
│ id              BIGSERIAL PRIMARY KEY                     │
│ owner_id        VARCHAR(64) NOT NULL                      │
│                 (whose data was accessed)                 │
│ actor_type      VARCHAR(16) NOT NULL                      │
│                 ("owner" | "viewer" | "system")           │
│ actor_id        VARCHAR(64)                               │
│                 (Clerk user ID if owner, NULL if viewer)  │
│ grant_id        UUID                                      │
│                 (FK to share_grants if actor is viewer)   │
│ event_type      VARCHAR(64) NOT NULL                      │
│                 (e.g., "data.viewed", "share.created",   │
│                  "share.revoked", "data.exported",        │
│                  "data.imported", "settings.changed")     │
│ resource_type   VARCHAR(64)                               │
│                 (e.g., "health_data", "share_grant")     │
│ resource_detail JSONB                                     │
│                 (e.g., {"metrics":["sleep_score","hrv"],  │
│                  "date_range":["2025-01-01","2025-12-31"],│
│                  "chart_types":["line","overlay"]})       │
│ ip_address      INET                                      │
│ user_agent      TEXT                                       │
│ session_id      VARCHAR(128)                               │
│                 (viewer cookie session or Clerk session)  │
│ created_at      TIMESTAMPTZ NOT NULL DEFAULT now()        │
│                                                          │
│ INDEXES:                                                 │
│   - (owner_id, created_at DESC) for owner viewing log    │
│   - (grant_id, created_at DESC) for per-share log view   │
│                                                          │
│ CONSTRAINTS:                                             │
│   - No UPDATE or DELETE triggers/policies (immutable)    │
│   - REVOKE UPDATE, DELETE ON audit_events                │
│     FROM app_user; (database-level immutability)         │
└──────────────────────────────────────────────────────────┘
```

### Metric Types (Enumeration)

The allowed metric identifiers (available across providers — not all providers supply every metric):

```
sleep_score, sleep_duration, sleep_efficiency, sleep_latency,
deep_sleep, rem_sleep, light_sleep, awake_time,
hrv, rhr, respiratory_rate, body_temperature_deviation,
readiness_score, activity_score, steps, active_calories,
total_calories, spo2
```

This list is stored as application configuration, not in a database table, because it changes only when new integrations are added. The `allowed_metrics` column in `share_grants` stores a subset of these identifiers as a PostgreSQL text array.

### Permission Checking Logic (Pseudocode)

```
function enforcePermissions(ctx: RequestContext, request: DataRequest):

  IF ctx.role == "owner":
    // Owner can access all their own data, no restrictions
    IF request.userId != ctx.userId:
      REJECT "Cannot access another user's data"
    RETURN request  // pass through unchanged

  IF ctx.role == "viewer":
    grant = ctx.grant  // populated from JWT or DB lookup

    // 1. Check grant is still active
    IF grant.revoked_at IS NOT NULL:
      REJECT "This share link has been revoked"
    IF grant.grant_expires < now():
      REJECT "This share link has expired"

    // 2. Filter metrics to only allowed ones
    requestedMetrics = request.metrics
    allowedMetrics = intersection(requestedMetrics, grant.allowed_metrics)
    IF allowedMetrics is empty:
      REJECT "No permitted metrics in this request"

    // 3. Clamp date range to grant boundaries
    effectiveStart = max(request.startDate, grant.data_start)
    effectiveEnd   = min(request.endDate, grant.data_end)
    IF effectiveStart > effectiveEnd:
      REJECT "Requested date range is outside the permitted window"

    // 4. Return narrowed request
    RETURN {
      userId: grant.owner_id,
      metrics: allowedMetrics,
      startDate: effectiveStart,
      endDate: effectiveEnd
    }
```

**Key design decisions:**

1. **The API narrows, not rejects, when possible.** If a viewer requests sleep_score + glucose but only sleep_score is granted, the API returns sleep_score data (not an error). This prevents information leakage about what metrics exist. The frontend already knows the allowed metrics and will not request unauthorized ones, but the API is defensive.

2. **Date range clamping.** Same principle. The API clamps to the grant boundaries rather than rejecting, unless the entire range is outside the window.

3. **Grant data is in the viewer JWT.** The short-lived viewer session cookie contains the full grant scope (metrics array, date boundaries). This means permission checks on API calls do NOT require a database hit. The grant is re-validated against the database only when the session cookie is issued or refreshed.

### Frontend: "What Can This Viewer See?"

When the `/v/[token]` page loads:

1. The page component (Server Component) reads the request context.
2. For a viewer, the context includes `permissions: { metrics: [...], dataStart, dataEnd }`.
3. This is passed to the client-side `ViewContextProvider`.
4. Components like `MetricSelector` read `permissions.metrics` to determine which chips/tabs to render.
5. `DateRangeSelector` reads `permissions.dataStart` and `permissions.dataEnd` to set the min/max bounds.
6. The initial data fetch uses the granted scope automatically.

For an owner, `permissions` is `{ metrics: ALL, dataStart: null, dataEnd: null }` (unrestricted), and the same components simply show everything.

---

## 5. AWS IAM Evaluation

### The Question

Could AWS IAM / STS / temporary credentials be used to model viewer permissions, e.g., issuing a temporary IAM role for each share link that restricts access to specific data?

### Honest Assessment: It Does Not Fit

**What IAM/STS Would Look Like:**

The idea would be: when a viewer opens a share link, the backend calls `sts:AssumeRole` to issue temporary AWS credentials scoped to that viewer's permitted data. The viewer's browser would use those credentials to call AWS services (e.g., S3, DynamoDB) directly, and IAM policies would enforce the restrictions.

**Why It Does Not Work for Totus:**

1. **Data granularity mismatch.** IAM policies operate at the resource level (S3 bucket/key prefix, DynamoDB table/item). Totus's permissions are at the _logical_ level: "sleep_score from Jan-March 2025." Unless every metric for every user for every day is stored as a separate S3 object (which would be absurd), IAM cannot express "allow reading rows where metric_type IN ('sleep_score', 'hrv') AND date BETWEEN '2025-01-01' AND '2025-03-31'." IAM is not a query-level access control system.

2. **PostgreSQL does not use IAM for row-level access.** The data lives in PostgreSQL. Even with RDS IAM authentication (which lets you authenticate to RDS with IAM tokens), once connected, you are a PostgreSQL user and all query-level access control must be done via PostgreSQL's Row-Level Security (RLS) or application logic. IAM gets you through the door but does not restrict what you see inside.

3. **Credentials in the browser are dangerous.** Issuing AWS credentials to the viewer's browser means those credentials could be extracted and used to call AWS APIs directly. Even with tight scoping, this is an unnecessary attack surface. AWS credentials should never leave the backend.

4. **Policy management at scale is impractical.** Each share grant has unique scope (different metrics, different dates). You would need a unique IAM policy per grant. IAM has hard limits (e.g., 10 custom policies per role, 6,144 characters per policy). Managing hundreds of dynamic IAM policies for share grants would be operationally nightmarish.

5. **Latency.** `sts:AssumeRole` calls take 50-200ms. On every share link open, you would add this latency, plus the complexity of passing credentials to the client.

6. **Overengineering for MVP.** Even if it could work, the engineering effort to make IAM express application-level permissions would be 10x the effort of application-level ABAC (Attribute-Based Access Control), which is what the permission model in Section 4 already provides.

**Where IAM DOES Fit in Totus (Correctly):**

- **Backend service authentication:** The Next.js API routes (running on Vercel as serverless functions) use IAM roles to access AWS services (RDS, KMS, SQS). This is standard and correct.
- **KMS key policies:** CMK pool keys use IAM policies to restrict which service roles can encrypt/decrypt. This is correct usage.
- **Infrastructure access control:** Developers/CI pipelines use IAM to manage infrastructure. Standard.

**Bottom line:** AWS IAM is the right tool for controlling which _services_ can access which _AWS resources_. It is the wrong tool for controlling which _viewers_ can see which _application data_. Application-level ABAC (the `share_grants` model in Section 4) is the correct pattern here. It is simpler, more expressive, and vastly easier to operate.

---

## 6. Unified Audit Architecture

### Design Philosophy

The audit log is not a feature bolted onto the side. It is a first-class part of the request lifecycle. Every request that reads or mutates health data passes through an audit emission point. The elegance comes from making audit logging a natural consequence of the permission enforcement path, not a separate concern.

### Where Audit Logging Happens

```
Request Lifecycle with Audit
============================

  ┌─────────┐
  │ Request │
  └────┬────┘
       │
  ┌────▼─────────────────────┐
  │ 1. Auth Middleware        │  Identifies actor (owner or viewer)
  └────┬─────────────────────┘
       │
  ┌────▼─────────────────────┐
  │ 2. Permission Enforcement │  Determines what is allowed
  │    enforcePermissions()   │  Returns: effectiveScope
  └────┬─────────────────────┘
       │
  ┌────▼─────────────────────┐
  │ 3. Data Fetch             │  Queries only permitted data
  │    (scoped by permissions)│
  └────┬─────────────────────┘
       │
  ┌────▼─────────────────────┐
  │ 4. Audit Emission         │  AFTER data is successfully fetched,
  │    emitAuditEvent()       │  BEFORE response is sent.
  │                           │  Non-blocking (fire-and-forget to
  │                           │  a queue or async insert).
  └────┬─────────────────────┘
       │
  ┌────▼─────────────────────┐
  │ 5. Response               │  Return data to client
  └──────────────────────────┘
```

**Why after data fetch, before response?** Because we only want to log successful data access, not failed requests (those go to error/security logs, not the user-facing audit log). And we emit before the response so that even if the network drops, the audit record exists.

**Why non-blocking?** The audit insert should not add latency to the data response. For MVP, this can be a simple `INSERT ... RETURNING` fired without awaiting the result (using a fire-and-forget pattern in Node.js). For production scale, this would be pushed to an SQS queue processed by a background worker.

### What Gets Captured

```
┌─────────────────────────────────────────────────────┐
│                 Audit Event Fields                   │
├─────────────────┬───────────────────────────────────┤
│ Field           │ Example                           │
├─────────────────┼───────────────────────────────────┤
│ owner_id        │ "user_2xABC..."                   │
│ actor_type      │ "viewer"                          │
│ actor_id        │ NULL (viewer has no account)       │
│ grant_id        │ "a1b2c3d4-..."                    │
│ event_type      │ "data.viewed"                     │
│ resource_type   │ "health_data"                     │
│ resource_detail │ {                                 │
│                 │   "metrics": ["sleep_score","hrv"],│
│                 │   "date_range": {                 │
│                 │     "start": "2025-01-01",        │
│                 │     "end": "2025-03-31"           │
│                 │   },                              │
│                 │   "chart_type": "line",           │
│                 │   "data_points_returned": 180     │
│                 │ }                                 │
│ ip_address      │ "73.162.44.12"                    │
│ user_agent      │ "Mozilla/5.0 (Macintosh...)"     │
│ session_id      │ "vs_abc123..." (viewer session)   │
│ created_at      │ "2026-03-08T14:23:01.000Z"       │
└─────────────────┴───────────────────────────────────┘
```

### Event Types Taxonomy

```
data.viewed         - Health data was accessed (owner or viewer)
data.imported       - Data ingested from Oura, CSV, etc.
data.exported       - Data exported by owner
data.deleted        - Data deleted by owner
share.created       - New share grant created
share.revoked       - Share grant revoked
share.expired       - Share grant auto-expired (system event)
share.viewed        - Share link initially opened (distinct from
                      data.viewed which logs each data fetch)
account.login       - Owner logged in
account.2fa_enabled - Owner enabled 2FA
account.settings    - Account settings changed
```

### How the Owner Views the Audit Log

The `/dashboard/audit` page provides:

```
┌─────────────────────────────────────────────────────────┐
│                     Audit Log                           │
│                                                         │
│  Filter: [All events ▼] [All shares ▼] [Last 30 days ▼]│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Mar 8, 2:23 PM                                     ││
│  │ VIEWER via "For Dr. Patel" share link              ││
│  │ Viewed: sleep_score, hrv (Jan 1 - Mar 31, 2025)   ││
│  │ IP: 73.162.44.12 · Chrome on macOS                 ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Mar 8, 2:20 PM                                     ││
│  │ VIEWER via "For Dr. Patel" share link              ││
│  │ Opened share link (first view of session)          ││
│  │ IP: 73.162.44.12 · Chrome on macOS                 ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Mar 8, 10:15 AM                                    ││
│  │ YOU                                                ││
│  │ Created share: "For Dr. Patel"                     ││
│  │ Metrics: sleep_score, hrv · Range: Jan-Mar 2025    ││
│  │ Expires: Apr 7, 2026                               ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Mar 7, 8:00 AM                                     ││
│  │ SYSTEM                                             ││
│  │ Imported 24 data points from Oura Ring             ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Immutability Enforcement

At the database level:

1. The application database user is granted `INSERT` and `SELECT` on `audit_events`, but NOT `UPDATE` or `DELETE`. This is enforced via PostgreSQL `GRANT` statements.
2. Optionally, a `BEFORE UPDATE OR DELETE` trigger on `audit_events` that raises an exception, as a defense-in-depth measure.
3. The audit log API (`/api/audit`) only exposes `GET` endpoints. There is no mutation endpoint.

### Elegance of the Unified Auth + Audit Model

The middleware produces a `RequestContext` that flows through the entire request. This context contains the actor identity (from auth) and their permissions (from the grant or from ownership). The data layer uses the permissions to scope queries. The audit layer reads the same context to know who did what. There is no separate "audit hook" or "logging decorator" to remember to add to each route. The audit emission is built into the shared data access function:

```
                    RequestContext
                   (from middleware)
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
        Auth info    Permissions   Request meta
        (who)        (what's       (IP, UA,
                      allowed)     session)
            │            │            │
            └────────────┼────────────┘
                         │
              ┌──────────▼──────────┐
              │  fetchHealthData()  │
              │  - enforces perms   │
              │  - fetches data     │
              │  - emits audit      │  <-- All three in one function
              │  - returns data     │
              └─────────────────────┘
```

Every path through the system that accesses health data goes through `fetchHealthData()` (or similar scoped data access functions). This function always enforces permissions and always emits an audit event. You cannot accidentally access data without auditing, because the function that fetches data IS the function that audits.

---

## 7. System Architecture Overview

### High-Level Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER                               │
│                                                              │
│  Owner (authenticated via Clerk)                             │
│    └── /dashboard, /dashboard/share, /dashboard/audit        │
│                                                              │
│  Viewer (authenticated via share token)                      │
│    └── /v/[token]                                            │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    VERCEL EDGE                                │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              Next.js Middleware                      │     │
│  │  - Clerk auth (owner sessions)                      │     │
│  │  - Viewer token validation (share sessions)         │     │
│  │  - Produces unified RequestContext                   │     │
│  │  - Route protection (owner-only routes)             │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────┐     │
│  │  Server Components   │  │   API Routes             │     │
│  │  - Dashboard pages   │  │   /api/health-data       │     │
│  │  - Share management  │  │   /api/shares            │     │
│  │  - Audit log viewer  │  │   /api/audit             │     │
│  │  - Viewer pages      │  │   /api/connections/*/callback │     │
│  └──────────┬───────────┘  └──────────┬───────────────┘     │
│             │                         │                      │
│             └────────────┬────────────┘                      │
│                          │                                   │
│  ┌───────────────────────▼─────────────────────────────┐     │
│  │              Service Layer                          │     │
│  │  - HealthDataService (fetch, import, export)        │     │
│  │  - ProviderAdapters (Oura, Dexcom, Garmin, ...)    │     │
│  │  - ShareService (create, revoke, validate)          │     │
│  │  - AuditService (emit, query)                       │     │
│  │  - EncryptionService (KMS envelope encryption)      │     │
│  └───────────────────────┬─────────────────────────────┘     │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │
              ┌────────────┼─────────────────────┐
              │            │            │         │
              ▼            ▼            ▼         ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  PostgreSQL  │  │   AWS KMS    │  │  Provider APIs   │  │    Inngest       │
│  (AWS RDS    │  │              │  │  (External)      │  │  (Job Pipeline)  │
│   Aurora     │  │  Per-user    │  │                  │  │                  │
│   Serverless)│  │  encryption  │  │  Oura, Dexcom,   │  │  Sync sweep,     │
│              │  │  keys        │  │  Garmin, Whoop,  │  │  token refresh,  │
│  Tables:     │  │              │  │  Withings        │  │  initial backfill│
│  - users     │  └──────────────┘  └──────────────────┘  └──────────────────┘
│  - health_   │
│    data_daily│
│  - health_   │
│    data_     │
│    series    │
│  - health_   │
│    data_     │
│    periods   │
│  - provider_ │
│    connections│
│  - metric_   │
│    source_   │
│    prefs     │
│  - share_    │
│    grants    │
│  - audit_    │
│    events    │
└──────────────┘
```

### Database Schema Overview (Complete)

> **NOTE:** `oura_connections` is superseded by `provider_connections` and `health_data` is renamed to `health_data_daily`. See `docs/integrations-pipeline-lld.md` §3 for the updated schema.

```
┌─────────────────────┐       ┌──────────────────────────────┐
│       users          │       │     provider_connections      │
├─────────────────────┤       ├──────────────────────────────┤
│ id (Clerk user ID)  │──┐    │ id UUID PK                   │
│ display_name        │  │    │ user_id FK ───────────────┐  │
│ kms_key_arn         │  │    │ provider VARCHAR(32)      │  │
│ created_at          │  │    │ auth_enc BYTEA (enc blob) │  │
│ updated_at          │  │    │ token_expires_at          │  │
└─────────────────────┘  │    │ status VARCHAR(16)        │  │
                         │    │ last_sync_at              │  │
     ┌───────────────────┘    │ daily_cursor              │  │
     │                        └──────────────────────────────┘
     │
     │    ┌─────────────────────────┐
     │    │   health_data_daily      │
     │    │   (renamed from          │
     │    │    health_data)          │
     │    ├─────────────────────────┤
     ├───>│ id BIGSERIAL PK         │
     │    │ user_id FK              │
     │    │ metric_type VARCHAR(64) │
     │    │ date DATE               │
     │    │ value_encrypted BYTEA   │
     │    │ source VARCHAR(32)      │
     │    │ source_id VARCHAR(128)  │
     │    │ imported_at TIMESTAMPTZ │
     │    │                         │
     │    │ UNIQUE(user_id,         │
     │    │   metric_type, date,    │
     │    │   source)               │
     │    └─────────────────────────┘
     │
     │    ┌─────────────────────────┐
     │    │   health_data_series    │
     │    │   (new — intraday)     │
     │    ├─────────────────────────┤
     ├───>│ id BIGSERIAL PK         │
     │    │ user_id FK              │
     │    │ metric_type VARCHAR(64) │
     │    │ recorded_at TIMESTAMPTZ │
     │    │ value_encrypted BYTEA   │
     │    │ source VARCHAR(32)      │
     │    │ PARTITIONED BY RANGE    │
     │    │   (recorded_at)         │
     │    └─────────────────────────┘
     │
     │    ┌─────────────────────────┐
     │    │   health_data_periods   │
     │    │   (new — events)       │
     │    ├─────────────────────────┤
     ├───>│ id BIGSERIAL PK         │
     │    │ user_id FK              │
     │    │ event_type VARCHAR(64)  │
     │    │ subtype VARCHAR(64)     │
     │    │ started_at TIMESTAMPTZ  │
     │    │ ended_at TIMESTAMPTZ    │
     │    │ metadata_enc BYTEA      │
     │    │ source VARCHAR(32)      │
     │    └─────────────────────────┘
     │
     │    ┌─────────────────────────┐
     │    │ metric_source_preferences│
     │    ├─────────────────────────┤
     ├───>│ user_id FK (PK)         │
     │    │ metric_type VARCHAR(64) │
     │    │   (PK)                  │
     │    │ provider VARCHAR(32)    │
     │    └─────────────────────────┘
     │
     │    ┌─────────────────────────┐
     ├───>│     share_grants        │
     │    │  (detailed in Sec 4)    │
     │    └─────────────────────────┘
     │
     │    ┌─────────────────────────┐
     └───>│     audit_events        │
          │  (detailed in Sec 6)    │
          └─────────────────────────┘
```

### Inngest Job Pipeline

The integrations data pipeline uses Inngest for durable async job orchestration. See `docs/integrations-pipeline-lld.md` §7 for full job definitions. Summary:

| Job                            | Schedule       | Purpose                                                     |
| ------------------------------ | -------------- | ----------------------------------------------------------- |
| `integration/sync.sweep`       | Cron: every 6h | Fan out per-connection sync jobs for all active connections |
| `integration/sync.connection`  | Event-driven   | Fetch daily, series, and period data for one connection     |
| `integration/sync.initial`     | Event-driven   | Historical backfill after first OAuth connection            |
| `integration/token.refresh`    | Cron: every 1h | Proactively refresh tokens expiring within 24h              |
| `integration/sync.manual`      | Event-driven   | User-triggered sync (higher priority)                       |
| `integration/partition.ensure` | Cron: monthly  | Pre-create `health_data_series` partitions                  |

### Data Encryption Strategy

Since per-user encryption is a PRD requirement:

1. A pool of 10 KMS Customer Master Keys (CMKs) is shared across all users. Each user is assigned to one CMK via `hash(user_id) % 10`, stored as `kms_key_arn` in the `users` table.
2. Health data values are encrypted using **envelope encryption**: the application generates a Data Encryption Key (DEK) via `kms:GenerateDataKey`, encrypts the data with the DEK locally, and stores the encrypted DEK alongside the ciphertext. This avoids calling KMS on every read/write (DEKs can be cached in memory for a short TTL).
3. The `value_encrypted` column in `health_data_daily` (and `health_data_series`, `health_data_periods`) stores the encrypted payload (DEK-encrypted value + KMS-encrypted DEK).
4. On read, the application calls `kms:Decrypt` to unwrap the DEK (or uses a cached DEK), then decrypts locally.
5. Provider OAuth tokens are similarly encrypted with the user's DEK before storage (as `auth_enc` in `provider_connections`).

---

## 8. Cross-Cutting Concerns

### Security

- **Transport**: HTTPS everywhere (Vercel default). HSTS headers.
- **Authentication**: Clerk for owners (session cookies, httpOnly, secure). Custom signed JWT for viewers (short-lived, httpOnly, secure).
- **Authorization**: Application-level ABAC via `enforcePermissions()`. No direct database access from the client.
- **Token generation**: Share tokens are 32-byte cryptographically random values, base64url-encoded (43 characters). Collision probability is negligible. Tokens are NOT sequential or guessable.
- **Rate limiting**: Vercel Edge middleware rate-limits share link validation (e.g., 10 attempts per IP per minute) to prevent token brute-forcing. Even at 10/min, brute-forcing a 256-bit token space is infeasible, but rate limiting prevents noisy scanning.
- **CSRF**: Clerk handles CSRF for owner sessions. Viewer sessions are read-only (no mutations) so CSRF is not applicable.
- **Input validation**: All API inputs validated with Zod schemas. Metric types validated against the known enum. Dates validated. No raw SQL (use Drizzle ORM with parameterized queries).

### Observability

- **Structured logging**: All log entries are JSON with correlation IDs. Use Vercel's built-in logging or Axiom integration.
- **Error tracking**: Sentry integration for unhandled exceptions.
- **Performance**: Vercel Analytics for Web Vitals. Track dashboard load time (NFR-1: under 2 seconds).
- **Audit log**: The user-facing audit log doubles as an observability tool for data access patterns.

### Error Handling

- **API routes**: Return consistent error shapes `{ error: { code, message, details? } }` with appropriate HTTP status codes.
- **Share link errors**: Expired, revoked, and invalid tokens all show user-friendly pages (not raw errors). Do NOT distinguish between "invalid token" and "revoked" to external viewers (information leakage). Show a generic "This link is no longer available" with different internal logging.
- **Provider sync failures**: Log and retry with exponential backoff. Show sync status on dashboard.

### Configuration Management

- **Environment variables** via Vercel project settings:
  - `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `DATABASE_URL` (RDS connection string)
  - `KMS_KEY_REGION`
  - `<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET` (per provider: Oura, Dexcom, Garmin, etc.)
  - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
  - `VIEWER_JWT_SECRET` (for signing viewer session cookies)
- **Feature flags**: Not needed for MVP. If desired later, use Vercel Edge Config or LaunchDarkly.

---

## 9. Implementation Roadmap

### Phase 1: Foundation

| Task                                           | Deliverable                                           | Dependencies      |
| ---------------------------------------------- | ----------------------------------------------------- | ----------------- |
| Initialize Next.js 14+ project with App Router | Repo, tsconfig, ESLint, Prettier                      | None              |
| Integrate Clerk                                | Sign-up, sign-in, 2FA enrollment, session management  | Next.js project   |
| Set up PostgreSQL (Aurora Serverless v2)       | Database instance, connection from Vercel             | AWS account       |
| Choose and configure ORM (Drizzle recommended) | Schema definitions, migration tooling                 | Database          |
| Create database schema                         | users, health_data, share_grants, audit_events tables | ORM setup         |
| Set up KMS                                     | Per-user key creation, envelope encryption utility    | AWS account       |
| Implement unified middleware                   | RequestContext for owner and viewer paths             | Clerk integration |
| Deploy skeleton to Vercel                      | Working deployment pipeline                           | All above         |

### Phase 2: Core Data Pipeline

| Task                | Deliverable                                                 | Dependencies                       |
| ------------------- | ----------------------------------------------------------- | ---------------------------------- |
| Provider OAuth flow | Connect provider accounts via multi-provider OAuth pipeline | Clerk auth, KMS                    |
| Provider data sync  | Inngest-driven sync, fetch + encrypt + store                | Provider OAuth, health_data schema |
| CSV upload          | Parse, validate, encrypt, store                             | health_data schema, KMS            |
| Health data API     | GET /api/health-data with metric/date filtering             | Middleware, enforcePermissions     |
| Dashboard UI        | Interactive charts, metric selector, date range             | Health data API                    |

### Phase 3: Sharing and Permissions

| Task                          | Deliverable                                               | Dependencies              |
| ----------------------------- | --------------------------------------------------------- | ------------------------- |
| Share creation wizard         | UI: pick metrics, date range, expiration, note            | Dashboard UI              |
| Share grant API               | POST /api/shares, GET /api/shares, DELETE /api/shares/:id | share_grants schema       |
| Token generation + validation | Crypto-random tokens, validation logic                    | share_grants schema       |
| Viewer session mechanism      | JWT cookie issuance, middleware integration               | Middleware                |
| Viewer dashboard rendering    | Same dashboard, read-only mode, permission-driven         | Dashboard UI, ViewContext |
| Share management page         | List active shares, revoke, view stats                    | Share grant API           |

### Phase 4: Audit Log

| Task                                | Deliverable                              | Dependencies        |
| ----------------------------------- | ---------------------------------------- | ------------------- |
| Audit emission in data access layer | emitAuditEvent() in fetchHealthData()    | audit_events schema |
| Audit events for share lifecycle    | Log create, revoke, expire, view events  | Share grant API     |
| Audit events for account actions    | Log login, 2FA changes, settings changes | Clerk webhooks      |
| Audit log viewer UI                 | Filterable, paginated log page           | Audit query API     |
| Audit query API                     | GET /api/audit with filters              | audit_events schema |

### Phase 5: Polish and Launch Prep

| Task                          | Deliverable                                             | Dependencies |
| ----------------------------- | ------------------------------------------------------- | ------------ |
| Error handling and edge cases | Friendly error pages, retry logic, loading states       | All features |
| Performance optimization      | Data aggregation for long ranges, caching, lazy loading | Dashboard UI |
| Security hardening            | Rate limiting, CSP headers, dependency audit            | All features |
| Observability                 | Sentry, structured logging, uptime monitoring           | All features |
| Landing page                  | Marketing page at / with sign-up CTA                    | None         |
| Documentation                 | OpenAPI spec, README, CLAUDE.md for the repo            | All features |

### Milestone Summary

```
Week 1-2: "I can sign up, see an empty dashboard"
Week 2-3: "I can connect a provider and see my data on charts"
Week 3-4: "I can share a link and my doctor sees clean charts"
Week 4-5: "Every view is logged and I can review who saw what"
Week 5-6: "It's polished, fast, and ready for real users"
```

---

## 10. Design Considerations and Decisions Requiring Founder Input

### Decisions That Need Input

1. **Clerk vs. Auth.js tradeoff.** Clerk costs $0.02/MAU after 10,000 users (irrelevant for MVP, but relevant at scale). Auth.js is free forever but requires building 2FA and all auth UI from scratch. **Recommendation is Clerk for MVP speed, with the option to migrate later if cost becomes an issue.** Does the founder agree, or is vendor independence a priority from day one?

2. **ORM choice: Drizzle vs. Prisma.** Drizzle is lighter, gives more control over SQL, and has better Edge Runtime support (important for Vercel). Prisma has a larger ecosystem and more mature migration tooling. For Totus's relatively simple schema, Drizzle is likely the better fit. Does the founder have a preference?

3. **Viewer session duration.** Proposed: 4 hours for the viewer cookie TTL. This means a doctor can browse for up to 4 hours without re-validating. Shorter (1 hour) is more secure but may annoy users who leave a tab open. Longer (24 hours) is more convenient but increases window of exposure if a link is shared beyond the intended recipient. What feels right?

4. **Audit log granularity for owners.** Should owner data views be logged at the same granularity as viewer views? For example, every time the owner changes the date range on their own dashboard, should that be a new audit event? Designed as yes (consistent treatment), but this will generate more audit entries. The owner audit view could filter to "viewer events only" by default.

5. **Share link URL format.** Options:
   - `totus.com/v/abc123def456` (clean, short)
   - `totus.com/share/abc123def456` (more descriptive)
   - `totus.com/v/abc123def456?ref=dr-patel` (includes human-readable hint, but leaks the note)

   Recommendation is the first option: clean and short, with no information leakage in the URL.

### Risks and Mitigations

| Risk                                                          | Impact                                | Likelihood | Mitigation                                                                             |
| ------------------------------------------------------------- | ------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Provider API rate limits during initial sync of years of data | Slow onboarding                       | Medium     | Paginate sync, respect rate limits, show progress via Inngest job pipeline             |
| Viewer JWT secret compromise                                  | All active share links compromised    | Low        | Rotate secret with zero-downtime (support two active secrets during rotation)          |
| PostgreSQL audit table grows large over time                  | Slow queries on audit log             | Low (MVP)  | Partition by created_at month; at scale, move to append-only store (S3 + Athena)       |
| Clerk outage blocks all owner logins                          | Complete owner lockout                | Low        | Clerk has 99.99% SLA; accept this risk for MVP; could add fallback later               |
| Vercel cold starts affect dashboard load time                 | Fails 2-second NFR                    | Medium     | Use Vercel's `maxDuration` config, keep functions warm with cron, optimize bundle size |
| Envelope encryption cache invalidation                        | Stale DEK used after KMS key rotation | Low        | Set DEK cache TTL to 5 minutes; re-derive on cache miss                                |

### Technical Debt to Accept for MVP

1. **Background job system.** Provider sync and token refresh are handled by Inngest (see Inngest Job Pipeline section above). Audit log writes use fire-and-forget database inserts.
2. **No data aggregation layer.** For 5 years of daily data (~1,825 rows per metric), raw queries are fine. If sub-daily data arrives (via Health Connect with minute-level HRV), a pre-aggregation strategy will be needed.
3. **Single-region deployment.** Vercel serves from the Edge, but the database is in one AWS region. Acceptable for MVP with a US-based user base.
4. **No backup/disaster recovery plan.** Aurora has automated backups, but a documented recovery procedure should be created before launch.
