# Standup Submission and History Implementation Plan

## Overview

S-03 adds the core standup logging loop: a member can submit a daily standup (did + plan required, blockers optional), see their past entries in a history list, and track their consecutive-business-day streak. This slice is the prerequisite for S-04 (blocker detection) and S-05 (team feed) and lands the product's primary value loop end-to-end for the first time.

## Current State Analysis

Auth and workspace foundation are complete (S-01, F-01). The middleware populates `context.locals.user`, `context.locals.workspace`, and `context.locals.workspaceMember` on every non-API request. The dashboard (`src/pages/dashboard.astro`) is a stub showing workspace name, role, and sign-out — no standup UI.

`src/lib/streak.ts` exists as a stub that throws `"not yet implemented"`. Seven unit tests in `src/__tests__/streak.test.ts` define the exact contract `calculateStreak` must satisfy. `src/lib/blocker.ts` is a separate stub for S-04 and must not be modified here. No `standup_entries` table or `StandupEntry` type exists yet. The `workspace` and `workspace_member` tables and their SECURITY DEFINER helpers (`auth_user_workspace_id`, `auth_user_is_team_lead`) are already in place.

The `workspace_invitation` migration (`20260605000000`) is the most recent migration. Middleware skips workspace context loading for `/api/*` routes — the submit API must query `workspace_member` itself to obtain `workspace_id`.

## Desired End State

A logged-in member lands on `/dashboard`, sees their streak badge and a standup submission form. They fill in did + plan (required) and optional blockers, submit, and land back on the dashboard where their submitted entry is shown read-only in place of the form. Their streak counter increments. The history list below shows their last 30 entries (newest first). Submitting a second standup on the same day shows an inline error. `npm test` passes (streak tests unblocked).

### Key Discoveries

- `context.locals.workspace` is `null` inside `/api/*` routes (middleware line 23 guards workspace loading behind `!pathname.startsWith("/api")`). The submit API must query `workspace_member` for `workspace_id`.
- The `auth_user_workspace_id()` SECURITY DEFINER function is already in place and is reused in the new INSERT policy — no new helper functions needed.
- `src/__tests__/streak.test.ts` already exists with 7 test cases, including a timezone-boundary pair (test cases 6a/6b). The streak stub will be replaced in Phase 2; `npm test` will exit 0 only after Phase 2 lands.
- The `workspace.alert_threshold` column (default 2) already exists — S-04 will consume it via `shouldSuggestBlockerMatch`. No schema change needed for that field.
- Existing form components (`FormField`, `SubmitButton`, `ServerError`) are for single-line inputs. The standup form uses `<textarea>` elements styled directly in `StandupForm.tsx` — no extension of `FormField` needed.
- The `?error=` redirect pattern (established by `workspace/create.ts` and `WorkspaceSetupForm.tsx`) is the correct mechanism for surfacing server errors in the React form island.

## What We're NOT Doing

- No edit or delete of submitted entries — FR-007/FR-008 are S-06 scope; entries are immutable in MVP.
- No pagination — PRD FR-009: flat list, last 30 entries displayed. The query fetches 60 entries so streak calculation covers up to 60 consecutive days; only the first 30 are shown in the history list.
- No full-text search — FR-010 deferred to v2; date-ordered history is sufficient for v1.
- No Team Lead visibility of members' entries — SELECT policy for team leads is S-05 scope.
- No streak milestone messaging beyond "Day N" — the habit mechanic is the badge itself.
- No server-side local timezone resolution — the client sends the local date in the POST (via `new Date().toLocaleDateString("sv")`); the dashboard load uses the UTC date for the "today check" (acceptable approximation; mismatch only for users in extreme timezone offsets near midnight). A side effect: an authenticated user can POST any valid YYYY-MM-DD string as `submitted_date`. The UNIQUE constraint prevents double-posting the same date, but not deliberate backfilling. Accepted at MVP scope (personal productivity tool; streak integrity is user-trust-dependent). If leaderboards or public streaks ship, revisit.

## Implementation Approach

Three sequential phases. Phase 1 lays the schema and type foundation. Phase 2 adds pure server logic (streak implementation + submit API). Phase 3 assembles the dashboard UI, including data loading in the Astro frontmatter, the form component, and the history/streak display.

## Critical Implementation Details

**Middleware gap for API routes**: `context.locals.workspace` and `context.locals.workspaceMember` are `null` inside `/api/standup/submit` — middleware skips workspace loading for `/api/*` paths. The endpoint must query `workspace_member` itself (`.select("workspace_id").eq("user_id", user.id).maybeSingle()`) before inserting into `standup_entries`.

**Streak algorithm weekend-skip invariant**: the streak loop iterates entries sorted descending (newest first). When checking if `entries[i+1]` (the older entry) extends the streak, it must first verify that the older entry's date is a Mon–Fri business day — if it falls on a Saturday or Sunday, break immediately. This invariant is what makes test case 6b (`submitted_date = "2026-06-06"`, Saturday) correctly return 1 rather than 2.

---

## Phase 1: standup_entries migration + StandupEntry type

### Overview

Creates the `standup_entries` table with a UNIQUE (user_id, submitted_date) constraint, RLS policies, and an index. Adds `StandupEntry` to `src/types.ts` to give downstream phases a typed representation.

### Changes Required

#### 1. standup_entries migration

**File**: `supabase/migrations/20260605000002_standup_entries.sql`

**Intent**: Define the `standup_entries` table, enable RLS, and add the two policies that cover member self-service (read own entries, write own entries). Team Lead read-all policy is S-05 scope and deliberately omitted here. The INSERT policy reuses the existing `auth_user_workspace_id()` SECURITY DEFINER helper — no new helper functions needed.

**Contract**:

```sql
CREATE TABLE standup_entries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspace(id)     ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  submitted_date date        NOT NULL,
  did            text        NOT NULL,
  plan           text        NOT NULL,
  blockers       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, submitted_date)
);

ALTER TABLE standup_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view own standup entries"
  ON standup_entries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "members can insert own standup entries"
  ON standup_entries FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND workspace_id = auth_user_workspace_id()
  );

-- UPDATE / DELETE: no policies — entries are immutable in MVP (FR-007/FR-008 cut from S-03)

CREATE INDEX standup_entries_user_date_idx
  ON standup_entries (user_id, submitted_date DESC);
```

#### 2. StandupEntry type

**File**: `src/types.ts`

**Intent**: Add `StandupEntry` so the submit API, dashboard data loading, and history display share a single typed representation of the DB row.

**Contract**: Append to the existing exports:

```typescript
export interface StandupEntry {
  id: string;
  workspace_id: string;
  user_id: string;
  submitted_date: string; // 'YYYY-MM-DD' — the user's local business date
  did: string;
  plan: string;
  blockers: string | null;
  created_at: string;
}
```

### Success Criteria

#### Automated Verification

- `npx supabase db reset` applies all migrations without errors
- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Supabase Studio → Table Editor shows `standup_entries` with correct columns and the `UNIQUE (user_id, submitted_date)` constraint
- Authentication → Policies shows 2 policies on `standup_entries` (SELECT, INSERT)
- SQL Editor: authenticated member can INSERT an entry and SELECT it back; a second INSERT with the same `(user_id, submitted_date)` returns a unique-constraint violation (error code 23505)
- SQL Editor: anon SELECT on `standup_entries` returns 0 rows (RLS blocks unauthenticated access)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: calculateStreak + submit API

### Overview

Replaces the `calculateStreak` stub with the real Mon–Fri business-day streak algorithm (unblocking the 7 streak unit tests), and adds the `POST /api/standup/submit` endpoint that validates, checks for duplicates, and persists a standup entry.

### Changes Required

#### 1. calculateStreak implementation

**File**: `src/lib/streak.ts`

**Intent**: Replace the stub with a Mon–Fri streak algorithm. Entries are sorted descending (newest first); the function counts how many consecutive business-day pairs extend backwards from `entries[0]`. Weekend gaps between Friday and Monday are invisible (they don't break the streak). A Saturday or Sunday `submitted_date` in the older-entry position breaks the streak immediately.

**Contract**: Replace the entire file. The algorithm:

```typescript
export function calculateStreak(entries: readonly { submitted_date: string }[]): number {
  if (entries.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < entries.length - 1; i++) {
    const newer = new Date(entries[i].submitted_date + "T00:00:00Z");
    const older = new Date(entries[i + 1].submitted_date + "T00:00:00Z");
    const olderDay = older.getUTCDay(); // 0=Sun, 6=Sat
    if (olderDay === 0 || olderDay === 6) break;
    if (!isImmediateNextBizDay(older, newer)) break;
    count++;
  }
  return count;
}

function isImmediateNextBizDay(prev: Date, next: Date): boolean {
  const d = new Date(prev);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return (
    d.getUTCFullYear() === next.getUTCFullYear() &&
    d.getUTCMonth() === next.getUTCMonth() &&
    d.getUTCDate() === next.getUTCDate()
  );
}
```

The snippet is here because the weekend-skip on the older entry (line `if (olderDay === 0 || olderDay === 6) break`) is the non-obvious invariant that makes test case 6b pass — without it, Sat→Mon (with one intervening skip) would incorrectly return 2.

#### 2. Standup submit API endpoint

**File**: `src/pages/api/standup/submit.ts` (new file)

**Intent**: Accept a standup form POST, validate fields with Zod, look up the user's `workspace_id` from `workspace_member` (required because middleware skips workspace loading for API routes), insert into `standup_entries`, and redirect back to `/dashboard`. On duplicate-day submission (DB error code `"23505"`), redirect with a user-readable error. All other errors redirect with the raw message.

**Contract**: Exports `POST`. Accepts FormData with fields: `did` (required), `plan` (required), `blockers` (optional, may be empty string), `submitted_date` (required, `YYYY-MM-DD` format). Zod schema:

```typescript
const schema = z.object({
  did: z.string().min(1, "What you did is required"),
  plan: z.string().min(1, "Plan for today is required"),
  blockers: z.string().optional().nullable(),
  submitted_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
});
```

Auth guard: check `context.locals.user` (populated by middleware even for API routes). Workspace lookup: `.from("workspace_member").select("workspace_id").eq("user_id", user.id).maybeSingle()` — redirect to `/workspace/setup` if null. Duplicate detection: if `supabase.from("standup_entries").insert(...)` returns `error.code === "23505"`, redirect to `/dashboard?error=` + `encodeURIComponent("You already submitted a standup today.")`. Success redirect: `/dashboard`.

Treat an empty `blockers` string as `null` before inserting: `blockers: result.data.blockers?.trim() || null`.

### Success Criteria

#### Automated Verification

- `npm test` exits 0 (all 7 streak unit tests pass)
- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- POST to `/api/standup/submit` with valid `did`, `plan`, and `submitted_date` creates a row in Supabase Studio
- POST with the same `submitted_date` a second time redirects to `/dashboard?error=You%20already%20submitted%20a%20standup%20today.`
- POST without `did` or `plan` redirects with a validation error message
- POST without an auth session redirects to `/auth/signin`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Dashboard UI

### Overview

Updates `dashboard.astro` to load standup data server-side (last 30 entries + streak + today's entry check) and renders three new sections: a streak badge, a standup submission form (or today's entry read-only), and a history list. The layout expands from the current narrow single-card to a wider two-section page.

### Changes Required

#### 1. StandupForm React island

**File**: `src/components/standup/StandupForm.tsx` (new file)

**Intent**: Client-side React form for standup submission. Follows the same patterns as `WorkspaceSetupForm.tsx` — posts to an API route, surfaces server errors via `ServerError`, uses `SubmitButton` for loading state. Uses `<textarea>` elements (not `FormField` — that component is for single-line inputs) styled with matching Tailwind classes.

**Contract**: Props: `{ error?: string | null }`. Three fields:
- `did` — `<textarea>`, required, label "What did you do?", client-side validation: non-empty
- `plan` — `<textarea>`, required, label "What will you do today?", client-side validation: non-empty
- `blockers` — `<textarea>`, optional, label "Any blockers? (optional)"

Hidden field: `submitted_date` populated client-side as `new Date().toLocaleDateString("sv")` — `"sv"` locale produces `YYYY-MM-DD` in the user's local timezone. This is the storage contract documented in `test-phase-3` plan: S-03 is responsible for sending the user's local date, not the UTC date.

`onSubmit` prevents submission and sets inline errors if `did` or `plan` are empty (no network round-trip). `method="POST"`, `action="/api/standup/submit"`. Render `<ServerError message={error} />` from `@/components/auth/ServerError` if `error` is truthy.

#### 2. Dashboard page — full standup integration

**File**: `src/pages/dashboard.astro`

**Intent**: Add server-side standup data loading to the frontmatter, expand the layout to a wider container, and render three standup sections: streak badge, form-or-today-entry, and history list. Preserve the existing workspace name / role / email / sign-out header.

**Contract**: Frontmatter additions (after existing locals destructuring):

```typescript
import { createClient } from "@/lib/supabase";
import { calculateStreak } from "@/lib/streak";
import type { StandupEntry } from "@/types";
import StandupForm from "@/components/standup/StandupForm";

// createClient needed here: middleware loads workspace context only; standup data requires a fresh client.
const supabase = createClient(Astro.request.headers, Astro.cookies);
let recentEntries: StandupEntry[] = [];
let todayEntry: StandupEntry | null = null;

if (supabase) {
  const today = new Date().toISOString().slice(0, 10); // UTC date — close enough for dashboard load
  const { data } = await supabase
    .from("standup_entries")
    .select("*")
    .eq("user_id", user!.id)
    .order("submitted_date", { ascending: false })
    .limit(60); // 60 for streak accuracy; history displays only first 30
  recentEntries = (data as StandupEntry[]) ?? [];
  todayEntry = recentEntries.find((e) => e.submitted_date === today) ?? null;
}

const streak = calculateStreak(recentEntries); // uses all 60 entries
const displayEntries = recentEntries.slice(0, 30); // history list shows last 30
const submitError = Astro.url.searchParams.get("error");
```

Template structure (replacing the current narrow card):

```
<Layout>
  <div class="bg-cosmic min-h-screen p-6">
    <!-- Header card: workspace name, role badge, email, sign-out -->
    <header> ... (existing content, unchanged) </header>

    <main class="mx-auto mt-6 max-w-2xl space-y-6">

      <!-- Streak badge -->
      <div> 🔥 Day {streak} (hidden if streak === 0) </div>

      <!-- Form OR today's entry -->
      {todayEntry ? (
        <!-- Read-only today's entry: show did/plan/blockers with a "Submitted today ✓" badge -->
      ) : (
        <StandupForm error={submitError} client:load />
      )}

      <!-- History list (if displayEntries.length > 0) -->
      <section>
        {displayEntries.map((entry) => (
          <!-- Entry card: submitted_date, did, plan, blockers -->
        ))}
      </section>

    </main>
  </div>
</Layout>
```

Keep the outer layout class `bg-cosmic` (existing cosmic/glassmorphism). Use `max-w-2xl` for the content area. Streak badge: show only when `streak > 0`. History list: iterate `displayEntries` (the first 30 of the 60 fetched), show only when `displayEntries.length > 0`. Today's entry read-only view: include the `submitted_date`, did, plan, and blockers (if present) in styled card with a "Submitted ✓" indicator.

### Success Criteria

#### Automated Verification

- `npm run build` passes with no TypeScript errors
- `npm run lint` passes

#### Manual Verification

- Dashboard shows the standup form when no entry has been submitted today
- Submitting a valid standup redirects back to `/dashboard` and shows the read-only entry in place of the form
- Refreshing `/dashboard` after submission still shows the read-only entry (durability check per PRD guardrail)
- Streak badge shows "🔥 Day 1" after first submission, "🔥 Day 2" after two consecutive business-day submissions
- Streak is hidden (or shows "Day 0") before any entry is submitted
- Submitting a second standup on the same day shows "You already submitted a standup today." inline error
- History list shows the submitted entry after first submission; grows with each subsequent day's entry
- All three fields (did, plan, blockers) appear in the read-only today entry view and in history cards
- Blank `did` or `plan` shows a client-side inline error without a network round-trip

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next slice.

---

## Testing Strategy

### Unit Tests

- `src/__tests__/streak.test.ts` already contains all 7 test cases. Phase 2 must make them pass — `npm test` exiting 0 is an automated criterion for Phase 2.

### Manual Testing Steps

1. `npx supabase start` → `npx supabase db reset` (picks up all migrations including the new one)
2. Verify `standup_entries` table + 2 RLS policies in Supabase Studio
3. Register / log in as a member → workspace setup → land on dashboard
4. Confirm standup form is visible (no entry today)
5. Submit empty `did` — confirm inline validation error without page reload
6. Submit valid standup → confirm redirect to dashboard, read-only today entry shown, streak shows "🔥 Day 1"
7. Refresh `/dashboard` — confirm read-only entry persists (PRD durability guardrail)
8. Attempt second submission on same day → confirm "You already submitted a standup today." error shown
9. Supabase Studio → confirm exactly 1 row in `standup_entries` with correct `submitted_date`, `did`, `plan`, `workspace_id`
10. Check `blockers` is `null` when left blank; non-null when filled
11. Submit a second entry on the next business day → confirm streak increments to "🔥 Day 2"

## Migration Notes

The `standup_entries` migration (`20260605000002`) follows the same pattern as the prior two migrations. No changes to `supabase/config.toml` — timestamped migrations are auto-discovered. No new SECURITY DEFINER helpers needed; the INSERT policy reuses the existing `auth_user_workspace_id()` from `20260604000000`.

S-05 will add a Team Lead SELECT policy on `standup_entries` (to make all members' entries readable for the team feed). S-04 (blocker detection) operates on the member's own entries and requires no new SELECT policy. The `blocker_alerts` table is S-04 scope — not part of this migration.

## References

- Binding function contracts: `context/changes/test-phase-3/plan.md` §Binding Function Contracts
- Streak unit tests: `src/__tests__/streak.test.ts`
- Prior patterns: `src/pages/api/workspace/create.ts` (middleware gap for API routes, redirect pattern)
- Prior patterns: `src/components/workspace/WorkspaceSetupForm.tsx` (form component structure)
- PRD: FR-006, FR-009, FR-011, US-01, guardrail "submitted standup is durable"
- Roadmap: S-03 (`context/foundation/roadmap.md`)
- Lessons: `context/foundation/lessons.md` — VOLATILE guard functions, GitHub issue closure rule

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: standup_entries migration + StandupEntry type

#### Automated

- [x] 1.1 npx supabase db reset applies migration without errors — 160c206
- [x] 1.2 npm run build passes — 160c206
- [x] 1.3 npm run lint passes — 160c206

#### Manual

- [x] 1.4 standup_entries table exists in Supabase Studio with correct columns and UNIQUE constraint — 160c206
- [x] 1.5 2 RLS policies visible on standup_entries (SELECT, INSERT) — 160c206
- [x] 1.6 Authenticated member can INSERT an entry and SELECT it back; second INSERT with same (user_id, submitted_date) returns 23505 — 160c206
- [x] 1.7 Anon SELECT on standup_entries returns 0 rows — 160c206

### Phase 2: calculateStreak + submit API

#### Automated

- [x] 2.1 npm test exits 0 (all 7 streak unit tests pass) — 12f9d1c
- [x] 2.2 npm run build passes — 12f9d1c
- [x] 2.3 npm run lint passes — 12f9d1c

#### Manual

- [x] 2.4 POST to /api/standup/submit with valid fields creates a row in Supabase Studio — 12f9d1c
- [x] 2.5 POST with duplicate submitted_date redirects to /dashboard?error=You%20already%20submitted%20a%20standup%20today. — 12f9d1c
- [x] 2.6 POST without did or plan redirects with a validation error — 12f9d1c
- [x] 2.7 POST without auth session redirects to /auth/signin — 12f9d1c

### Phase 3: Dashboard UI

#### Automated

- [x] 3.1 npm run build passes with no TypeScript errors — 303e4d7
- [x] 3.2 npm run lint passes — 303e4d7

#### Manual

- [x] 3.3 Dashboard shows standup form when no entry submitted today — 303e4d7
- [x] 3.4 Valid submission redirects to /dashboard; read-only entry shown in place of form — 303e4d7
- [x] 3.5 Refreshing /dashboard after submission shows read-only entry (durability check) — 303e4d7
- [x] 3.6 Streak badge shows 🔥 Day 1 after first submission — 303e4d7
- [x] 3.6a Streak is hidden before any entry is submitted — 303e4d7
- [x] 3.6b Streak badge shows 🔥 Day 2 after two consecutive business-day submissions
- [x] 3.7 Submitting same day twice shows "You already submitted a standup today." inline error — 303e4d7
- [x] 3.8 History list shows submitted entry; grows with each subsequent submission — 303e4d7
- [x] 3.9 Blank did or plan shows client-side inline error without network round-trip — 303e4d7
- [x] 3.10 All three fields (did, plan, blockers) appear in read-only entry view and history cards — 303e4d7
