# Standup Entry Edit & Delete Implementation Plan

## Overview

Add the ability for members to edit or delete any of their own previously submitted standup entries. The feature covers a new Supabase migration (UPDATE/DELETE RLS policies), two new API routes, and a React island replacing the current static Astro history list, supported by a streak unit test and E2E API tests.

## Current State Analysis

The `standup_entries` table was intentionally left immutable in S-03 — the migration comment at line 28 reads "entries are immutable in MVP (FR-007/FR-008 cut from S-03)". No UPDATE or DELETE RLS policies exist today. Entry IDs are fetched via `select("*")` on the dashboard but are never surfaced in the UI. The history list (dashboard.astro lines 187–228) is a pure Astro template with no interactive state.

Key constraints discovered:
- `blocker_alerts` has no FK to `standup_entries` — links only via `user_id + trigger_date`. Deleting an entry leaves any confirmed alert orphaned but visible. This is the accepted design choice.
- Streak is computed on-demand from the in-memory array in `calculateStreak()` (`src/lib/streak.ts`). No cached column; post-delete streak is naturally recomputed on the next dashboard load.
- The `route-coverage.test.ts` (`src/__tests__/route-coverage.test.ts`) enforces that every new route under `src/pages/api/` appears in `EXPLICIT_PUBLIC_ROUTES` with an inline-guard comment.

### Key Discoveries

- `standup_entries` schema: `supabase/migrations/20260605000002_standup_entries.sql`
- Streak logic (pure, no DB): `src/lib/streak.ts`
- Dashboard data fetch + history template: `src/pages/dashboard.astro:26–62`, `187–228`
- Existing mutation API pattern: `src/pages/api/standup/submit.ts` (POST, CSRF check, Zod, redirect)
- Route coverage guard: `src/__tests__/route-coverage.test.ts:12–27`
- Streak unit tests: `src/__tests__/streak.test.ts`
- E2E fixture pattern: `e2e/global-setup.ts`

## Desired End State

A member opens the dashboard, scrolls to the history list, and sees "Edit" and "Delete" buttons on each entry card. Clicking "Edit" expands an inline form pre-populated with the entry's current content; saving redirects to `/dashboard?success=entry_updated` and the updated content is visible. Clicking "Delete" replaces the buttons with "Confirm delete" / "Cancel" inline; confirming redirects to `/dashboard?success=entry_deleted`, the entry is gone, and the streak counter reflects the deletion.

## What We're NOT Doing

- No edit/delete on the top "Today's standup" card — affordances live in the history list only.
- No re-triggering of blocker detection when editing blocker text. Edit is a content correction, not a new submission.
- No deletion of orphaned `blocker_alerts` when an entry is deleted. Alerts survive unchanged (loose coupling by design).
- No changing `submitted_date` on edit. Date is immutable; member must delete + resubmit to correct a date.
- No time-window restriction on which entries can be edited/deleted. Any own entry is mutable.

## Implementation Approach

Four sequential phases: lay the DB foundation first (RLS policies), then build the API routes on top of those policies, then build the React island that calls those routes, then add tests. Each phase can be verified independently before proceeding.

The edit form uses the same native form POST → server redirect pattern as all other mutations — no fetch/optimistic updates. The React island manages only the visual toggling state (which card is in edit mode, which is in delete-confirm mode); the actual data mutations are standard HTML form submissions. After any redirect, the dashboard SSR re-renders with fresh data, naturally recomputing the streak.

## Critical Implementation Details

**UPDATE policy scope**: The RLS UPDATE policy needs both `USING` (which rows the member can update) and `WITH CHECK` (what those rows can become after update). `USING: auth.uid() = user_id` guards reads; `WITH CHECK: auth.uid() = user_id AND workspace_id = auth_user_workspace_id()` prevents a hypothetical client from moving an entry to a different workspace. The API only passes `did/plan/blockers` in the SET clause, so `submitted_date` and `workspace_id` are never mutated.

**`blockers` null coercion**: The edit API must normalize empty string → `null` for the blockers column, identical to how `submit.ts:73` handles it. Failing to do so will store `""` in a nullable column that the rest of the codebase checks with `entry.blockers &&`.

---

## Phase 1: Database — UPDATE and DELETE RLS Policies

### Overview

Add a migration that creates the two missing RLS policies on `standup_entries`. This is the prerequisite for all API work.

### Changes Required

#### 1. New Supabase migration

**File**: `supabase/migrations/20260627000001_standup_entry_edit_delete.sql`

**Intent**: Add UPDATE and DELETE row-level-security policies so authenticated members can mutate only their own `standup_entries` rows, unblocking the API routes in Phase 2.

**Contract**: Two `CREATE POLICY` statements on `standup_entries`:
- `"members can update own standup entries"` — `FOR UPDATE TO authenticated`, `USING (auth.uid() = user_id)`, `WITH CHECK (auth.uid() = user_id AND workspace_id = auth_user_workspace_id())`
- `"members can delete own standup entries"` — `FOR DELETE TO authenticated`, `USING (auth.uid() = user_id)`

### Success Criteria

#### Automated Verification

- Migration applies cleanly against local Supabase: `npx supabase db reset` (or `npx supabase migration up`)
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- A member session can UPDATE their own row (verify via Supabase Studio or a direct client call with a member JWT)
- A member session cannot UPDATE another member's row (403 from PostgREST)
- A member session can DELETE their own row
- A member session cannot DELETE another member's row

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Backend — Update and Delete API Routes

### Overview

Two new POST routes under `src/pages/api/standup/`: `update.ts` and `delete.ts`. Both follow the established pattern from `submit.ts` and `invite-cancel.ts`: CSRF check, Zod parse, auth check, Supabase mutation with `count: "exact"`, redirect.

### Changes Required

#### 1. Route: `/api/standup/update`

**File**: `src/pages/api/standup/update.ts`

**Intent**: Accept a POST form submission with an entry ID and updated field values, validate ownership, apply the update, and redirect back to the dashboard.

**Contract**:
- `export const prerender = false`
- `export const POST`
- CSRF check first (validate Origin/Referer against `context.url.origin` — same guard as `submit.ts:23–32`)
- Auth check: `context.locals.user` — redirect to `/auth/signin` if missing
- Zod schema: `{ id: z.string().uuid(), did: z.string().min(1), plan: z.string().min(1), blockers: z.string().optional().nullable() }`
- Supabase UPDATE on `standup_entries` — SET `{ did, plan, blockers: blockers || null }` WHERE `id = parsed.id` AND `user_id = user.id`, with `{ count: "exact" }`
- If `count === 0`: redirect to `/dashboard?error=<encodeURIComponent("Entry not found")>`
- On success: redirect to `/dashboard?success=entry_updated`

#### 2. Route: `/api/standup/delete`

**File**: `src/pages/api/standup/delete.ts`

**Intent**: Accept a POST form submission with an entry ID, validate ownership, delete the row, and redirect back to the dashboard.

**Contract**:
- Same CSRF + auth structure as update.ts
- Zod schema: `{ id: z.string().uuid() }`
- Supabase DELETE from `standup_entries` WHERE `id = parsed.id` AND `user_id = user.id`, with `{ count: "exact" }`
- If `count === 0`: redirect to `/dashboard?error=<encodeURIComponent("Entry not found")>`
- On success: redirect to `/dashboard?success=entry_deleted`

#### 3. Route coverage test

**File**: `src/__tests__/route-coverage.test.ts`

**Intent**: Register the two new routes as intentionally public (inline-guarded) so the coverage test does not flag them as ungated.

**Contract**: Add two entries to `EXPLICIT_PUBLIC_ROUTES`:
- `"/api/standup/update"` with comment `// inline auth guard`
- `"/api/standup/delete"` with comment `// inline auth guard`

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Type checking passes: `npm run lint` (includes TS rules)
- Route coverage test passes: `npx vitest run route-coverage`

#### Manual Verification

- `POST /api/standup/update` with a valid owned entry ID updates the entry and redirects to `/dashboard?success=entry_updated`
- `POST /api/standup/update` with a non-existent ID redirects with `?error=Entry+not+found`
- `POST /api/standup/delete` with a valid owned entry ID deletes the entry and redirects to `/dashboard?success=entry_deleted`
- `POST /api/standup/delete` with a mismatched user (another member's entry) redirects with an error (RLS blocks the delete; count === 0)
- Unauthenticated POST to either route redirects to `/auth/signin`

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Frontend — StandupHistoryList React Island

### Overview

Replace the static Astro history list template with a React island that manages edit-expand and delete-confirm UI state per entry card. The form submissions use native HTML forms → POST → server redirect (no fetch), so the page reloads after any mutation and the streak/UI refresh automatically.

### Changes Required

#### 1. New React component

**File**: `src/components/standup/StandupHistoryList.tsx`

**Intent**: Render the entry history list with interactive edit and delete affordances, managing which card (if any) is in edit or delete-confirm mode.

**Contract**:
- Props: `entries: StandupEntry[]`, `blockerAlerts: BlockerAlert[]` (import both types from `@/types`)
- State: `editingId: string | null` and `deletingId: string | null`; setting either one clears the other
- Each entry card renders in one of three states:
  - **Default**: read-only display matching the current Astro template visual (date header, did/plan/blockers sections, recurring-blocker badge if alert exists for that `trigger_date` with status `"confirmed"`) plus "Edit" and "Delete" text buttons in the card header row
  - **Edit**: textareas pre-populated with `entry.did`, `entry.plan`, `entry.blockers ?? ""` for did/plan/blockers; client-side validation clears on change (did and plan required, same pattern as `StandupForm.tsx`); form `method="POST" action="/api/standup/update"` with hidden `<input name="id" value={entry.id} />`; "Save" submit button and "Cancel" button that resets `editingId`
  - **Delete-confirm**: replaces action buttons with "Confirm delete" (inside a `<form method="POST" action="/api/standup/delete">` with hidden `id` input) and "Cancel" button that resets `deletingId`
- Textarea and button styles reuse the same class strings as `StandupForm.tsx`

#### 2. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Swap the Astro history list for the new React island; expose entry IDs to it; and surface edit/delete success flash messages.

**Contract**:
- Import `StandupHistoryList` from `@/components/standup/StandupHistoryList`
- Add `const successMessage = Astro.url.searchParams.get("success");` alongside the existing `submitError` line (line 62)
- Map success values: `entry_updated` → `"Entry updated"`, `entry_deleted` → `"Entry deleted"` — render a success banner (green-toned, matching the existing "Submitted ✓" badge palette) above the standup section when a message is present
- Replace the `<!-- History list -->` block (lines 186–228) with `<StandupHistoryList entries={displayEntries} blockerAlerts={blockerAlerts} client:load />`
- `displayEntries` already contains full `StandupEntry` objects (including `id`) from `select("*")`; no query changes needed

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Type checking + lint passes: `npm run lint`

#### Manual Verification

- History list renders identically to the current design (date, did, plan, blockers, recurring-blocker badge)
- "Edit" button on a history card expands an inline form pre-filled with that entry's content; other cards remain unchanged
- Editing and saving an entry redirects to `/dashboard?success=entry_updated`; the updated content is visible in the history list and the success flash is shown
- "Delete" button on a card shows the inline confirm/cancel; cancelling restores the original card view
- Confirming delete redirects to `/dashboard?success=entry_deleted`; the entry is absent from the history list; the streak counter reflects the deletion
- Today's entry in the top "Today's standup" card is unchanged (read-only); its copy in the history list has edit/delete affordances
- No regressions in the blocker detection banner, streak display, or standup submission form

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Tests — Streak Unit Test + E2E API Tests

### Overview

Add a unit test documenting the delete-in-streak-middle behavior, and a Playwright API-level spec covering the edit and delete happy paths and the auth guard.

### Changes Required

#### 1. Streak unit test

**File**: `src/__tests__/streak.test.ts`

**Intent**: Document the behaviour of `calculateStreak` when the most-recent entry is removed (i.e., simulating a delete), confirming the streak recomputes from the new head. Add one test inside the existing `describe("calculateStreak")` block.

**Contract**: New test case — given entries `[Wed, Tue, Mon]` (streak = 3), when the array is reduced to `[Tue, Mon]` by removing the most-recent entry, `calculateStreak([Tue, Mon])` must return 2. This confirms streak drops correctly on deletion of the head entry without needing a DB fixture.

#### 2. E2E API spec

**File**: `e2e/standup-edit-delete.spec.ts`

**Intent**: Test the two new API routes end-to-end against the real Supabase stack (skipping gracefully when Supabase is not running, matching the existing E2E pattern).

**Contract**:
- Use `role-gating.spec.ts` as the template (not `middleware-gate.spec.ts` — that one has no Supabase dependency and omits the guard). Initialize `let shouldSkip = true` at module scope; flip to `false` in `beforeAll` only if `isSupabaseRunning()` passes; call `test.skip(shouldSkip, "Requires local Supabase + fixtures")` as the first line of every test.
- `beforeAll`: use `createServiceClient()` to create a dedicated test member user + workspace + workspace_member row (timestamp-suffixed, isolated from role-gate fixtures); sign in as that member via `request.newContext()` to get a session cookie; insert a standup entry directly via the service client (to avoid coupling to the submit API); store the `entryId`
- `afterAll`: clean up test users + workspace via service client; dispose request context
- Test 1 — edit happy path: POST to `/api/standup/update` with `{ id: entryId, did: "updated did", plan: "updated plan", blockers: "" }` and `Origin` header; assert redirect to `/dashboard` (302); fetch the entry via service client and assert `did === "updated did"` and `blockers === null`
- Test 2 — delete happy path: POST to `/api/standup/delete` with `{ id: entryId }` and `Origin` header; assert redirect to `/dashboard` (302); fetch the entry via service client and assert it no longer exists (null)
- Test 3 — auth guard: send POST to `/api/standup/delete` from an unauthenticated context; assert redirect to `/auth/signin` (302)

### Success Criteria

#### Automated Verification

- Vitest passes: `npx vitest run streak`
- Playwright E2E passes (with local Supabase running): `npx playwright test standup-edit-delete`
- Playwright E2E gracefully skips (without Supabase): all tests skip rather than fail
- Build passes: `npm run build`
- Full lint passes: `npm run lint`

#### Manual Verification

- `npx vitest run` — all existing streak tests still pass alongside the new one
- `npx playwright test` — no regressions in `middleware-gate` or `role-gating` specs

---

## Testing Strategy

### Unit Tests

- `calculateStreak` with head-entry removed (new): verifies post-delete streak recomputation
- All existing streak edge cases (gap in middle, weekend skip, timezone boundary) remain unchanged

### Integration Tests (E2E via Playwright)

- Edit entry — content persists in DB; blockers empty string → null
- Delete entry — row removed; count === 0 guard works
- Unauthenticated delete attempt → redirect to signin

### Manual Testing Steps

1. Submit a standup for today; verify it appears in the history list with Edit and Delete buttons
2. Click Edit on today's entry; clear the "What you did" field and click Save; verify the inline error fires and no redirect occurs
3. Fill both required fields; click Save; verify redirect to `/dashboard?success=entry_updated` and content updated in history
4. Scroll back through history; click Delete on an older entry; click Cancel; verify entry is still present
5. Click Delete again; click Confirm delete; verify redirect to `/dashboard?success=entry_deleted` and entry is absent
6. Delete the most recent entry; verify the streak counter decrements correctly
7. Delete an entry that has a confirmed recurring-blocker badge; verify the badge is gone from that entry slot (the entry itself is deleted) but no other entries are affected

## References

- Schema: `supabase/migrations/20260605000002_standup_entries.sql`
- Blocker alerts schema (no FK to standup_entries): `supabase/migrations/20260607000000_blocker_alerts.sql`
- Streak logic: `src/lib/streak.ts`
- Dashboard SSR page: `src/pages/dashboard.astro`
- Submit API (pattern reference): `src/pages/api/standup/submit.ts`
- Delete API (pattern reference): `src/pages/api/workspace/invite-cancel.ts`
- StandupForm (component pattern reference): `src/components/standup/StandupForm.tsx`
- Route coverage test: `src/__tests__/route-coverage.test.ts`
- Roadmap entry: `context/foundation/roadmap.md` (S-06)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — UPDATE and DELETE RLS Policies

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase
- [x] 1.2 Linting passes
- [x] 1.3 Build passes

#### Manual

- [x] 1.4 Member session can UPDATE their own row
- [x] 1.5 Member session cannot UPDATE another member's row
- [x] 1.6 Member session can DELETE their own row
- [x] 1.7 Member session cannot DELETE another member's row

### Phase 2: Backend — Update and Delete API Routes

#### Automated

- [ ] 2.1 Build passes
- [ ] 2.2 Type checking and lint passes
- [ ] 2.3 Route coverage test passes

#### Manual

- [ ] 2.4 POST /api/standup/update updates owned entry and redirects to success
- [ ] 2.5 POST /api/standup/update with non-existent ID redirects with error
- [ ] 2.6 POST /api/standup/delete deletes owned entry and redirects to success
- [ ] 2.7 POST /api/standup/delete for another member's entry redirects with error
- [ ] 2.8 Unauthenticated POST to either route redirects to signin

### Phase 3: Frontend — StandupHistoryList React Island

#### Automated

- [ ] 3.1 Build passes
- [ ] 3.2 Type checking and lint passes

#### Manual

- [ ] 3.3 History list renders identically to current design
- [ ] 3.4 Edit button expands inline form pre-filled with entry content
- [ ] 3.5 Edit save redirects to success; updated content visible; success flash shown
- [ ] 3.6 Delete cancel restores original card view
- [ ] 3.7 Delete confirm redirects to success; entry absent; streak updated
- [ ] 3.8 Today's top card unchanged; its history copy has affordances
- [ ] 3.9 No regressions in blocker banner, streak, or submission form

### Phase 4: Tests — Streak Unit Test + E2E API Tests

#### Automated

- [ ] 4.1 Vitest streak tests pass (new test + existing)
- [ ] 4.2 Playwright edit/delete spec passes with local Supabase
- [ ] 4.3 Playwright spec gracefully skips without Supabase
- [ ] 4.4 Build passes
- [ ] 4.5 Full lint passes

#### Manual

- [ ] 4.6 npx vitest run — no regressions in existing streak tests
- [ ] 4.7 npx playwright test — no regressions in middleware-gate or role-gating specs
