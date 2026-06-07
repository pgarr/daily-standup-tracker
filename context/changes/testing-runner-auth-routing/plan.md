# Test Runner Bootstrap + Auth/Routing Protection (Phase 1) Implementation Plan

## Overview

Bootstrap Vitest and Playwright from zero, write a filesystem-crawl gap-detection test, and prove the middleware auth gate with real unauthenticated HTTP requests. This is Phase 1 of the project's test rollout (see `context/foundation/test-plan.md` §3) and covers Risk #1 — "unauthenticated user reaches a protected route via middleware regression or new route added without updating the gate."

## Current State Analysis

No test infrastructure exists. No `vitest.config.ts`, `playwright.config.ts`, or `*.test.ts`/`*.spec.ts` files are present. The CI pipeline (`ci.yml`) runs only lint and build.

The middleware (`src/middleware.ts`) uses two prefix-based protection lists (`AUTH_REQUIRED_ROUTES`, `WORKSPACE_REQUIRED_ROUTES`) with `.startsWith()` matching. The Supabase client factory (`src/lib/supabase.ts`) imports from `astro:env/server` — a virtual module that Astro resolves at build/dev time but that is unavailable in a plain Node.js Vitest process.

Ten routes exist across `src/pages/`. All currently have correct protection. The gap is structural: a new route added under a new top-level prefix (e.g., `/team`, `/invites`) is silently unprotected unless a developer manually updates `AUTH_REQUIRED_ROUTES`.

## Desired End State

After this plan is complete:
- `npm test` runs Vitest, executes a smoke test (runner verified) and a filesystem-crawl test (route coverage verified).
- `npx playwright test` runs Playwright against a live dev server and proves every protected route returns 302 → `/auth/signin` for unauthenticated requests.
- Adding a new `.astro` or `.ts` file under `src/pages/` with a new top-level prefix causes `npm test` to fail immediately, naming the ungated route.
- CI runs both test suites on every push and PR (before the build step).

### Key Discoveries

- `src/middleware.ts:5–8` — Two separate protection arrays, not one `PROTECTED_ROUTES`. Prefix-based via `.startsWith()`.
- `src/lib/supabase.ts:8–10` — `createClient()` returns `null` when env vars are absent; middleware handles null gracefully (`user = null`) and redirects still fire. Phase 1 Playwright tests need **no Supabase credentials** — the unauthenticated path works correctly either way.
- `astro:env/server` — Virtual module resolved only by Astro's Vite pipeline. Importing `src/middleware.ts` or `src/lib/supabase.ts` directly in Vitest (Node.js) will fail. Phase 1 Vitest tests must not import those modules.

## What We're NOT Doing

- Authenticated flows (those require real Supabase JWTs — Phase 2 and beyond).
- Testing the workspace-required tier in isolation (requires a logged-in but workspaceless user session).
- `@cloudflare/vitest-pool-workers` — too complex for this use case; HTTP-level testing is cheaper and sufficient for Risk #1.
- MSW — not needed; Playwright HTTP tests hit the real dev server. Deferred to Phase 3 if unit tests need fetch mocking.
- Browser-driven e2e tests — Playwright runs in API/HTTP mode only for Phase 1 (no `page`, only `request`).
- Inline API-route guard testing — those require authentication; Phase 4 scope.

## Implementation Approach

Two test runners serve different concerns:

- **Vitest** — pure Node.js, fast, for filesystem-based structural tests and future unit tests (Phase 3). Not used for anything that imports `astro:env/server`.
- **Playwright** — manages the dev-server lifecycle via `webServer` config; uses the `request` API context (no browser) to send unauthenticated HTTP and assert the raw redirect response.

The filesystem-crawl test lives in Vitest because it is a pure Node.js `fs` operation. The HTTP gate tests live in Playwright because they require a running server, and Playwright's `webServer` config is the cleanest lifecycle manager.

## Critical Implementation Details

**`astro:env/server` import boundary**: `vitest.config.ts` runs in Node.js. Any Vitest test file that (directly or transitively) imports `src/middleware.ts` or `src/lib/supabase.ts` will fail with a module resolution error on `astro:env/server`. The two Phase 1 Vitest tests (smoke + crawl) are deliberately isolated from those modules. Future Vitest tests must respect this boundary — they should test pure functions that do not depend on Astro's virtual module system.

**Playwright `maxRedirects: 0`**: Playwright's `request.get()` follows redirects by default. To assert the 302 directly (and capture the `location` header), every protected-route assertion must pass `{ maxRedirects: 0 }` to the request options. Without it, the test receives the final destination's response (200 from `/auth/signin`) and the redirect is invisible.

**No Supabase env vars in Playwright's webServer**: When `SUPABASE_URL` and `SUPABASE_KEY` are absent, `createClient()` returns `null`, the middleware sets `user = null`, and protected routes redirect correctly. This is the intended behavior for unauthenticated tests. Do not provide fake Supabase URLs — that would cause `getUser()` to make a real (failing) network request, slowing tests. Provide no values and let the null path fire.

---

## Phase 1: Vitest Bootstrap

### Overview

Install Vitest, configure it for Node.js with path-alias resolution, wire `npm test` scripts, and write two tests: a smoke test (proves the runner executes) and a filesystem-crawl gap-detection test (proves every route is consciously classified as protected or public).

### Changes Required

#### 0. Extract route constants to a shared module

**File**: `src/lib/routes.ts` (new file)

**Intent**: Give the route protection constants a dependency-free home so both `src/middleware.ts` and Vitest tests can import them without hitting `astro:env/server`. This is the prerequisite that makes the filesystem-crawl gap-detection test accurate across future middleware changes — the test always reads the same values the middleware enforces, with no manual sync required.

**Contract**: Export `AUTH_REQUIRED_ROUTES` (string array), `WORKSPACE_REQUIRED_ROUTES` (string array), and `WORKSPACE_SETUP_REDIRECT` (string) as plain constants with no imports. Update `src/middleware.ts` to import these three from `@/lib/routes` and remove the inline definitions.

#### 1. Install Vitest

**File**: `package.json`

**Intent**: Add Vitest to devDependencies and expose `test` and `test:watch` scripts so both manual and CI invocations work.

**Contract**: Add to `devDependencies`: `"vitest"` (latest version compatible with the project's Vite version — verify against Astro 6's internal Vite peer dep before pinning). Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

#### 2. Create Vitest configuration

**File**: `vitest.config.ts` (new file at project root)

**Intent**: Configure Vitest to run in the Node.js environment, resolve the `@/*` path alias consistent with `tsconfig.json`, and collect only files from `src/__tests__/`.

**Contract**:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

The `include` pattern is explicit so that future test files placed outside `src/__tests__/` are not accidentally picked up by Vitest (they may belong to Playwright instead).

#### 3. Create the smoke test

**File**: `src/__tests__/smoke.test.ts` (new file)

**Intent**: Assert that the Vitest runner is operational without importing any Astro/Cloudflare-specific modules. This test is intentionally trivial — its only purpose is to verify the toolchain wires up end-to-end.

**Contract**: One `test()` with a pure-JavaScript assertion (no app imports). If this test fails, the problem is with the Vitest installation or configuration, not with application logic.

#### 4. Create the filesystem-crawl gap-detection test

**File**: `src/__tests__/route-coverage.test.ts` (new file)

**Intent**: Prove that every page file under `src/pages/` is either covered by a middleware protection prefix or explicitly listed as a public route. When a developer adds a new page with a new top-level prefix, this test fails immediately with a clear error naming the ungated route and explaining how to resolve it.

**Contract**:

- Uses Node.js `fs.readdirSync` recursively to list all `.astro` and `.ts` files under `src/pages/`.
- **Skip any file or directory whose basename starts with `_`** — Astro ignores `_`-prefixed entries in `src/pages/` (they are co-located helpers, not routes). Without this filter, a file like `src/pages/_utils.ts` would produce a spurious `/utils` URL and a false-positive "ungated route" failure.
- Derives the URL path for each file using Astro's file-based routing convention:
  - `index.astro` → `/`; `dashboard.astro` → `/dashboard`; `auth/signin.astro` → `/auth/signin`
  - Dynamic route segments (e.g., `[id].astro`) are normalized: `[id]` → `:id` and the derived path's static prefix is checked against the protection list. If the directory prefix is already protected (e.g., `/dashboard/[id]` under `/dashboard`), the route passes without being in the public list.
  - API route files (`.ts` under `api/`) follow the same derivation.
- Import `AUTH_REQUIRED_ROUTES` and `WORKSPACE_REQUIRED_ROUTES` directly from `@/lib/routes` (the module created in change #0). No local copy of these constants — the test always reads the same values the middleware enforces.
- One local constant remains in the test file:

  ```typescript
  import { AUTH_REQUIRED_ROUTES, WORKSPACE_REQUIRED_ROUTES } from '@/lib/routes';

  // Every route not covered by a prefix must appear here with a justification comment.
  // If you add a new public page, add it here. If it should be protected, add its
  // prefix to AUTH_REQUIRED_ROUTES in src/lib/routes.ts.
  const EXPLICIT_PUBLIC_ROUTES = new Set([
    '/',
    '/auth/signin',
    '/auth/signup',
    '/auth/confirm-email',
    '/api/auth/signin',
    '/api/auth/signup',
    '/api/auth/signout',
    '/api/workspace/create',
  ]);
  ```

- The assertion: if any derived route is neither covered by a prefix nor in `EXPLICIT_PUBLIC_ROUTES`, the test fails with: `"Ungated route(s) found: [/foo]. Add to AUTH_REQUIRED_ROUTES in src/middleware.ts (and AUTH_REQUIRED_PREFIXES here) if it should be protected, or to EXPLICIT_PUBLIC_ROUTES if it is intentionally public."`

Note: API routes are in `EXPLICIT_PUBLIC_ROUTES` because they are not in `AUTH_REQUIRED_ROUTES` — they rely on inline guards instead. This classification is intentional and documents the current design.

### Success Criteria

#### Automated Verification

- `npm test` exits 0; both `smoke.test.ts` and `route-coverage.test.ts` pass.
- `npm run lint` still passes after adding `vitest.config.ts` and the test files.

#### Manual Verification

- Create a temporary file `src/pages/team.astro` (empty) and run `npm test`. Confirm the route-coverage test fails with a message naming `/team` as ungated. Delete the file; confirm `npm test` passes again.

**Pause for manual confirmation before proceeding to Phase 2.**

---

## Phase 2: Playwright + Middleware HTTP Gate Tests

### Overview

Install Playwright, configure it to start `npm run dev` as a background web server, and write HTTP-level integration tests that send unauthenticated requests to every protected route and assert the 302 redirect to `/auth/signin`. Public routes are asserted to not redirect. No browser is used — all tests use Playwright's `request` API context.

### Changes Required

#### 1. Install Playwright

**File**: `package.json`

**Intent**: Add `@playwright/test` to devDependencies and expose `test:e2e` and `test:e2e:ui` scripts.

**Contract**: Add to `devDependencies`: `"@playwright/test"` (latest stable). Add scripts: `"test:e2e": "playwright test"`, `"test:e2e:ui": "playwright test --ui"`.

Browser binaries are installed separately via `npx playwright install` — do not bundle them in `package.json` as a `postinstall` hook (CI manages this explicitly).

#### 2. Create Playwright configuration

**File**: `playwright.config.ts` (new file at project root)

**Intent**: Configure Playwright's test directory, browser project, and the `webServer` that starts the Astro dev server before tests run. Establish that no Supabase credentials are needed for Phase 1.

**Contract**:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  projects: [
    // API-only project — no browser needed for Phase 1 request-context tests.
    // Add a chromium project in Phase 4 when browser-driven tests are introduced.
    { name: 'api', use: {} },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    // No SUPABASE_* env vars: createClient() returns null when vars are absent,
    // context.locals.user = null, protected routes redirect correctly.
    // Providing a fake URL would trigger a real (failing) network call to Supabase.
  },
  use: {
    baseURL: 'http://localhost:4321',
  },
});
```

#### 3. Create middleware gate spec

**File**: `e2e/middleware-gate.spec.ts` (new file)

**Intent**: For every protected route, assert that an unauthenticated HTTP GET returns 302 with a `location` header pointing to `/auth/signin`. For every public route, assert the response is not a redirect. Tests use `request` context only — no browser pages are opened.

**Contract**:

- Protected routes under test: `/dashboard`, `/workspace/setup`.
  - These cover both tiers: `/dashboard` (auth + workspace required), `/workspace/setup` (auth only).
- Public routes under test: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`.
- Each protected-route assertion:
  ```typescript
  const response = await request.get(route, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()['location']).toContain('/auth/signin');
  ```
- Each public-route assertion:
  ```typescript
  const response = await request.get(route, { maxRedirects: 0 });
  expect(response.status()).not.toBe(302);
  ```

`maxRedirects: 0` is critical — without it, Playwright follows the redirect and the 302 is invisible to the test.

### Success Criteria

#### Automated Verification

- `npx playwright test` exits 0; all protected-route tests report 302; all public-route tests report non-302.
- `npm run lint` still passes after adding `playwright.config.ts` and the spec file.

#### Manual Verification

- Run `npx playwright test --reporter=list` and read the output: confirm each test name, the asserted route, and the pass/fail status are legible.
- Temporarily remove `/dashboard` from `AUTH_REQUIRED_ROUTES` in `src/middleware.ts`, run `npx playwright test`, confirm the `/dashboard` test fails. Revert.

**Pause for manual confirmation before proceeding to Phase 3.**

---

## Phase 3: CI Integration

### Overview

Add Vitest and Playwright test steps to `.github/workflows/ci.yml` so both test suites run on every push and PR, before the build step. No Supabase or Cloudflare credentials are needed for the test steps.

### Changes Required

#### 1. Update CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Insert Vitest and Playwright steps into the existing pipeline so tests gate every PR. Tests run before the build step (fail fast on test failures before spending time on the full build).

**Contract**: After the existing `npm run lint` step and before the `npm run build` step, add:

```yaml
- run: npm test
- run: npx playwright test
```

No browser install step is needed — the `api` project in `playwright.config.ts` uses no browser; `request`-context tests require no binary. No `env:` block is needed for these steps — Phase 1 Playwright tests require no Supabase credentials (see Critical Implementation Details above).

The existing `npm run build` step (with its SUPABASE secrets) and the deploy/migration steps remain unchanged.

### Success Criteria

#### Automated Verification

- Push a branch, open a PR against master, verify the CI job succeeds with all steps visible: lint → `npm test` → `playwright test` → build.

#### Manual Verification

- Temporarily comment out one assertion in `e2e/middleware-gate.spec.ts`, push to the branch, confirm CI fails on the `playwright test` step (not the build step). Revert.

---

## Testing Strategy

### Unit / Structural Tests (Vitest in `src/__tests__/`)

- `smoke.test.ts` — runner liveness (trivial; no app imports).
- `route-coverage.test.ts` — filesystem crawl; fails on any ungated route.

Rule: no Vitest test may import a module that transitively depends on `astro:env/server`.

### Integration Tests (Playwright in `e2e/`)

- `middleware-gate.spec.ts` — HTTP-level, no browser. Asserts 302 for protected routes, non-302 for public routes.

### Manual Testing Steps

1. Start `npm run dev`; confirm the server starts and `/dashboard` redirects to `/auth/signin` in a browser.
2. Run `npm test` and `npx playwright test` locally; confirm both exit 0.
3. Add `src/pages/team.astro` (empty); run `npm test`; confirm route-coverage failure. Delete file; confirm pass.
4. Remove `/dashboard` from `AUTH_REQUIRED_ROUTES`; run `npx playwright test`; confirm gate failure. Revert.

## References

- Research doc: `context/changes/testing-runner-auth-routing/research.md`
- Test-plan: `context/foundation/test-plan.md` §3 Phase 1, §2 Risk #1, §5 Quality Gates
- Middleware: [`src/middleware.ts:5–52`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L5)
- Supabase client: [`src/lib/supabase.ts:7–26`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/lib/supabase.ts#L7)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Vitest Bootstrap

#### Automated

- [x] 1.1 `npm test` exits 0 (smoke + route-coverage pass) — 6e2e5a9
- [x] 1.2 `npm run lint` passes with new files in place — 6e2e5a9

#### Manual

- [x] 1.3 Add `src/pages/team.astro`, run `npm test`, confirm failure names `/team`; delete file, confirm pass — 6e2e5a9

---

### Phase 2: Playwright + Middleware HTTP Gate Tests

#### Automated

- [x] 2.1 `npx playwright test` exits 0 (all protected routes 302, all public routes non-302)
- [x] 2.2 `npm run lint` passes with new config + spec in place

#### Manual

- [x] 2.3 `playwright test --reporter=list` output is legible (test names + routes visible)
- [x] 2.4 Remove `/dashboard` from `AUTH_REQUIRED_ROUTES`, run `playwright test`, confirm failure; revert

---

### Phase 3: CI Integration

#### Automated

- [ ] 3.1 CI job passes on a new PR: lint → npm test → playwright install → playwright test → build all green

#### Manual

- [ ] 3.2 Comment out one Playwright assertion, push to branch, confirm CI fails on playwright step (not build step); revert
