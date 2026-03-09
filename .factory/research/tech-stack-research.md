# Tech Stack Research: Clerk Mock, Drizzle ORM, JWT Sessions, API Testing

> Generated: 2026-03-09
> Sources: Clerk docs, Drizzle ORM docs, StackOverflow, dev.to, Arcjet blog, HashBuilds, and others.

---

## A) Clerk Mocking Strategy

### Overview

Clerk does **not** provide an official "mock mode" for local development. The recommended approaches are:

1. **Mock `@clerk/nextjs` exports in tests** (integration tests)
2. **Use `@clerk/testing` + Playwright** for E2E tests with real Clerk credentials
3. **Build a custom mock auth layer** that mimics Clerk's interface for fully offline local dev

### Pattern 1: Jest/Vitest Mock of `@clerk/nextjs` (from Clerk's official blog)

This is the officially recommended pattern for **integration tests**:

```typescript
// __tests__/setup.ts or test file
import { render } from '@testing-library/react'
import { ClerkProvider, useAuth } from '@clerk/nextjs'
import { ReactNode } from 'react'

// Mock the entire @clerk/nextjs module
jest.mock('@clerk/nextjs', () => {
  const originalModule = jest.requireActual('@clerk/nextjs')
  return {
    ...originalModule,
    useAuth: jest.fn(() => ({ userId: null })),
    SignIn: () => <div data-testid="clerk-sign-in">Sign In Component</div>,
    ClerkProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

// Helper to render with auth state
const TestProviders = ({
  isLoggedIn = false,
  children,
}: {
  isLoggedIn?: boolean
  children: ReactNode
}) => {
  ;(useAuth as jest.Mock).mockReturnValue({
    userId: isLoggedIn ? 'user-id' : null,
  })
  return <ClerkProvider>{children}</ClerkProvider>
}

const renderWithProviders = (ui: ReactNode, isLoggedIn?: boolean) => {
  return render(<TestProviders isLoggedIn={isLoggedIn}>{ui}</TestProviders>)
}
```

**Source**: [Clerk Blog - A practical guide to testing Clerk Next.js applications](https://clerk.com/blog/testing-clerk-nextjs) (Apr 2025)

### Pattern 2: Custom Mock Auth Layer for Local Dev (No Real Clerk)

For a project that needs to run **without any Clerk credentials** in local/dev mode, you'd create a mock layer:

```typescript
// lib/auth/mock-auth.ts
import { SignJWT, jwtVerify } from "jose";

const MOCK_SECRET = new TextEncoder().encode(
  "dev-secret-key-min-32-chars-long!!",
);

export interface MockUser {
  userId: string;
  email: string;
  role: string;
}

// Mock clerkMiddleware equivalent
export async function mockAuthMiddleware(request: NextRequest) {
  const token = request.cookies.get("__session")?.value;

  if (!token) {
    // Unauthenticated request
    return { userId: null };
  }

  try {
    const { payload } = await jwtVerify(token, MOCK_SECRET);
    return { userId: payload.sub as string, role: payload.role };
  } catch {
    return { userId: null };
  }
}

// Mock auth() function (like Clerk's auth())
export async function auth(): Promise<{ userId: string | null }> {
  const cookieStore = await cookies();
  const token = cookieStore.get("__session")?.value;
  if (!token) return { userId: null };

  try {
    const { payload } = await jwtVerify(token, MOCK_SECRET);
    return { userId: payload.sub as string };
  } catch {
    return { userId: null };
  }
}

// Mock sign-in (create session)
export async function createMockSession(user: MockUser): Promise<string> {
  return new SignJWT({ sub: user.userId, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(MOCK_SECRET);
}
```

**Key principle**: Create interfaces that match Clerk's API surface (`auth()`, `useAuth()`, `clerkMiddleware`) but backed by local JWT logic using `jose`.

### Pattern 3: E2E Tests with `@clerk/testing` (requires real Clerk credentials)

```typescript
// e2e/global.setup.ts
import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

setup("global setup", async ({}) => {
  await clerkSetup();
});

// e2e/auth-flow.spec.ts
import { clerk } from "@clerk/testing/playwright";

test("authenticated flow", async ({ page }) => {
  await page.goto("/sign-in");
  await clerk.signIn({
    page,
    signInParams: {
      strategy: "password",
      identifier: process.env.E2E_CLERK_USER_USERNAME,
      password: process.env.E2E_CLERK_USER_PASS,
    },
  });
  // ... test authenticated pages
});
```

### Recommendation for Totus

For **fully offline local development**, build a mock auth layer (Pattern 2) that can be swapped in via an environment variable:

```typescript
// lib/auth/index.ts
const useMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true";

export const auth = useMockAuth ? mockAuth : clerkAuth;
export const authMiddleware = useMockAuth
  ? mockAuthMiddleware
  : clerkMiddleware;
```

---

## B) Drizzle Custom Types

### BYTEA (Binary Data)

**Good news**: As of recent Drizzle ORM versions, `bytea` is now a **built-in native type**:

```typescript
import { bytea, pgTable, serial } from "drizzle-orm/pg-core";

export const files = pgTable("files", {
  id: serial("id").primaryKey(),
  data: bytea("data").notNull(),
});
```

**Source**: [Drizzle ORM PostgreSQL column types docs](https://orm.drizzle.team/docs/column-types/pg) — confirms native `bytea` support.

If you need custom Buffer ↔ hex mapping (e.g., for older versions or custom behavior):

```typescript
import { customType } from "drizzle-orm/pg-core";

const customBytea = customType<{
  data: Buffer;
  notNull: false;
  default: false;
}>({
  dataType() {
    return "bytea";
  },
});

// Or with hex string conversion:
const byteaHex = customType<{ data: string; driverData: string }>({
  dataType() {
    return "bytea";
  },
  toDriver(val: string): Buffer {
    let hex = val;
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Buffer.from(hex, "hex");
  },
  fromDriver(val: any): string {
    if (Buffer.isBuffer(val)) return val.toString("hex");
    // PostgreSQL may return hex format like '\x...'
    if (typeof val === "string" && val.startsWith("\\x")) {
      return val.slice(2);
    }
    return String(val);
  },
});
```

**Source**: [StackOverflow](https://stackoverflow.com/questions/76399047), [Drizzle ORM custom types docs](https://orm.drizzle.team/docs/custom-types)

### INET (IP Addresses)

`inet` is also a **built-in native type** in Drizzle ORM (via `PgInet` class):

```typescript
import { inet, pgTable, serial } from "drizzle-orm/pg-core";

export const accessLogs = pgTable("access_logs", {
  id: serial("id").primaryKey(),
  ipAddress: inet("ip_address").notNull(),
});
```

The `inet` type stores IP addresses as strings in TypeScript. If it's not exported from your version:

```typescript
import { customType } from "drizzle-orm/pg-core";

const inet = customType<{ data: string }>({
  dataType() {
    return "inet";
  },
});
```

**Source**: [PgInet class docs](https://repos.supermodeltools.com/drizzle-orm/class-inet-ts-pginet.html), [Drizzle ORM GitHub source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/columns/inet.ts)

### TEXT[] (Text Array)

Text arrays are supported using the `.array()` method:

```typescript
import { text, pgTable, serial } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  paragraphs: text("paragraphs").array(),
});
```

**Important**: For default empty arrays, use SQL syntax:

```typescript
// Correct:
tags: text('tags').array().default(sql`'{}'::text[]`),
// or:
tags: text('tags').array().default(sql`ARRAY[]::text[]`),

// WRONG (won't work in migration):
tags: text('tags').array().default([]),
```

**Working with arrays** (append, prepend):

```typescript
import { sql, eq } from "drizzle-orm";

// Append to array
await db
  .update(articles)
  .set({
    tags: sql`array_append(${articles.tags}, ${"new-tag"})`,
  })
  .where(eq(articles.id, id));

// Prepend to array
await db
  .update(articles)
  .set({
    tags: sql`array_prepend(${"first-tag"}, ${articles.tags})`,
  })
  .where(eq(articles.id, id));

// Search within array (ANY operator)
await db
  .select()
  .from(articles)
  .where(sql`${"search-tag"} = ANY(${articles.tags})`);
```

**Source**: [Drizzle ORM empty-array-default-value guide](https://orm.drizzle.team/docs/guides/empty-array-default-value), [Wanago.io NestJS/Drizzle arrays tutorial](https://wanago.io/2024/07/08/api-nestjs-postgresql-arrays-drizzle-orm/)

---

## C) JWT Viewer Sessions with `jose`

### Best Pattern: Sign and Verify JWTs in Next.js Middleware

The `jose` library is the **recommended choice** for JWT operations in Next.js Edge middleware because:

- It works in the **Edge Runtime** (unlike `jsonwebtoken` which requires Node.js APIs)
- It's lightweight and has no dependencies
- It uses the Web Crypto API

### Signing JWTs

```typescript
// lib/jwt.ts
import { SignJWT, jwtVerify, JWTPayload } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

export interface ViewerPayload extends JWTPayload {
  sub: string; // viewer ID
  role: string; // 'viewer', 'admin', etc.
  email?: string;
}

export async function signViewerToken(
  payload: Omit<ViewerPayload, "iat" | "exp">,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h") // or '7d' for longer sessions
    .setSubject(payload.sub)
    .sign(JWT_SECRET);
}
```

### Verifying JWTs

```typescript
export async function verifyViewerToken(
  token: string,
): Promise<ViewerPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as ViewerPayload;
  } catch (error) {
    // Token expired, invalid signature, etc.
    return null;
  }
}
```

### Using in Next.js Middleware

```typescript
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

const protectedRoutes = ["/dashboard", "/api/protected"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  );

  if (!isProtected) return NextResponse.next();

  // Get token from cookie or Authorization header
  const token =
    request.cookies.get("viewer-token")?.value ||
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // Pass user info downstream via headers
    const response = NextResponse.next();
    response.headers.set("x-viewer-id", payload.sub as string);
    response.headers.set("x-viewer-role", payload.role as string);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
```

### Setting the Token (Login API Route)

```typescript
// app/api/auth/login/route.ts
import { cookies } from "next/headers";
import { signViewerToken } from "@/lib/jwt";

export async function POST(request: Request) {
  // ... validate credentials ...

  const token = await signViewerToken({
    sub: user.id,
    role: user.role,
  });

  const cookieStore = await cookies();
  cookieStore.set("viewer-token", token, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return Response.json({ success: true });
}
```

**Sources**:

- [abdessamadely.com - JWT Authentication in Next.js with jose](https://abdessamadely.com/jwt-authentication-in-next-js-with-api-routes-and-jose)
- [HashBuilds - Next.js Middleware Authentication](https://www.hashbuilds.com/articles/next-js-middleware-authentication-protecting-routes-in-2025)

---

## D) API Route Testing with Vitest

### The Challenge

Next.js 15 App Router API routes are plain `export async function GET/POST()` functions that accept `Request` and return `Response`. Testing them is non-trivial because:

- Next.js patches globals and has extended types (`NextRequest`, `NextResponse`)
- There's no official testing guide for API routes (only components)
- `async` Server Components aren't supported in Vitest

### Approach 1: Direct Function Call (Simplest)

Since App Router route handlers are just functions, you can call them directly:

```typescript
// app/api/hello/route.ts
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return NextResponse.json({ hello: true }, { status: 200 });
}
```

```typescript
// app/api/hello/route.test.ts
import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/hello", () => {
  it("returns 200", async () => {
    const request = new Request("http://localhost:3000/api/hello");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ hello: true });
  });
});
```

### Approach 2: `next-test-api-route-handler` (Most Robust)

This is the **gold standard** package for testing Next.js API routes. Works with both Jest and Vitest:

```typescript
// app/api/hello/route.test.ts
import { testApiHandler } from "next-test-api-route-handler";
import * as appHandler from "./route";

it("GET returns 200", async () => {
  await testApiHandler({
    appHandler,
    test: async ({ fetch }) => {
      const response = await fetch({ method: "GET" });
      const json = await response.json();
      expect(response.status).toBe(200);
      expect(json).toStrictEqual({ hello: true });
    },
  });
});
```

### Approach 3: `node-mocks-http` with Vitest

```typescript
// @vitest-environment node
import { expect, test } from "vitest";
import { createRequest } from "node-mocks-http";
import { GET } from "app/api/users/route";

test("User endpoint works", async () => {
  const nextUrl = new URL("/api/users", "http://localhost:3000");
  const request = createRequest({ method: "GET", url: "/api/users" });
  const response = await GET({ ...request, nextUrl } as any);

  expect(response.status).toBe(200);
});
```

### Mocking Auth in API Route Tests

```typescript
// Mock your auth module
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "test-user-id" })),
}));

// Or mock Clerk
vi.mock("@clerk/nextjs", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "test-user-id" })),
}));

// Then test
import { GET } from "./route";

it("returns data for authenticated user", async () => {
  const request = new Request("http://localhost:3000/api/data");
  const response = await GET(request);
  expect(response.status).toBe(200);
});
```

### Vitest Configuration for Next.js 15

```typescript
// vitest.config.mts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom", // or 'node' for API routes
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
});
```

**Note**: You may want to run API route tests with `environment: 'node'` and component tests with `environment: 'jsdom'`. Use the inline comment `// @vitest-environment node` at the top of API test files, or configure project-level environment overrides in Vitest.

**Sources**:

- [Arcjet Blog - Testing Next.js app router API routes](https://blog.arcjet.com/testing-next-js-app-router-api-routes/)
- [StackOverflow - Testing routes with Vitest](https://stackoverflow.com/questions/78137788)
- [Next.js Docs - Testing with Vitest](https://nextjs.org/docs/pages/guides/testing/vitest)
- [next-test-api-route-handler](https://www.npmjs.com/package/next-test-api-route-handler)

---

## E) Known Gotchas

### Clerk + Mock Auth

1. **Clerk `auth()` is async in App Router** — The `auth()` function from `@clerk/nextjs/server` returns a promise in Next.js 15. Mock accordingly.
2. **`clerkMiddleware` vs `authMiddleware`** — Clerk deprecated `authMiddleware` in favor of `clerkMiddleware`. Use the newer API.
3. **Testing tokens** — Clerk has `@clerk/testing` which provides `setupClerkTestingToken()` to bypass bot detection in E2E tests. For unit/integration tests, mock the module entirely.

### Drizzle ORM

4. **`bytea` custom type bug (v0.38.x)** — There was a known bug in Drizzle v0.38.3 where custom `bytea` types using `customType()` would throw `TypeError: Cannot read properties of undefined`. The fix is to use the native `bytea` import or upgrade to latest. ([GitHub issue #3902](https://github.com/drizzle-team/drizzle-orm/issues/3902))
5. **`.array()` import issues** — In some older versions of Drizzle, `.array()` was not available as a chained method. Make sure you import from `drizzle-orm/pg-core` and use a recent version (`>=0.30`).
6. **Default empty array syntax** — Use `sql` template literals for default empty arrays: `default(sql\`'{}'::text[]\`)`. JavaScript array `default([])` will cause migration errors.
7. **`bytea` driver behavior** — Different PostgreSQL drivers (`postgres`, `pg`, `@neondatabase/serverless`) handle `bytea` differently. `pg` returns `Buffer`, `postgres` returns `Uint8Array`. Test with your specific driver.

### jose + Next.js Middleware

8. **Edge Runtime compatibility** — `jose` works in Edge Runtime, but `jsonwebtoken` does **NOT**. Always use `jose` for middleware JWT operations.
9. **Secret encoding** — `jose` requires the secret to be encoded: `new TextEncoder().encode(secret)`. Don't pass raw strings.
10. **Cookie access in middleware** — Use `request.cookies.get()` (not `cookies()` from `next/headers`) in middleware, since middleware runs in Edge Runtime.

### Vitest + Next.js

11. **Async Server Components** — Vitest cannot test async Server Components. Use E2E tests (Playwright/Cypress) for those.
12. **`next/headers` in tests** — Functions like `cookies()` and `headers()` from `next/headers` need to be mocked in unit tests since they rely on Next.js request context.
13. **`NextRequest` constructor** — When creating test requests, use standard `new Request()` or `node-mocks-http`. The `NextRequest` constructor requires specific setup.
14. **Environment mismatch** — API route tests should use `@vitest-environment node`, not `jsdom`, to avoid issues with `Response`, `Request`, and other globals.

### General

15. **CVE-2025-29927** — A critical Next.js middleware bypass vulnerability was disclosed in March 2025. Make sure you're on Next.js 15.2.3+ or 14.2.25+ to avoid this. Never rely solely on middleware for auth — always validate in your data access layer too.

---

## Summary of Recommendations

| Topic                 | Recommended Approach                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Clerk Mock**        | Build a mock auth adapter using `jose` that mirrors Clerk's `auth()` API. Toggle via env var.                |
| **BYTEA**             | Use native `bytea` from `drizzle-orm/pg-core` (built-in). Fall back to `customType` only for custom mapping. |
| **INET**              | Use native `inet` from `drizzle-orm/pg-core` (built-in). Fall back to `customType` if not in your version.   |
| **TEXT[]**            | Use `text('col').array()` with `default(sql\`'{}'::text[]\`)` for empty defaults.                            |
| **JWT Sessions**      | Use `jose` library: `SignJWT` + `jwtVerify` with HS256. Store in httpOnly cookies.                           |
| **API Route Testing** | Use `next-test-api-route-handler` with Vitest. Mock auth modules with `vi.mock()`.                           |
| **Middleware Auth**   | Use `jose` `jwtVerify` in middleware.ts. Pass user info via custom headers.                                  |

---

## Key Libraries & Versions

| Library                       | Purpose           | Notes                                        |
| ----------------------------- | ----------------- | -------------------------------------------- |
| `jose`                        | JWT sign/verify   | Edge-compatible, works in middleware         |
| `drizzle-orm`                 | ORM               | Use latest for `bytea`/`inet` native support |
| `drizzle-kit`                 | Migrations        | Use >=0.24.0 for array default fix           |
| `@clerk/nextjs`               | Auth (production) | v5+ for Next.js 15 App Router                |
| `@clerk/testing`              | E2E test helpers  | For Playwright integration                   |
| `next-test-api-route-handler` | API route testing | Works with Vitest and Jest                   |
| `vitest`                      | Test runner       | Configured with `@vitejs/plugin-react`       |
| `@testing-library/react`      | Component testing | For integration tests                        |

---

## References

1. [Clerk Blog: Testing Clerk Next.js Applications](https://clerk.com/blog/testing-clerk-nextjs) (Apr 2025)
2. [Drizzle ORM: Custom Types](https://orm.drizzle.team/docs/custom-types)
3. [Drizzle ORM: PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg)
4. [Drizzle ORM: Empty Array Default Value Guide](https://orm.drizzle.team/docs/guides/empty-array-default-value)
5. [abdessamadely.com: JWT Auth in Next.js with jose](https://abdessamadely.com/jwt-authentication-in-next-js-with-api-routes-and-jose) (Jul 2025)
6. [HashBuilds: Next.js Middleware Authentication](https://www.hashbuilds.com/articles/next-js-middleware-authentication-protecting-routes-in-2025) (Dec 2025)
7. [Arcjet Blog: Testing Next.js App Router API Routes](https://blog.arcjet.com/testing-next-js-app-router-api-routes/) (Mar 2024)
8. [StackOverflow: bytea in Drizzle ORM](https://stackoverflow.com/questions/76399047)
9. [Wanago.io: Arrays with PostgreSQL and Drizzle ORM](https://wanago.io/2024/07/08/api-nestjs-postgresql-arrays-drizzle-orm/)
10. [Next.js Docs: Testing with Vitest](https://nextjs.org/docs/pages/guides/testing/vitest)
11. [GitHub: drizzle-orm bytea bug #3902](https://github.com/drizzle-team/drizzle-orm/issues/3902)
12. [GitHub: drizzle-orm binary data types #298](https://github.com/drizzle-team/drizzle-orm/issues/298)
13. [PgInet class documentation](https://repos.supermodeltools.com/drizzle-orm/class-inet-ts-pginet.html)
14. [next-test-api-route-handler on npm](https://www.npmjs.com/package/next-test-api-route-handler)
