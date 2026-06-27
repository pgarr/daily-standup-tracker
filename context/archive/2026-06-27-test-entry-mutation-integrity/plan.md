# Entry Mutation Integrity Tests Implementation Plan

## Overview

Add a Playwright E2E spec (`e2e/entry-mutation-integrity.spec.ts`) that proves three invariants introduced by S-06 (standup-entry-edit-delete): (1) deleting a standup entry correctly removes it from the streak-input array, (2) a confirmed blocker alert is not cascade-deleted when its associated entry is removed, and (3) cross-user UPDATE/DELETE is blocked by RLS at the database layer.

## Current State Analysis

S-06 shipped the edit/delete feature. The HTTP-layer IDOR ownership guard was covered as finding F6 during the S-06 impl-review and lives in `e2e/standup-edit-delete.spec.ts` (the "ownership guard" test). Two invariants from GitHub issue #11 remain unproven by automated tests:

- **Streak-recalculation contract**: `calculateStreak()` is pure and unit-tested (`src/__tests__/streak.test.ts`), but no integration test verifies that the delete API actually removes the correct row from the DB so the streak-input array is correct on the next dashboard load.
- **Alert-orphaning contract**: `blocker_alerts` has no FK to `standup_entries` by design (documented in the S-06 plan: "Deleting an entry leaves any confirmed alert orphaned but visible. This is the accepted design choice."). No test currently asserts this contract is preserved.
- **RLS write-path IDOR**: The `standup-edit-delete.spec.ts` ownership test exercises the HTTP layer (application-level `user_id` filter). No test exercises the RLS layer directly (what Supabase actually blocks when a user with the wrong JWT tries to mutate a row).

Key constraints:

- `standup_entries` UNIQUE constraint: `(user_id, submitted_date)` — each test-run user gets fresh entries; no collisions across parallel runs.
- `blocker_alerts` `workspace_id` column has `ON DELETE CASCADE` to `workspace` — alert rows are cleaned up automatically when the workspace is deleted in `afterAll`. No explicit alert cleanup needed.
- `createUserClient(accessToken)` in `src/__tests__/helpers/supabase-test.ts` creates a Supabase client that enforces RLS for a given user JWT, enabling direct DB-layer tests without the HTTP server.
- `createSignInClient()` returns an anon-key Supabase client suitable for calling `.auth.signInWithPassword()` to obtain a user-scoped JWT.

### Key Discoveries

- Streak input is `recentEntries` (all entries up to 60, ordered `submitted_date DESC`), computed at `src/pages/dashboard.astro:61` via `calculateStreak(recentEntries)`.
- `blocker_alerts` schema: `(id, workspace_id, user_id, trigger_date, status, created_at)` — `status IN ('confirmed', 'dismissed')`. No FK to `standup_entries`. Source: `supabase/migrations/20260607000000_blocker_alerts.sql`.
- HTTP-layer IDOR already covered: `e2e/standup-edit-delete.spec.ts` — "ownership guard" test (added in F6 triage).
- Test helper exports: `isSupabaseRunning`, `createServiceClient`, `createUserClient`, `createSignInClient` — all in `src/__tests__/helpers/supabase-test.ts`.
- Existing serial spec pattern: `e2e/standup-edit-delete.spec.ts` — `test.describe.serial`, `shouldSkip = true` flipped in `beforeAll`, `getCtx()` helper that throws if context uninitialised.

## Desired End State

`npx playwright test entry-mutation-integrity` outputs **3 skipped** when Supabase is not running and **3 passed** when run against a local Supabase instance with the dev server. No new API routes, no UI changes.

## What We're NOT Doing

- Not parsing the dashboard HTML to verify the rendered streak number — the `calculateStreak` unit tests cover the math; this spec covers the DB state.
- Not going through the blocker-confirmation UI flow to create the alert — direct service-client insertion is sufficient and avoids S-04 dependency.
- Not duplicating the HTTP-layer IDOR test from `standup-edit-delete.spec.ts` — the RLS-layer test is additive, not a repeat.
- Not adding Vitest integration tests — the Playwright file handles both HTTP-flow and direct-DB assertions; a second test runner adds no value here.
- Not testing UPDATE (edit) for streak impact — editing changes `did/plan/blockers` only, never `submitted_date`; no streak effect is possible.

## Implementation Approach

Single Playwright spec file, `test.describe.serial`, three tests. Fixture setup creates two users (member A and member B), one workspace, three consecutive standup entries for member A (Mon/Tue/Wed), and one confirmed `blocker_alerts` row for member A. Tests run in order: delete the head entry (Wed) in test 1, then delete the Tue entry in test 2, leaving the Mon entry for test 3's RLS assertion. `afterAll` cleans up remaining entries, workspace (cascades alerts + member rows), and both auth users.

---

## Phase 1: Playwright spec — entry-mutation-integrity

### Overview

Create `e2e/entry-mutation-integrity.spec.ts` with three serial tests covering streak recalculation, alert orphaning, and RLS write-path IDOR at the DB layer.

### Changes Required

#### 1. New E2E spec file

**File**: `e2e/entry-mutation-integrity.spec.ts`

**Intent**: Prove the three mutation-integrity invariants described above. Uses the established `shouldSkip + isSupabaseRunning()` pattern, `test.describe.serial`, and pre-generated UUIDs for all inserted rows.

**Contract**:

Module-scope state:
```
shouldSkip: boolean (true until beforeAll)
memberCtx: request.newContext result | undefined
memberId, otherMemberId, workspaceId: string (empty until beforeAll)
entryIdMon, entryIdTue, entryIdWed: string (set in beforeAll; zeroed after each test deletes its row)
alertId: string (set in beforeAll; cascade-deleted with workspace in afterAll)
```

Imported helpers: `isSupabaseRunning`, `createServiceClient`, `createUserClient`, `createSignInClient` from `../src/__tests__/helpers/supabase-test`.

Constants:
- `ORIGIN = "http://localhost:4321"`
- Emails timestamped: `` `mutation-member-${ts}@example.com` `` and `` `mutation-other-${ts}@example.com` ``
- Entry dates: `"2020-01-06"` (Mon), `"2020-01-07"` (Tue), `"2020-01-08"` (Wed) — provably consecutive business days, no weekend gap.

`beforeAll`:
1. `isSupabaseRunning()` — return early (shouldSkip stays true) if false.
2. Create member user via `svc.auth.admin.createUser({ email_confirm: true })`.
3. Create workspace (pre-generated UUID) and workspace_member row for member.
4. Sign in member via `request.newContext` + `POST /api/auth/signin`.
5. Insert three `standup_entries` rows with pre-generated UUIDs and dates "2020-01-06", "2020-01-07", "2020-01-08".
6. Insert one `blocker_alerts` row with `status: "confirmed"` and `trigger_date: "2020-01-07"` directly via service client.
7. Create second user (other member) + workspace_member row (no HTTP context needed; only used for RLS DB call in test 3).

`afterAll`:
- Delete remaining entries by ID (guard each with `if (entryId)`).
- Delete workspace (cascades: workspace_member, blocker_alerts).
- Delete both auth users.
- Dispose memberCtx.

**Test 1 — `streak recalculates — deleting the most recent entry removes it from the streak-input array`**:
- `test.skip(shouldSkip, ...)` as first line.
- HTTP POST `/api/standup/delete` with `form: { id: entryIdWed }`, `headers: { Origin: ORIGIN }`, `maxRedirects: 0`.
- Assert `resp.status() === 302` and `resp.headers().location` contains `success=entry_deleted`.
- Service client SELECT `submitted_date` from `standup_entries` WHERE `user_id = memberId` ORDER BY `submitted_date DESC`.
- Assert result has exactly 2 rows: `["2020-01-07", "2020-01-06"]` — this is the input `calculateStreak` will receive on the next dashboard load, producing a streak of 2.
- Set `entryIdWed = ""`.

**Test 2 — `alert not orphaned — confirmed blocker_alert survives deletion of its associated entry`**:
- `test.skip(shouldSkip, ...)` as first line.
- Service client SELECT `id` from `blocker_alerts` WHERE `id = alertId` — assert row exists before delete.
- HTTP POST `/api/standup/delete` with `form: { id: entryIdTue }`, `headers: { Origin: ORIGIN }`, `maxRedirects: 0`.
- Assert `resp.status() === 302`.
- Service client SELECT `id` from `blocker_alerts` WHERE `id = alertId` — assert row still exists after delete (`blocker_alerts` has no FK to `standup_entries`).
- Set `entryIdTue = ""`.

**Test 3 — `write-path IDOR — RLS blocks cross-user UPDATE and DELETE at the database layer`**:
- `test.skip(shouldSkip, ...)` as first line.
- Sign in `otherMember` via `createSignInClient().auth.signInWithPassword({ email: OTHER_MEMBER_EMAIL, password: PASSWORD })`.
- Create `otherClient = createUserClient(session.access_token)`.
- UPDATE attempt: `otherClient.from("standup_entries").update({ did: "hacked" }, { count: "exact" }).eq("id", entryIdMon)` — assert `count === 0` and `error === null` (RLS silently drops, no error).
- DELETE attempt: `otherClient.from("standup_entries").delete({ count: "exact" }).eq("id", entryIdMon)` — assert `count === 0`.
- Service client verify `entryIdMon` still exists with original `did` value (Mon entry untouched).

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint` — 0 errors (no `any` types, no deprecated Zod forms, no unused vars).
- Build passes: `npm run build` — clean.
- Spec skips gracefully without Supabase: `npx playwright test entry-mutation-integrity --reporter=list` — 3 skipped (requires local Supabase; CI never has it running).

#### Manual Verification

- With `npx supabase start` and `npm run dev` running: `npx playwright test entry-mutation-integrity --reporter=list` → 3 passed.
- No fixture leftovers in local Supabase after the run (workspace, users, entries all cleaned up).

**Implementation Note**: After all automated verification passes, pause for manual confirmation before proceeding to the commit step.

---

## Testing Strategy

### What these tests cover

| Invariant | Test | Verification method |
|-----------|------|---------------------|
| Delete removes the correct row | Test 1 | DB SELECT — remaining rows match expected streak input |
| Alert not cascade-deleted on entry delete | Test 2 | DB SELECT before and after delete |
| RLS blocks cross-user UPDATE at DB layer | Test 3 | Direct Supabase client with user-B JWT; count = 0 |
| RLS blocks cross-user DELETE at DB layer | Test 3 | Direct Supabase client with user-B JWT; count = 0 |

### What is NOT covered here (already covered elsewhere)

| Invariant | Where covered |
|-----------|---------------|
| HTTP-layer IDOR ownership guard | `e2e/standup-edit-delete.spec.ts` — "ownership guard" test |
| `calculateStreak` math correctness | `src/__tests__/streak.test.ts` — 8 unit tests |
| Edit/delete API auth guard | `e2e/standup-edit-delete.spec.ts` — "auth guard" test |

## References

- GitHub issue: #11 — [T-5] Entry mutation integrity
- Related spec: `e2e/standup-edit-delete.spec.ts` (HTTP-layer IDOR + happy paths)
- Test helpers: `src/__tests__/helpers/supabase-test.ts`
- Blocker alerts schema: `supabase/migrations/20260607000000_blocker_alerts.sql`
- RLS policies: `supabase/migrations/20260627000001_standup_entry_edit_delete.sql`, `20260627000002_standup_entries_update_policy_workspace.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Playwright spec — entry-mutation-integrity

#### Automated Verification

- [x] 1.1 Lint passes (npm run lint — 0 errors) — 51e8208
- [x] 1.2 Build passes (npm run build — clean) — 51e8208
- [x] 1.3 Spec skips gracefully without Supabase (npx playwright test entry-mutation-integrity — 3 skipped) — 51e8208

#### Manual Verification

- [x] 1.4 3 tests pass with local Supabase + dev server running — 51e8208
- [x] 1.5 No fixture leftovers after test run — 51e8208
