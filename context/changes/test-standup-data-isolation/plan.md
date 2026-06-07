# Standup Data Isolation Tests — Implementation Plan

## Overview

Add Vitest integration tests proving that `standup_entries` RLS enforces absolute horizontal
data isolation: Member A cannot see or forge rows belonging to Member B. Covers Risk #2 from
the test plan. Establishes the JWT-fixture pattern (service-role for setup, real JWT for
assertions) that Phase 4 and Phase 5 tests will reuse.

## Current State Analysis

Phase 1 shipped Vitest with a smoke test and a route-coverage gap-detection test. No JWT
fixture infrastructure exists — Phase 1 tested only unauthenticated flows.

`standup_entries` has RLS enabled with two policies:
- **SELECT**: `auth.uid() = user_id` — member sees only own rows.
- **INSERT WITH CHECK**: `auth.uid() = user_id AND workspace_id = auth_user_workspace_id()` —
  member can only insert their own entry in their own workspace.
- No UPDATE/DELETE policies (entries are immutable in MVP).

`workspace_member` has NO INSERT policy for regular members — the only authenticated INSERT
path for member rows is via `accept_invitation()` SECURITY DEFINER. Fixture setup must
therefore bypass RLS using the service-role client.

No `@supabase/supabase-js` test helper exists. The existing SSR client (`src/lib/supabase.ts`)
imports from `astro:env/server` and cannot be imported by Vitest.

## Desired End State

After this plan is complete:
- `npm test` runs all tests including 5 standup isolation cases when local Supabase is running.
- When local Supabase is not running, the isolation suite is skipped with a clear message — overall run is still green.
- `test-plan.md §6.3` documents the RLS integration test pattern for future contributors.
- `src/__tests__/helpers/supabase-test.ts` is the canonical Supabase test helper for Phase 4 and Phase 5.

### Key Discoveries

- `supabase/migrations/20260605000002_standup_entries.sql:13-26` — exact SELECT and INSERT policies; no UPDATE/DELETE.
- `supabase/migrations/20260604000000_workspace_member_schema.sql:14-21` — `workspace_member` schema; no INSERT policy for regular members (dropped in migration `20260606000001`) — must use service-role for fixture setup.
- `supabase/migrations/20260604000000_workspace_member_schema.sql:33-46` — `auth_user_workspace_id()` returns the user's `workspace_id` from `workspace_member`; must exist before the INSERT policy can evaluate correctly.
- `package.json` — `@supabase/supabase-js` v2.99.1 already installed; service-role bypasses RLS; anon key + `Authorization: Bearer` override enforces it.
- `vitest.config.ts` — environment: node; `@/` alias wired; includes `src/__tests__/**/*.test.ts` automatically.

## What We're NOT Doing

- Testing UPDATE/DELETE RLS rejection — no policies exist for those operations (Phase 5 scope).
- Testing through the HTTP standup submit endpoint — RLS is tested at the Supabase JS client layer directly.
- Testing Team Lead visibility of other members' entries — that policy ships in S-05 (Phase 4 scope).
- Playwright changes — this phase adds Vitest integration tests only.
- CI configuration changes — CI will pick up `npm test` naturally once local Supabase is available there.

## Implementation Approach

Three sequential steps:

1. **Create `src/__tests__/helpers/supabase-test.ts`** — shared helper with the two client factories
   (service-role for setup, anon+JWT-override for assertions) and a liveness probe. Reusable
   foundation for all future RLS test phases.

2. **Write `src/__tests__/standup-data-isolation.test.ts`** — `beforeAll` uses the service client
   to create two test users, a shared workspace, a member row for each user, a second workspace
   (for the mismatch test), and one standup entry for User A. Five test assertions all run under
   User B's (or User A's) real JWT. `afterAll` deletes workspace rows (CASCADE handles entries)
   and auth users.

3. **Fill in `test-plan.md §6.3`** — complete recipe: helper imports, fixture lifecycle, skip
   guard, client roles, run command. Reference the standup test as the canonical example.

## Critical Implementation Details

**workspace_member INSERT bypasses RLS intentionally in fixture setup.** There is no INSERT RLS
policy for regular member rows (dropped in migration `20260606000001` — only `accept_invitation()`
SECURITY DEFINER is the live path). The service-role client must be used to insert member rows in
`beforeAll`. This is fixture-only; test assertions must always use the user JWT client.

**RLS violation on INSERT returns error code `42501`** (PostgreSQL `insufficient_privilege`). Assert
both `error?.code === '42501'` and `error?.message?.includes('row-level security')` — the code
matches the PostgREST SQLSTATE pass-through (same pattern as `23505` for unique violations in
`submit.ts`); the message assertion survives any version-level variation and provides a clearer
failure description. For SELECT, a denied row is simply absent from results — no error is raised;
assert `data.length === 0` and `error === null`.

**`describe.skipIf` requires a synchronous boolean.** Vitest's `describe.skipIf` takes
`boolean | () => boolean`, not a `Promise`. Resolve `isSupabaseRunning()` at the top level via
top-level `await` (ESM test files support this in Vitest) before the describe block.

---

## Phase 1: Supabase Test Helper

### Overview

Create the shared helper that all RLS integration tests will import. Exposes two client factories
with clearly documented roles — service-role (setup only) and user JWT (assertions) — plus a
liveness probe and the local-dev credential constants.

### Changes Required

#### 1. Helper module

**File**: `src/__tests__/helpers/supabase-test.ts`

**Intent**: Single source of truth for Supabase test credentials and client factories. Separates
the service-role client (fixture setup, bypasses RLS) from the user JWT client (RLS assertions).
Phase 4 and Phase 5 tests import from here directly.

**Contract**: Export `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` — each reads from
the corresponding `TEST_SUPABASE_*` env var and falls back to the well-known local Supabase CLI
defaults (run `npx supabase status` to verify the values for your local instance).

Export `isSupabaseRunning(): Promise<boolean>` — probes the local REST API root
(`${SUPABASE_URL}/rest/v1/`); returns `false` (does not throw) on any connection failure.

Export `createServiceClient()` — `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)` from
`@supabase/supabase-js`; bypasses RLS; for fixture setup and teardown only.

Export `createUserClient(accessToken: string)` — `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + accessToken } } })`; enforces RLS via the user's JWT; the only client that should be used in test assertions.

Any `createClient` call used only to extract an access token via `signInWithPassword` (not to
maintain a live session) must pass `auth: { persistSession: false, autoRefreshToken: false }` to
prevent a background `setInterval`-backed refresh timer that would cause Vitest to hang after the
suite exits.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Type checking passes: `npm run build`

#### Manual Verification

- Helper imports cleanly from another test file without Vitest errors.

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Data Isolation Test File

### Overview

Five test cases covering Risk #2. Four run under User B's JWT to prove isolation; one runs
under User A's JWT to prove the positive case (User A can see their own entry — the policy
isn't broken in the other direction).

### Changes Required

#### 1. Test file

**File**: `src/__tests__/standup-data-isolation.test.ts`

**Intent**: Proves `standup_entries` RLS enforces absolute horizontal isolation. All assertion
queries use real Member JWTs — never the service-role key — so results reflect the actual RLS
behavior the running app observes.

**Contract**:

_Skip guard_: resolve `isSupabaseRunning()` at top level via top-level `await`; wrap the entire
suite in `describe.skipIf(!supabaseAvailable)` with a label that names the reason
(`'local Supabase not running — run npx supabase start'`).

_`beforeAll` — service client only_:
1. Create two test users via `auth.admin.createUser({ email, password, email_confirm: true })`.
   Use timestamp-suffixed emails (e.g., `rls-a-<Date.now()>@example.com`) to avoid collisions on
   retry.
2. Create `workspaceA` via `from('workspace').insert({ name: 'rls-test-a' }).select('id').single()`.
3. Create `workspaceB` (a workspace User B will NOT be a member of) via same pattern.
4. Insert `workspace_member` rows for both users into `workspaceA` with `role: 'member'`. Use
   client-generated UUIDs for the `id` field (lesson: `crypto.randomUUID()`).
5. Insert `entryA` into `standup_entries` for User A:
   `{ workspace_id: workspaceA.id, user_id: userA.id, submitted_date: '2026-06-01', did: 'test', plan: 'test', blockers: null }`.
6. Sign in as each user: `createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.signInWithPassword({ email, password })` →
   extract `session.access_token`. Store as `userA.token` and `userB.token`.

_Test assertions_ (all using `createUserClient(token)` — never service-role):
- **"User B sees no standup entries"**: `userBClient.from('standup_entries').select('*')` →
  `data.length === 0`, `error === null`.
- **"User B cannot see User A's entry by known ID"**: `.select('*').eq('id', entryA.id)` →
  `data.length === 0`, `error === null`.
- **"INSERT with User A's user_id rejected (IDOR)"**: `userBClient.from('standup_entries').insert({ user_id: userA.id, workspace_id: workspaceA.id, submitted_date: '2026-06-02', did: 'x', plan: 'x' })` →
  `error?.code === '42501' && error?.message?.includes('row-level security')`.
- **"INSERT with foreign workspace_id rejected"**: `userBClient.from('standup_entries').insert({ user_id: userB.id, workspace_id: workspaceB.id, submitted_date: '2026-06-02', did: 'x', plan: 'x' })` →
  `error?.code === '42501' && error?.message?.includes('row-level security')`.
- **"User A sees their own entry (positive case)"**: `createUserClient(userA.token).from('standup_entries').select('*')` →
  `data.length === 1`, `data[0].id === entryA.id`.

_`afterAll` — service client_:

Initialise all fixture ID variables to `undefined` before `beforeAll` runs. Guard each cleanup
step with an existence check so a partial `beforeAll` failure does not leave a malformed
Supabase query and orphaned auth users in local Supabase:

1. `if (workspaceA?.id || workspaceB?.id) from('workspace').delete().in('id', [workspaceA?.id, workspaceB?.id].filter(Boolean))` — CASCADE removes `workspace_member` and `standup_entries`.
2. `if (userA?.id) auth.admin.deleteUser(userA.id)` and `if (userB?.id) auth.admin.deleteUser(userB.id)`.

### Success Criteria

#### Automated Verification

- All 5 tests pass with local Supabase running: `npm test`
- Suite is skipped (not failed) when Supabase is not running: `npm test` exits 0 with skip notice
- Lint passes: `npm run lint`

#### Manual Verification

- Run with `npx supabase start` active — confirm 5 green tests in output.
- Stop Supabase (`npx supabase stop`), re-run — confirm suite skipped, overall run green.
- **Confidence check**: temporarily substitute `createServiceClient()` for `createUserClient(userB.token)` in the "User B sees no standup entries" test — verify it returns `data.length === 1` (service-role bypasses RLS), then restore the user client. Confirms the test is actually exercising RLS, not getting 0 rows from an empty table.

**Implementation Note**: Pause here for manual confirmation (including the confidence check) before proceeding to Phase 3.

---

## Phase 3: test-plan.md §6.3

### Overview

Fill in the TBD cookbook entry for RLS integration tests. Documents the fixture pattern, client
roles, skip guard, and run command so future contributors can add new RLS tests without
re-deriving the pattern from the test file.

### Changes Required

#### 1. §6.3 cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the TBD stub in §6.3 with a complete, self-sufficient recipe. Anyone adding
a new RLS test for a different table should be able to follow this entry without reading the
standup test file in detail.

**Contract**: The entry must cover:
- Import path: `src/__tests__/helpers/supabase-test.ts` — which exports to use and why.
- Two client roles: service-role for setup/teardown (bypasses RLS), `createUserClient(accessToken)` for all assertions (enforces RLS). Explicitly call out the anti-pattern: never use service-role in assertion queries.
- Skip guard: `const available = await isSupabaseRunning()` at top level; `describe.skipIf(!available)`.
- Fixture lifecycle: `beforeAll`/`afterAll` with service client; sign-in to get `access_token` after user creation.
- INSERT violation assertion: `error?.code === '42501'`; SELECT invisibility assertion: `data.length === 0, error === null`.
- Run command: `npm test`.
- Reference: `src/__tests__/standup-data-isolation.test.ts` as the concrete example.

### Success Criteria

#### Manual Verification

- §6.3 is readable in under 2 minutes and gives enough information to add a new RLS test without reading the standup test file first.

**Implementation Note**: Pause here for manual review before marking complete.

---

## Testing Strategy

### Integration Tests

- 5 test cases in `src/__tests__/standup-data-isolation.test.ts` covering the SELECT isolation
  and INSERT policy boundaries.
- Suite conditional on local Supabase running; exits 0 when skipped.

### Manual Testing Steps

1. `npx supabase start` then `npm test` — confirm 5 green tests.
2. `npx supabase stop` then `npm test` — confirm suite skipped, overall run still green.
3. Confidence check: swap service-role into a SELECT assertion, verify false-green, restore.

## Migration Notes

No schema changes. All fixture data is created and destroyed within each test run.

## References

- Risk #2 definition and anti-patterns: `context/foundation/test-plan.md §2`
- RLS policies: `supabase/migrations/20260605000002_standup_entries.sql:13-26`
- workspace_member schema and policies: `supabase/migrations/20260604000000_workspace_member_schema.sql:14-99`
- Dropped member INSERT policy: `supabase/migrations/20260606000001_drop_stale_workspace_member_insert_policy.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Supabase Test Helper

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Type checking passes: `npm run build`

#### Manual

- [x] 1.3 Helper imports cleanly from another test file without Vitest errors

### Phase 2: Data Isolation Test File

#### Automated

- [ ] 2.1 All 5 tests pass with local Supabase running: `npm test`
- [ ] 2.2 Suite is skipped (not failed) when Supabase is not running: `npm test` exits 0 with skip notice
- [ ] 2.3 Lint passes: `npm run lint`

#### Manual

- [ ] 2.4 Run with `npx supabase start` active — confirm 5 green tests in output
- [ ] 2.5 Stop Supabase, re-run — confirm suite skipped, overall run green
- [ ] 2.6 Confidence check: service-role swap produces false-green, confirming RLS is actually being exercised

### Phase 3: test-plan.md §6.3

#### Manual

- [ ] 3.1 §6.3 is self-sufficient — new RLS test can be added without reading the standup test file
