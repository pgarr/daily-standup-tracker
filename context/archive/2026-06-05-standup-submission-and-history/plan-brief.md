# Standup Submission and History — Plan Brief

> Full plan: `context/changes/standup-submission-and-history/plan.md`
> Research: `context/foundation/roadmap.md` — S-03 entry

## What & Why

S-03 delivers the product's primary value loop: a member submits a daily standup (did, plan, optional blockers), sees their history, and watches their consecutive-business-day streak grow. Without this slice, S-04 (blocker detection) and S-05 (team feed) cannot proceed — every downstream slice reads from `standup_entries`. The streak mechanic is the habit-formation signal that differentiates the product from a plain log.

## Starting Point

Auth and workspace are complete (S-01, F-01). The dashboard is a stub showing workspace name and role. `src/lib/streak.ts` is a stub that throws; 7 unit tests in `src/__tests__/streak.test.ts` are already written but blocked on the stub. No `standup_entries` table or `StandupEntry` type exists.

## Desired End State

A logged-in member opens `/dashboard`, sees a standup form with three fields. After submitting, the form is replaced by a read-only view of today's entry and the streak badge increments to "🔥 Day 1." The history list below shows the last 30 entries. Submitting twice on the same day shows an inline error. `npm test` exits 0 (streak tests unblocked).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| UI layout | Inline on /dashboard | Zero new routing; user lands directly in the workflow | Plan |
| Duplicate-day policy | Block with inline error + DB UNIQUE constraint | Explicit and honest; DB is the ground truth, API converts 23505 to a readable message | Plan |
| submitted_date source | Client sends local date (`new Date().toLocaleDateString("sv")`) | Matches test-phase-3 storage contract; server-side UTC has timezone error for extreme offsets | Research (test-phase-3 plan) |
| History scope | Last 30 entries, flat list, no pagination | PRD FR-009 intent; 30 covers a full work month for MVP volumes | Plan |
| Streak display | "🔥 Day N" badge, hidden when streak = 0 | PRD US-01 says "Day 1 on first submission"; emoji avoids a React island for a static badge | Plan |
| Post-submit UI | Show today's entry read-only in place of the form | Confirms durability (PRD guardrail); prevents re-submission attempt | Plan |
| Uniqueness enforcement | DB UNIQUE (user_id, submitted_date) + API 23505 catch | DB enforces at write time; API converts the opaque error to a user message | Plan |

## Scope

**In scope:** `standup_entries` migration + RLS, `StandupEntry` type, `calculateStreak` implementation (unblocking 7 existing unit tests), `POST /api/standup/submit`, dashboard data loading + UI (form, today entry, streak badge, history list).

**Out of scope:** Edit/delete entries (S-06), Team Lead visibility of others' entries (S-05), full-text search (FR-010, v2), blocker detection (S-04), pagination.

## Architecture / Approach

Full SSR: the dashboard Astro page loads the last 30 entries and streak server-side in the frontmatter; `calculateStreak` runs server-side. The standup form is the only interactive piece — a React island (`StandupForm client:load`) that reads the user's local date client-side for the hidden `submitted_date` field and POSTs to `/api/standup/submit`. On success, the API redirects back to `/dashboard` triggering a full SSR reload with fresh data. Errors are passed via `?error=` query param (established pattern from `workspace/create.ts`).

One middleware gap to navigate: `/api/standup/submit` doesn't receive `context.locals.workspace` (middleware skips workspace loading for `/api/*` routes), so the submit endpoint must query `workspace_member` itself to obtain `workspace_id` before inserting.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. standup_entries migration + StandupEntry type | Schema + types foundation; RLS policies; `npm test` still blocked | RLS INSERT policy reuses `auth_user_workspace_id()` helper — verify it covers the standup workspace check correctly |
| 2. calculateStreak + submit API | `npm test` exits 0; POST endpoint accepts/rejects submissions | Weekend-skip invariant in streak algorithm (Sat older entry must break the streak); middleware gap for workspace_id in API route |
| 3. Dashboard UI | Full end-to-end flow: form → submit → read-only entry + streak + history | Dashboard layout expansion from narrow card to `max-w-2xl`; correct today-check using UTC date approximation |

**Prerequisites:** S-01 and F-01 complete (both done and archived).
**Estimated effort:** ~3 focused sessions across 3 phases.

## Open Risks & Assumptions

- **UTC vs local date for today check**: The dashboard load uses `new Date().toISOString().slice(0, 10)` (UTC) to determine "today" when deciding form vs read-only view. For users in UTC+X timezones near midnight, the check may show the form briefly even though an entry exists. Acceptable MVP tradeoff — the entry is always visible in the history list.
- **No streak for entries[0] on a weekend**: If a user somehow stores a Saturday `submitted_date` (data quality bug in S-04+), `calculateStreak` returns a correctly bounded result. Not a concern for S-03 submissions since the client's `toLocaleDateString` always sends the actual day, and the form is only shown on business days in practice.

## Success Criteria (Summary)

- `npm test` exits 0 after Phase 2 (all 7 streak unit tests pass)
- POST `/api/standup/submit` with valid fields creates a `standup_entries` row; a second same-day POST returns a user-readable error
- Dashboard: submit form → see read-only entry + "🔥 Day 1" streak → refresh → still read-only (durability confirmed)
