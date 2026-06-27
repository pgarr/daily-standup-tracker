# Test Security Role Invite — Plan Brief

> Full plan: `context/changes/test-security-role-invite/plan.md`
> GH Issue: #10

## What & Why

T-4 adds integration tests that prove two security guarantees that ship in production but have no automated coverage: the role gate on `/team-feed` (Member sessions must be redirected; only Team Leads may enter) and the `accept_invitation()` SQL function's three attack-surface defenses (token replay, wrong-email binding, token expiry). Without these tests, a regression in either gate is silent.

## Starting Point

Both security mechanisms are implemented and deployed:
- `team-feed.astro:13-14`: `if (workspaceMember?.role !== "team_lead") return Astro.redirect("/dashboard")`
- `accept_invitation()` in `supabase/migrations/20260605000001_accept_invitation_function.sql`: single atomic SELECT that filters `email = (auth.jwt() ->> 'email') AND accepted_at IS NULL AND expires_at > now()`

Two test patterns already exist: Vitest + local Supabase (`standup-data-isolation.test.ts`) and Playwright API-level HTTP tests (`middleware-gate.spec.ts`). Test helpers (`createServiceClient`, `createUserClient`, `createSignInClient`, `isSupabaseRunning`) are in `src/__tests__/helpers/supabase-test.ts`.

## Desired End State

`npm test` includes passing invite-token security tests (3 failure modes + 1 positive anchor). `npx playwright test` includes passing role-gating tests (member rejected, team_lead accepted). Both test files follow existing project patterns exactly. Both skip gracefully when local Supabase is not running.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Role gating test location | Playwright HTTP-level | Proves the actual HTTP endpoint rejects Member sessions — the stated T-4 goal; Vitest RLS tests would only prove DB layer |
| Invite token test location | Vitest + Supabase | Follows established `standup-data-isolation.test.ts` pattern; RPC can be called directly without HTTP server |
| Auth strategy for Playwright | POST /api/auth/signin with form data | Tests the real sign-in flow; Playwright carries cookies automatically; no need to know Supabase cookie internals |
| Playwright fixtures | globalSetup/globalTeardown in playwright.config.ts | Users created once per run; mirrors Playwright's recommended auth pattern |
| Skip-when-offline | isSupabaseRunning() + skipIf / configure(skip) | Consistent with existing test patterns; no CI failures when Supabase not running |
| Token expiry test | Insert row with past expires_at via service client | No time-mocking; clean and direct |
| Positive test | team_lead can access /team-feed (200) + user-a member row exists | Prevents false positives from a gate that rejects everyone |

## Scope

**In scope:** `src/__tests__/invite-token-security.test.ts` (4 tests), `e2e/role-gating.spec.ts` (2 tests), `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `playwright.config.ts` update, `.gitignore` update.

**Out of scope:** Team Lead UI/data tests for `/team-feed` content, invite email delivery, CI integration of Playwright role-gating tests, changes to existing test files.

## Architecture / Approach

**Phase 1 (Vitest)**: One `describe.skipIf(!supabaseAvailable)` block. `beforeAll` creates one workspace + three users (replay user, wrong-email target, attacker/expired user) + three invite rows via service client, then signs in replay-user and attacker-user and runs the positive acceptance (replay-user accepts replay-token). `afterAll` deletes all fixtures. Four `it` tests assert: member row exists after acceptance, replay rejected, wrong-email rejected, expired rejected.

**Phase 2 (Playwright)**: `global-setup.ts` creates two users (team_lead + member) + workspace + workspace_member rows via service client and writes credentials to `.auth/test-fixtures.json`. `global-teardown.ts` reads the file and cleans up. `role-gating.spec.ts` creates two isolated request contexts, signs in each via POST /api/auth/signin (Playwright stores cookies), then asserts GET /team-feed with `maxRedirects: 0` returns 302 /dashboard for member and 200 for team_lead.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Vitest invite-token tests | 4 tests covering replay, wrong-email, expiry, positive anchor | `workspace_invitation` UNIQUE(workspace_id, email) requires distinct emails per user |
| 2. Playwright role-gating tests | 2 HTTP-level tests + globalSetup/Teardown infrastructure | Auth requires dev server with Supabase vars — satisfied by reuseExistingServer in local dev |

## Open Risks & Assumptions

- **Dev server must have Supabase configured** for role-gating tests to authenticate. In local dev `reuseExistingServer: true` picks up the developer's running `npm run dev` (which has `.env` loaded). In CI, Playwright E2E is not run, so this is not a blocker.
- **Test isolation is timestamp-based**: all test emails use `${ts}@example.com` suffixes and all token strings include `${ts}`. Parallel runs on the same Supabase instance could theoretically collide if two runs start within the same millisecond — acceptable for a local integration test suite.
