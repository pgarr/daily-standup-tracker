# Test Runner Bootstrap + Auth/Routing Protection — Plan Brief

> Full plan: `context/changes/testing-runner-auth-routing/plan.md`
> Research: `context/changes/testing-runner-auth-routing/research.md`

## What & Why

Bootstrap the project's first two test runners (Vitest + Playwright) and prove that the middleware auth gate correctly blocks unauthenticated access to protected routes. This is Phase 1 of the test-plan rollout (`context/foundation/test-plan.md` §3) targeting Risk #1 — "unauthenticated user reaches a protected route via middleware regression or new route added without updating the gate."

## Starting Point

No test infrastructure exists: no `vitest.config.ts`, no `playwright.config.ts`, no test files, and no CI test steps. The middleware at `src/middleware.ts` already implements the gate via two prefix-based protection arrays; the tests will prove it works and will catch the gap if a future developer adds a new route prefix without updating the gate.

## Desired End State

`npm test` (Vitest) and `npx playwright test` (Playwright) both pass locally and in CI. Adding a new page file under a new top-level prefix causes `npm test` to fail immediately, naming the ungated route. CI runs both suites on every PR before the build step.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| HTTP test execution model | Playwright webServer + `request` context | Avoids `astro:env/server` import issues; Playwright's `webServer` manages dev-server lifecycle cleanly | Plan (research grounded the constraint) |
| Gap detection strategy | Filesystem-crawl Vitest test | Catches new routes automatically at `npm test` time vs. relying on human discipline | Plan |
| Vitest scope in Phase 1 | Bootstrap only (smoke + crawl test) | Vitest is the Phase 3 unit-test workhorse; forcing HTTP tests into Vitest adds fragile process management | Plan |
| MSW | Deferred — skip Phase 1 | Playwright HTTP tests hit the real server; no mocking layer needed for unauthenticated-path tests | Plan |
| Test directory layout | `e2e/` for Playwright, `src/__tests__/` for Vitest | Each tool in its idiomatic home | Plan |
| Supabase credentials in CI | Not needed for Phase 1 | `createClient()` returns `null` when env vars absent → `user = null` → redirects fire correctly | Research |

## Scope

**In scope:**
- Install and configure Vitest; add `npm test` script
- Filesystem-crawl route-coverage test (gap detection for Risk #1)
- Install and configure Playwright; add `npm run test:e2e` script
- Unauthenticated HTTP gate tests for all protected routes (assert 302 → `/auth/signin`)
- Public-route assertions (assert no redirect)
- CI pipeline update (Vitest + Playwright steps before build)

**Out of scope:**
- Authenticated flow tests (require real Supabase JWT — Phase 2+)
- `@cloudflare/vitest-pool-workers` (overkill; HTTP approach is sufficient)
- MSW (no use case in Phase 1)
- Browser-driven e2e tests (Playwright runs API/HTTP mode only)
- API route inline guard tests (require auth — Phase 4)

## Architecture / Approach

Two runners, two distinct concerns. Vitest handles pure Node.js structural tests (the crawl test uses `fs`, nothing Astro-specific). Playwright manages the server lifecycle via `webServer: { command: 'npm run dev', url: 'http://localhost:4321' }` and uses the `request` fixture (no browser) to send unauthenticated HTTP requests and assert raw 302 responses. The key constraint is the `astro:env/server` virtual module: Vitest cannot import `src/middleware.ts` or `src/lib/supabase.ts` directly — all Phase 1 Vitest tests are isolated from those modules.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Vitest Bootstrap | Working `npm test`; smoke test; filesystem-crawl gap-detection test | Vitest test importing `astro:env/server`-dependent code fails at import time |
| 2. Playwright + HTTP Gate Tests | `npx playwright test` proves 302 on protected routes; public routes pass | `astro dev` fails to start in CI (workerd/Miniflare issue) |
| 3. CI Integration | Both suites green on every PR before build | CI needs chromium install; playwright test slows pipeline |

**Prerequisites:** `npm run dev` (`astro dev`) must start successfully with no Supabase credentials set.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- `astro dev` with `@astrojs/cloudflare` adapter starts cleanly in CI without Supabase credentials — verified by the research (env vars are `optional: true` in schema), but not end-to-end confirmed in a CI environment.
- The `AUTH_REQUIRED_PREFIXES` constant in `route-coverage.test.ts` must be kept in sync with `src/middleware.ts` manually — a divergence would produce false-green results on the crawl test.
- Playwright's `request` context with `maxRedirects: 0` correctly captures the 302 response header — standard Playwright behavior, but worth verifying during Phase 2 manual testing.

## Success Criteria (Summary)

- `npm test` passes locally and in CI; adding a new ungated route file causes a named failure.
- `npx playwright test` passes; every protected route returns 302 → `/auth/signin` for unauthenticated requests.
- CI job completes with lint → test → e2e → build all green on a real PR.
