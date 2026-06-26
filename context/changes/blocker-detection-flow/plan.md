# Blocker Detection Flow (S-04) Implementation Plan

## Overview

Implement the blocker detection flow: detect similar consecutive blockers via Claude Haiku
(with Jaccard keyword fallback), surface a confirmation banner on the dashboard after each
qualifying standup submission, persist confirmed/dismissed outcomes in `blocker_alerts`, and
show alert badges in the member's history list.

## Current State Analysis

S-03 is complete and archived. `standup_entries` table, `calculateStreak`, and the dashboard
history list are all in place. The two stub functions (`isNextBusinessDay`,
`shouldSuggestBlockerMatch`) exist in `src/lib/blocker.ts` with the async contract already
locked in. `src/__tests__/blocker-detection.test.ts` has 11 tests gated behind
`describe.skipIf(!implemented)` — they will auto-un-skip when the stubs are replaced.

No `blocker_alerts` table exists. No Anthropic SDK is installed. No env schema entry for
`ANTHROPIC_API_KEY`.

The dashboard (`src/pages/dashboard.astro`) already fetches up to 60 `standup_entries` in
SSR frontmatter. `workspace.alert_threshold` (default: 2) is already in `Astro.locals.workspace`.
The submit API (`src/pages/api/standup/submit.ts`) always redirects to `/dashboard` on success.

### Key Discoveries

- `workspace.alert_threshold: number` is in `src/types.ts:6` and always present in `Astro.locals.workspace` — zero extra DB query needed for threshold
- `src/pages/dashboard.astro:17–31` fetches all recent entries during SSR; detection has its full data set without any additional queries
- `submit.ts:72` always redirects; never returns a JSON body — `?blocker_match=1` query param is the idiomatic trigger signal, consistent with `?error=...` at line 25
- `supabase/migrations/20260604000000_workspace_member_schema.sql` — `auth_user_workspace_id()` and `auth_user_is_team_lead()` SECURITY DEFINER helpers already exist and must be reused in `blocker_alerts` RLS policies
- `src/__tests__/blocker-detection.test.ts` stubs: `() => Promise.resolve(true)` / `() => Promise.resolve(false)` — the `describe.skipIf` guard checks `isNextBusinessDay` at module load; replacing the throw with a real return value un-skips all 11 tests
- `astro:env/server` pattern for secrets: `import { SUPABASE_URL } from "astro:env/server"` — same pattern for `ANTHROPIC_API_KEY`
- `similarity.ts` imports `astro:env/server` — this module is never imported by test files (only by dashboard SSR), so Vitest isolation is maintained

## Desired End State

After all phases are complete:

1. Submitting a standup with a non-null blocker redirects to `/dashboard?blocker_match=1`.
2. If the two most recent entries (or N entries for threshold=N) form consecutive business days with similar blockers (Claude Haiku says YES, or Jaccard ≥ 0.25 on fallback), a confirmation banner appears above the today's standup card.
3. Clicking "Yes, same blocker" or "No, different issue" POSTs to a server action, persists the outcome in `blocker_alerts`, and redirects to `/dashboard` (no banner).
4. Confirmed blocker alerts show as warning badges on the corresponding history entry.
5. All 11 tests in `blocker-detection.test.ts` pass (skip guard lifts automatically).

### Binding Function Contracts (from `context/changes/test-phase-3/plan.md`)

These signatures are locked. Any deviation requires updating `test-phase-3/plan.md` before
implementing.

```typescript
export function isNextBusinessDay(prev: Date, next: Date): boolean
export async function shouldSuggestBlockerMatch(
  entries: readonly { submitted_date: string; blockers: string | null }[],
  threshold: number,
  similarityFn: (a: string, b: string) => Promise<boolean>,
): Promise<boolean>
```

## What We're NOT Doing

- **No team-feed rendering** — `blocker_alerts` RLS includes a Team Lead SELECT policy (pre-provisioned for S-05), but no team-feed page or component ships in this slice
- **No alert_threshold UI** — threshold is read from the DB but not configurable via UI here (that's S-05 / FR-015)
- **No re-detection suppression beyond today** — detection fires once per submit (`?blocker_match=1`); suppression is via the DB check against `trigger_date = today`
- **No Jaccard-only mode** — Jaccard is the error fallback for Claude Haiku only; there is no feature flag or separate code path for algorithm-only detection
- **No edit/delete of blocker_alerts** — alerts are immutable once written
- **No pagination of blocker_alerts in history** — badges cover only `displayEntries` (last 30)

## Implementation Approach

Shape 2 (detection in dashboard SSR frontmatter): the submit API adds `?blocker_match=1` to
the redirect when the new entry has a non-null blocker. Dashboard SSR reads this param, checks
for an existing alert for today, and — if absent — calls `shouldSuggestBlockerMatch` with
`haikuSimilarity` (which falls back to Jaccard on error). Confirmation and dismissal use
Astro server POST routes following the existing POST-redirect-GET pattern. All state lives in
`blocker_alerts`; no React island is needed.

## Critical Implementation Details

**UTC date parsing in `isNextBusinessDay`**: `submitted_date` strings (`"2026-06-01"`) must
be parsed as `new Date(date + "T00:00:00Z")` — not `new Date(date)`. Bare ISO date strings
are parsed as UTC midnight by the spec, but behaviour varies across JS environments; the
explicit `Z` suffix eliminates any local-timezone day-shift in `getUTCDay()`.

**`similarity.ts` / `astro:env/server` coupling**: `haikuSimilarity` imports `ANTHROPIC_API_KEY`
from `astro:env/server`, which is only available inside the Astro runtime. Never import
`similarity.ts` from test files or Node.js scripts. `shouldSuggestBlockerMatch` in `blocker.ts`
takes `similarityFn` as an injected parameter precisely to keep `blocker.ts` runtime-agnostic
and testable in Vitest.

**`blocker_alerts` UNIQUE conflict on confirm/dismiss**: use `upsert` with
`onConflict: "user_id,trigger_date"` in the confirm and dismiss API routes — a user can retry
after a network error without getting a 409.

---

## Phase 1: Schema + Infrastructure

### Overview

Create the `blocker_alerts` table with RLS, add the `BlockerAlert` TypeScript type, wire
`ANTHROPIC_API_KEY` into the Astro env schema, and install `@anthropic-ai/sdk`.

### Changes Required

#### 1. Supabase migration — `blocker_alerts` table

**File**: `supabase/migrations/20260607000000_blocker_alerts.sql`

**Intent**: Create `blocker_alerts` with RLS. Member can insert their own rows (via server
API routes) and SELECT their own rows. Team Lead can SELECT all rows in their workspace
(pre-provisioned for S-05 team feed). No UPDATE or DELETE policies — alerts are immutable.

**Contract**:
```sql
CREATE TABLE blocker_alerts (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid  NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id         uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_date    date  NOT NULL,   -- submitted_date of the entry that triggered detection
  status          text  NOT NULL CHECK (status IN ('confirmed', 'dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trigger_date)
);
```
RLS: enable; member SELECT (`auth.uid() = user_id`); team_lead SELECT (reuse
`auth_user_is_team_lead()` + `auth_user_workspace_id()`); member INSERT (`auth.uid() = user_id
AND workspace_id = auth_user_workspace_id()`).

#### 2. TypeScript type — `BlockerAlert`

**File**: `src/types.ts`

**Intent**: Add `BlockerAlert` interface so the dashboard and API routes have a typed
representation of alert rows.

**Contract**: `id`, `workspace_id`, `user_id`, `trigger_date: string` (`'YYYY-MM-DD'`),
`status: 'confirmed' | 'dismissed'`, `created_at: string`.

#### 3. Env schema — `ANTHROPIC_API_KEY`

**File**: `astro.config.mjs`

**Intent**: Register `ANTHROPIC_API_KEY` in the Astro env schema so it is available as a
typed server secret via `astro:env/server`.

**Contract**: Add `ANTHROPIC_API_KEY: envField.string({ context: "server", access: "secret",
optional: true })` alongside the existing `SUPABASE_URL` and `SUPABASE_KEY` entries.

#### 4. SDK dependency — `@anthropic-ai/sdk`

**File**: `package.json`

**Intent**: Install the official Anthropic SDK so `similarity.ts` can call Claude Haiku.

**Contract**: `npm install @anthropic-ai/sdk` — no other config changes; the SDK is used
server-side only (no client bundle impact).

### Success Criteria

#### Automated Verification

- Migration applies cleanly against local Supabase: `npx supabase db reset`
- TypeScript compiles without errors: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification

- `npx supabase db reset` completes without error; `blocker_alerts` table visible in Supabase Studio
- `astro.config.mjs` env schema shows `ANTHROPIC_API_KEY` alongside existing secrets

---

## Phase 2: Detection Logic

### Overview

Replace the two stubs in `src/lib/blocker.ts` with real implementations. Create
`src/lib/similarity.ts` exporting `haikuSimilarity` (Claude Haiku call with Jaccard fallback).
The 11 blocked tests in `blocker-detection.test.ts` pass after this phase.

### Changes Required

#### 1. Implement `isNextBusinessDay`

**File**: `src/lib/blocker.ts`

**Intent**: Replace the throw stub with the real implementation. Given two dates, return true
only if `next` is the immediate next business day (Mon–Fri) after `prev`, treating the
Fri→Mon transition as consecutive.

**Contract**: Uses UTC day-of-week (`getUTCDay()`). `prev` Friday → expected Monday (+3 days);
`prev` Monday–Thursday → expected tomorrow (+1 day). Compare expected date to `next` via
`toISOString().slice(0, 10)`. Inputs are `Date` objects; the caller is responsible for
constructing them as UTC (e.g., `new Date(dateStr + "T00:00:00Z")`).

#### 2. Implement `shouldSuggestBlockerMatch`

**File**: `src/lib/blocker.ts`

**Intent**: Replace the throw stub with the real implementation. Given the sorted-descending
entries list, the threshold N, and an async similarity function, return true iff the N most
recent entries form N consecutive business days where every entry has a non-null/non-empty
blocker and every consecutive pair's blockers are evaluated as similar.

**Contract**:
- Short-circuit false if `entries.length < threshold`
- Short-circuit false if any entry in the window has a null or empty `blockers` field
- Consecutiveness check: parse each `submitted_date` as `new Date(date + "T00:00:00Z")`;
  call `isNextBusinessDay(older, newer)` for each adjacent pair in the window
- Similarity check: `await similarityFn(window[i].blockers, window[i+1].blockers)` for each pair;
  short-circuit false on first false result
- Remove the `eslint-disable-next-line @typescript-eslint/require-await` comment from
  the stub — the real implementation awaits `similarityFn`

#### 3. Create `haikuSimilarity` in `src/lib/similarity.ts`

**File**: `src/lib/similarity.ts` (new file)

**Intent**: Export `haikuSimilarity(a: string, b: string): Promise<boolean>` — calls Claude
Haiku to evaluate whether two blocker strings describe the same blocking issue. Falls back to
Jaccard keyword overlap (threshold ≥ 0.25) if the Haiku call throws for any reason.

**Contract**:
- Import `ANTHROPIC_API_KEY` from `astro:env/server`; instantiate `new Anthropic({ apiKey: ANTHROPIC_API_KEY })`
- Model: `"claude-haiku-4-5-20251001"`, `max_tokens: 10`
- Prompt: `"Are these two standup blocker entries describing the same blocking issue? Answer YES or NO only.\n\nEntry 1: {a}\nEntry 2: {b}"`
- Parse response: `response.content[0].text.trim().toUpperCase().startsWith("YES")`
- Catch block: call the inline Jaccard helper and return its result
- Jaccard helper (unexported): normalize to lowercase word tokens via `/\w+/g`; `intersection / union >= 0.25`

### Success Criteria

#### Automated Verification

- All 11 blocker-detection tests pass (skip guard lifts automatically): `npm test`
- Build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification

- Run `npm test` and confirm the `blocker detection` describe block runs (not skipped) with all 11 tests green

---

## Phase 3: Submit Trigger + Action Routes

### Overview

Modify the submit API to signal detection via `?blocker_match=1`. Create the confirm and
dismiss POST routes that persist outcomes to `blocker_alerts`.

### Changes Required

#### 1. Submit trigger — `?blocker_match=1` redirect

**File**: `src/pages/api/standup/submit.ts`

**Intent**: After a successful insert, redirect to `/dashboard?blocker_match=1` when the
submitted entry has a non-null/non-empty blocker field; redirect to `/dashboard` (unchanged)
when blockers is empty or null.

**Contract**: Replace the final `return context.redirect("/dashboard")` at line 72 with a
conditional redirect. `rawBlockers` (already computed at line 55) is non-empty string when
blockers should trigger detection; use `rawBlockers !== ""` as the condition.

#### 2. Confirm route

**File**: `src/pages/api/blocker/confirm.ts` (new file)

**Intent**: Accept a POST with `trigger_date` in the form body. Look up the user's workspace
membership, then upsert a `blocker_alerts` row with `status: 'confirmed'`. Redirect to
`/dashboard` on success or error (never expose DB errors to client).

**Contract**:
- `export const prerender = false`
- Validate `trigger_date` with `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` via zod
- Fetch `workspace_id` from `workspace_member` (same pattern as `submit.ts:42–46`)
- Upsert: `supabase.from("blocker_alerts").upsert({ workspace_id, user_id, trigger_date, status: "confirmed" }, { onConflict: "user_id,trigger_date", ignoreDuplicates: true })`
- Always redirect to `/dashboard`

#### 3. Dismiss route

**File**: `src/pages/api/blocker/dismiss.ts` (new file)

**Intent**: Same as confirm route but writes `status: 'dismissed'`. Identical shape; only
`status` value differs.

**Contract**: Same structure as `confirm.ts`; `status: "dismissed"` in the upsert payload; same `{ onConflict: "user_id,trigger_date", ignoreDuplicates: true }` options.

### Success Criteria

#### Automated Verification

- Build succeeds (TypeScript compiles the two new routes): `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification

- Submit a standup with a non-empty blocker field; verify the browser URL becomes `/dashboard?blocker_match=1` (not `/dashboard`)
- Submit a standup with no blocker field; verify the browser URL is `/dashboard` (no param)
- POST directly to `/api/blocker/confirm` with a `trigger_date`; verify a row appears in `blocker_alerts` with `status: confirmed`
- POST directly to `/api/blocker/dismiss`; verify `status: dismissed`
- Retry the same confirm POST (duplicate `trigger_date`); verify no 409 error (upsert handles it)

---

## Phase 4: Dashboard Integration

### Overview

Wire detection into the dashboard SSR frontmatter and render the confirmation banner and
history alert badges.

### Changes Required

#### 1. Dashboard SSR frontmatter — detection + alert fetch

**File**: `src/pages/dashboard.astro`

**Intent**: After fetching `recentEntries`, check `?blocker_match=1` param; if present,
check for an existing `blocker_alerts` row for today; if absent, call
`shouldSuggestBlockerMatch`. Also fetch all alert rows for the current user to power history
badges.

**Contract**:
- Import `shouldSuggestBlockerMatch` from `@/lib/blocker` and `haikuSimilarity` from
  `@/lib/similarity`; import `BlockerAlert` from `@/types`
- Read `const isFreshSubmit = Astro.url.searchParams.get("blocker_match") === "1"`
- Declare `let showBlockerBanner = false` and `let blockerAlerts: BlockerAlert[] = []`
- After the existing entries query (line 18–26), add a second `supabase.from("blocker_alerts")
  .select("*").eq("user_id", user.id)` query; assign result to `blockerAlerts`
- Detection block (runs only when `isFreshSubmit && todayEntry?.blockers`):
  - Look up `blockerAlerts.find(a => a.trigger_date === today)` — if found, skip detection
  - Otherwise: `showBlockerBanner = await shouldSuggestBlockerMatch(recentEntries,
    workspace!.alert_threshold, haikuSimilarity)`
- Wrap the detection block in try/catch; on any throw, log server-side and leave
  `showBlockerBanner = false` (fail-safe)

#### 2. Dashboard template — confirmation banner

**File**: `src/pages/dashboard.astro`

**Intent**: Render a dismissible confirmation banner above the "Standup: form or today's
read-only entry" section when `showBlockerBanner` is true. Show both blocker strings for
context. Two forms: one POSTs confirm, one POSTs dismiss.

**Contract**:
- Render conditionally: `{showBlockerBanner && todayEntry && (...)}` inserted as a `<section>`
  between the streak badge and the standup section
- Display both blockers: `todayEntry.blockers` (today) and `recentEntries[1]?.blockers`
  (previous day) — the second entry in the descending-sorted list is the previous day
- Two `<form method="POST">` elements: one `action="/api/blocker/confirm"`, one
  `action="/api/blocker/dismiss"`; each carries a `<input type="hidden" name="trigger_date"
  value={todayEntry.submitted_date} />`
- Style consistent with existing glass-morphism card pattern (`rounded-2xl border
  border-white/10 bg-white/10 backdrop-blur-xl`); use amber/warning tones for the alert
  (e.g., `border-amber-400/30 bg-amber-500/10`)

#### 3. Dashboard template — history alert badges

**File**: `src/pages/dashboard.astro`

**Intent**: For each entry in `displayEntries`, look up whether a confirmed blocker alert
exists with `trigger_date === entry.submitted_date`. If found, render an alert badge inside
the entry card.

**Contract**:
- In the `displayEntries.map(...)` template block (lines 129–151), compute
  `const alert = blockerAlerts.find(a => a.trigger_date === entry.submitted_date && a.status === "confirmed")`
- If truthy, render a badge inside the entry card header row (alongside the date), using
  red/warning tones consistent with the existing green "Submitted ✓" badge styling

### Success Criteria

#### Automated Verification

- Build succeeds: `npm run build`
- Linting passes: `npm run lint`
- Full test suite green: `npm test`

#### Manual Verification

- E2E happy path: submit two standups on consecutive days with similar blockers; verify the confirmation banner appears on the second submission's dashboard redirect
- Confirm flow: click "Yes, same blocker"; verify banner disappears, history badge appears on today's entry
- Dismiss flow: click "No, different issue"; verify banner disappears, no badge on today's entry
- Re-load dashboard: verify banner does not re-appear after confirm or dismiss (alert record suppresses re-detection)
- Haiku fallback: temporarily set `ANTHROPIC_API_KEY` to an invalid value; submit similar blockers; verify banner still appears (Jaccard fallback fires)
- Empty blocker: submit a standup with no blockers; verify URL is `/dashboard` (no `?blocker_match=1`); no banner

---

## Testing Strategy

### Unit Tests

All 11 tests in `src/__tests__/blocker-detection.test.ts` cover `isNextBusinessDay` (5 cases)
and `shouldSuggestBlockerMatch` (6 cases). They run automatically once Phase 2 replaces the
stubs. No new test file is needed — the suite already exists.

### Integration / Manual Testing

Phase 4 Manual Verification covers the full end-to-end flow. Critical paths to exercise:

1. Fresh submit with similar consecutive blockers → banner → confirm → badge
2. Fresh submit with similar consecutive blockers → banner → dismiss → no badge → no re-banner
3. Haiku failure → Jaccard fallback fires (use invalid API key)
4. No blocker submitted → no `?blocker_match=1` → no detection call

### E2E (Playwright)

The existing Playwright setup can cover the happy path once S-04 ships. See
`context/foundation/test-plan.md` for E2E phase guidelines. Not in scope for this slice's
implementation gate.

## References

- Frame brief: `context/changes/blocker-detection-flow/frame.md`
- Research: `context/changes/blocker-detection-flow/research.md`
- Binding function contracts: `context/changes/test-phase-3/plan.md §Binding Function Contracts`
- Test file: `src/__tests__/blocker-detection.test.ts`
- Submit API: `src/pages/api/standup/submit.ts:72`
- Dashboard SSR: `src/pages/dashboard.astro:17–31`
- Workspace threshold: `src/types.ts:6`, `astro:env/server` locals
- Existing RLS helpers: `supabase/migrations/20260604000000_workspace_member_schema.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + Infrastructure

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — cacf14d
- [x] 1.2 Build succeeds: `npm run build` — cacf14d
- [x] 1.3 Linting passes: `npm run lint` — cacf14d

#### Manual

- [x] 1.4 `blocker_alerts` table visible in Supabase Studio after reset — cacf14d
- [x] 1.5 `ANTHROPIC_API_KEY` present in `astro.config.mjs` env schema — cacf14d

### Phase 2: Detection Logic

#### Automated

- [x] 2.1 All 11 blocker-detection tests pass (skip guard lifts): `npm test` — 25ab65c
- [x] 2.2 Build succeeds: `npm run build` — 25ab65c
- [x] 2.3 Linting passes: `npm run lint` — 25ab65c

#### Manual

- [x] 2.4 `blocker detection` describe block runs (not skipped) with all 11 tests green — 25ab65c

### Phase 3: Submit Trigger + Action Routes

#### Automated

- [x] 3.1 Build succeeds: `npm run build` — 8a6b3cc
- [x] 3.2 Linting passes: `npm run lint` — 8a6b3cc

#### Manual

- [x] 3.3 Submit with non-empty blocker → URL becomes `/dashboard?blocker_match=1` — 8a6b3cc
- [x] 3.4 Submit with empty blocker → URL is `/dashboard` (no param) — 8a6b3cc
- [x] 3.5 POST to `/api/blocker/confirm` → row in `blocker_alerts` with `status: confirmed` — 8a6b3cc
- [x] 3.6 POST to `/api/blocker/dismiss` → row in `blocker_alerts` with `status: dismissed` — 8a6b3cc
- [x] 3.7 Duplicate confirm POST → no 409 (upsert handles conflict) — 8a6b3cc

### Phase 4: Dashboard Integration

#### Automated

- [x] 4.1 Build succeeds: `npm run build` — 3e3b48d
- [x] 4.2 Linting passes: `npm run lint` — 3e3b48d
- [x] 4.3 Full test suite green: `npm test` — 3e3b48d

#### Manual

- [x] 4.4 Similar consecutive blockers → confirmation banner appears on second submit — 3e3b48d
- [x] 4.5 Confirm flow → banner gone, history badge appears on today's entry — 3e3b48d
- [x] 4.6 Dismiss flow → banner gone, no history badge — 3e3b48d
- [x] 4.7 Re-load after confirm/dismiss → banner does not re-appear — 3e3b48d
- [x] 4.8 Invalid `ANTHROPIC_API_KEY` → banner still appears (Jaccard fallback) — 3e3b48d
- [x] 4.9 Empty blocker submit → no `?blocker_match=1`, no banner — 3e3b48d
