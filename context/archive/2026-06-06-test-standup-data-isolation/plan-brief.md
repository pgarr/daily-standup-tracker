# Standup Data Isolation Tests — Plan Brief

> Full plan: `context/changes/test-standup-data-isolation/plan.md`

## What & Why

Prove that `standup_entries` RLS enforces absolute horizontal data isolation: Member A
cannot read or forge rows belonging to Member B. This is Risk #2 in the test plan —
rated High impact / Medium likelihood — and the test plan explicitly flags that "RLS is
enabled" is not the same as "RLS is correct." This phase also lays down the JWT-fixture
helper that Phase 4 and Phase 5 will reuse.

## Starting Point

Vitest is installed (Phase 1) with a smoke test and a route-coverage test. No JWT fixture
infrastructure exists — Phase 1 only tested unauthenticated flows. `@supabase/supabase-js`
is already installed but has no test helper. `standup_entries` has SELECT and INSERT RLS
policies; no UPDATE/DELETE policies (entries are immutable in MVP).

## Desired End State

`npm test` runs 5 data-isolation tests when local Supabase is running; skips gracefully
(exit 0) when it is not. `src/__tests__/helpers/supabase-test.ts` is the canonical Supabase
test helper for all future RLS phases. `test-plan.md §6.3` is filled in with the complete
RLS test recipe.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Fixture lifecycle | `beforeAll`/`afterAll` per suite | Fast (one setup); fixture state is read-only during tests | Plan |
| Setup client | Service-role for all fixture writes | No INSERT RLS policy exists for regular `workspace_member` rows — only `accept_invitation()` SECURITY DEFINER | Plan |
| Assertion client | `createUserClient(accessToken)` — anon key + JWT header | Service-role bypasses RLS and produces false-green; real JWT enforces it | Plan / test-plan.md §2 |
| Skip guard | `describe.skipIf(!supabaseAvailable)` via top-level await | Suite must not fail CI that doesn't spin up local Supabase | Plan |
| Scope | SELECT isolation + INSERT IDOR + INSERT workspace mismatch | Covers the two WITH CHECK clauses; UPDATE/DELETE deferred to Phase 5 | Plan |
| Credentials | Hardcoded local CLI defaults + env-var override | Zero config on dev machines; CI can override | Plan |
| Helper location | `src/__tests__/helpers/supabase-test.ts` | Reusable across Phase 4 and Phase 5 without copy-paste | Plan |
| Cookbook §6.3 | Filled in this phase | New contributors need a recipe without reading the test file | Plan |

## Scope

**In scope:** SELECT isolation, INSERT IDOR (forged `user_id`), INSERT workspace mismatch
(foreign `workspace_id`), positive-case (User A sees their own entry), `supabase-test.ts`
helper, `test-plan.md §6.3` cookbook entry.

**Out of scope:** UPDATE/DELETE RLS (Phase 5), Team Lead visibility (Phase 4, S-05),
HTTP-layer testing, CI configuration changes, schema changes.

## Architecture / Approach

```
src/__tests__/helpers/supabase-test.ts   ← shared by Phase 4 + 5
        ├─ createServiceClient()          (bypasses RLS — fixture setup only)
        ├─ createUserClient(jwt)          (enforces RLS — all assertions)
        └─ isSupabaseRunning()            (probe → skip guard)

src/__tests__/standup-data-isolation.test.ts
        ├─ beforeAll: service client creates users, workspace×2, members, entry
        ├─ signInWithPassword → real JWT per user
        ├─ tests run under userB JWT (isolation) or userA JWT (positive)
        └─ afterAll: service client deletes workspace (CASCADE) + users
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Supabase test helper | `supabase-test.ts` with client factories and liveness probe | Wrong defaults for local Supabase URL/keys cause all tests to fail at setup |
| 2. Data isolation tests | 5 tests covering SELECT + INSERT RLS boundaries | `beforeAll` failure leaves orphaned test users in local Supabase if `afterAll` doesn't run |
| 3. §6.3 cookbook | RLS test recipe for future contributors | Entry is too terse and future phases still re-derive the pattern |

**Prerequisites:** Local Supabase running (`npx supabase start`); `standup_entries`
migration applied (S-03 shipped — yes, present in `supabase/migrations/`).
**Estimated effort:** ~1 session across 3 short phases.

## Open Risks & Assumptions

- If local Supabase JWT secret differs from the CLI defaults (non-standard setup), the
  hardcoded anon/service keys will need env-var overrides — document clearly.
- `beforeAll` failure mid-run may leave orphaned auth users; `afterAll` must be robust
  enough to clean up even after a partial setup (wrap each delete in a try/catch or use
  `.maybeSingle()` guards).

## Success Criteria (Summary)

- `npm test` with Supabase running: 5 green tests, exit 0.
- `npm test` without Supabase: suite skipped, exit 0.
- Confidence check (swap service-role into a SELECT assertion) produces a false-green,
  proving the test is actually exercising RLS.
