# Standup Entry Edit & Delete — Plan Brief

> Full plan: `context/changes/standup-entry-edit-delete/plan.md`

## What & Why

Members can currently submit standups but cannot correct them. FR-007 and FR-008 were deferred from S-03 as "immutable in MVP" and are now reinstated as must-haves. This change adds the full edit-and-delete surface: any member can update the `did`, `plan`, and `blockers` content of any of their own entries, or delete an entry entirely.

## Starting Point

The `standup_entries` table has no UPDATE or DELETE RLS policies (placeholder comment says "entries are immutable in MVP"). The dashboard history list is a static Astro template with no entry IDs in the rendered HTML and no interactive affordances. The streak is computed on-demand from in-memory data; `blocker_alerts` is loosely coupled via `user_id + trigger_date` with no FK to `standup_entries`.

## Desired End State

Each history card in the dashboard shows "Edit" and "Delete" buttons. Edit expands an inline form pre-populated with the entry's content; saving updates the entry and redirects to the dashboard with a success flash. Delete shows a two-button confirm/cancel inline on the card; confirming removes the entry, redirects, and the streak counter updates to reflect the deletion.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Scope of mutable entries | Any own entry (no date window) | PRD FR-007/FR-008 impose no date restriction; full ownership is the accurate reading |
| Streak after delete | Recompute from remaining entries | Streak must stay accurate; the pure `calculateStreak()` function makes this free |
| Blocker alert after delete | Alert survives unchanged | `blocker_alerts` has no FK to `standup_entries`; loose coupling is the existing design |
| Edit UX | Inline expand on history card | Consistent with existing inline blocker confirm/dismiss pattern; no navigation |
| Delete UX | Inline two-button confirm (Yes/No) | Same two-button pattern as the blocker banner; no modal components needed |
| Date mutability | submitted_date is immutable | Prevents UNIQUE constraint conflicts; delete + resubmit handles the rare date-correction case |
| Where affordances appear | History list only | Single source of truth; avoids state sync between the top "Today's" card and history |
| Testing coverage | E2E API tests + streak unit test | Streak delete-middle edge case is tricky to hit in E2E; pure unit test covers it precisely |

## Scope

**In scope:**
- New Supabase migration: UPDATE + DELETE RLS policies on `standup_entries`
- `/api/standup/update` — POST route, updates `did`/`plan`/`blockers`
- `/api/standup/delete` — POST route, deletes by `id`
- `StandupHistoryList.tsx` — React island replacing the static Astro history list
- `dashboard.astro` — wired to the island + success flash messages
- `route-coverage.test.ts` — register both new routes as inline-guarded
- Streak unit test (head-entry delete scenario)
- `e2e/standup-edit-delete.spec.ts` (edit, delete, auth guard)

**Out of scope:**
- Blocker alert cleanup on entry deletion
- Re-triggering blocker detection on edit
- Changing `submitted_date` on edit
- Edit/delete on the top "Today's standup" card
- Time-window restriction on editable entries

## Architecture / Approach

All mutations use the standard app pattern: native HTML form POST → Astro API route → Zod validation → CSRF check → Supabase mutation → `context.redirect()`. The React island (`StandupHistoryList.tsx`) manages only visual state (which card is in edit or delete-confirm mode); it does not use `fetch`. After any mutation the page reloads naturally, recomputing the streak and refreshing the entry list from Supabase via SSR.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database — RLS policies | UPDATE/DELETE policies on `standup_entries` | Wrong USING/WITH CHECK allows cross-user mutations |
| 2. Backend — API routes | `/api/standup/update`, `/api/standup/delete` | Missing count===0 guard silently reports success on not-found |
| 3. Frontend — React island | History list with inline edit/delete + success flash | React island prop types must match the `StandupEntry` shape exactly |
| 4. Tests | Streak unit test + E2E API spec | E2E fixture must be isolated from role-gate fixtures (same-day UNIQUE conflict) |

**Prerequisites:** Local Supabase running for Phase 1 manual verification and Phase 4 E2E tests  
**Estimated effort:** ~2 sessions across 4 phases

## Open Risks & Assumptions

- Editing an entry whose `trigger_date` has a confirmed blocker alert leaves the alert badge visible on that date even if the blocker text is removed — accepted inconsistency documented in "What We're NOT Doing."
- The E2E spec must create its own timestamped test fixtures (not reuse the role-gate global-setup fixtures) to avoid UNIQUE(user_id, submitted_date) collisions on same-day test runs.

## Success Criteria (Summary)

- A member can edit any of their own history entries and see the updated content on the dashboard
- A member can delete any of their own history entries and see the streak counter adjust immediately
- An unauthenticated request to either mutation API redirects to `/auth/signin`
