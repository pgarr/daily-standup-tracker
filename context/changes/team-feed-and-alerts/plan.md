# Team Feed and Alerts Implementation Plan

## Overview

Build S-05 — the north star slice that closes the core product loop. Team Lead can open `/team-feed` to see all workspace members' standup entries for a selected business day, confirmed blocker badges on affected member cards, muted "No standup yet" placeholders for missing members, date navigation (±7 business days), and an inline alert threshold configuration form.

## Current State Analysis

- `standup_entries`: complete, but **missing Team Lead SELECT policy** — intentionally deferred, noted at `supabase/migrations/20260605000002_standup_entries.sql:15`
- `blocker_alerts`: Team Lead SELECT policy already provisioned in S-04 (`supabase/migrations/20260607000000_blocker_alerts.sql:17-19`)
- `workspace.alert_threshold` (default 2) + Team Lead UPDATE policy exist — no API endpoint yet
- `workspace_member` stores `user_id` but no email; `auth.users` is the authoritative source
- Members page (`src/pages/workspace/members.astro`) shows member emails via `workspace_invitation` — that approach does not work for the team feed because standup entries are keyed by `user_id`, not by email, and there is no FK between `workspace_invitation` and `workspace_member`
- Topbar (`src/components/Topbar.astro:16-23`): Team Lead nav links are already conditional on `workspaceMember?.role === "team_lead"` — the "Team Feed" link follows the same pattern
- Route protection (`src/lib/routes.ts`): `AUTH_REQUIRED_ROUTES` and `WORKSPACE_REQUIRED_ROUTES` are the two lists to extend

### Key Discoveries

- `src/components/Topbar.astro:16-23` — existing conditional Team Lead link pattern (Members); "Team Feed" follows this exactly
- `src/pages/workspace/members.astro:9-11` — page-level Team Lead guard pattern (redirect to /dashboard)
- `src/pages/dashboard.astro:192-227` — entry card rendering pattern to reuse for feed cards
- `src/pages/api/workspace/invite.ts:26-31` — workspace context query pattern for API routes
- `src/lib/routes.ts:4-7` — two lists to extend with `/team-feed`
- All POST endpoints check CSRF Origin/Referer (`context/foundation/lessons.md`)

## Desired End State

`/team-feed` is accessible only to Team Leads (Members redirected to `/dashboard`). It shows all workspace members as cards for the selected business day (default today), navigable via previous/next buttons clamped to today−10 calendar days through today. Each card shows the member's email and full standup content (did / plan / blockers) or a muted "No standup yet" placeholder. A "⚠ Recurring Blocker" badge appears on cards with a confirmed alert for that date. An inline threshold form at the top lets the Team Lead set the workspace's alert threshold (integer ≥ 1). A "Team Feed" nav link appears in the Topbar for Team Leads.

To verify: log in as Team Lead, open `/team-feed`, confirm all members appear (submitted and not-submitted), navigate dates, confirm blocker badge, change threshold and reload to confirm persistence. Log in as Member, confirm `/team-feed` redirects to `/dashboard`.

## What We're NOT Doing

- No React island for the feed (pure Astro SSR)
- No date picker — only previous/next business day buttons
- No per-member history drill-down (S-06 scope)
- No search or filtering within the team feed
- No Member promotion to Team Lead (non-goal per PRD)
- No new DB tables — schema is complete; only one RLS policy and one function added

## Implementation Approach

Three phases: DB foundation → API + routing infrastructure → UI page. Each phase is independently deployable and testable. The `get_workspace_member_emails()` function (Phase 1) is the enabling primitive that unlocks the user_id↔email correlation the feed depends on.

## Critical Implementation Details

**auth.users access from SECURITY DEFINER**: The new function must reference `auth.users` with full schema qualification even though `SET search_path = public` is set. The function runs as the `postgres` owner role which has access to the `auth` schema. Use `auth.users` explicitly in the JOIN. The function is STABLE (read-only identity lookup, not a guard checking live mutable state — the VOLATILE lesson applies to guard functions like `workspace_has_no_members`, not reads).

**Date navigation skips weekends**: Previous/next links must jump over weekends. From Monday, "previous" is Friday (−3 days); from Sunday or Saturday the page should default to Friday. The clamp boundary is today (no future navigation) and today minus 10 calendar days (covers at least 7 business days back regardless of weekend placement).

---

## Phase 1: DB Migration — Team Lead standup access + member email helper

### Overview

Add the missing Team Lead SELECT policy on `standup_entries` and a SECURITY DEFINER function that returns `(user_id, email)` pairs for all workspace members by joining `auth.users`. These two additions are the DB primitives that make the team feed possible.

### Changes Required

#### 1. Migration file

**File**: `supabase/migrations/20260627000000_team_feed_rls.sql`

**Intent**: Patch the intentionally deferred Team Lead visibility on `standup_entries`; add the email-lookup function that replaces the workspace_invitation workaround used by the members page.

**Contract**: The Team Lead SELECT policy mirrors the existing `blocker_alerts` Team Lead policy verbatim — `auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id()`. The function signature is:

```sql
CREATE OR REPLACE FUNCTION get_workspace_member_emails()
  RETURNS TABLE(user_id uuid, email text)
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public
AS $$
  SELECT wm.user_id, u.email::text
  FROM workspace_member wm
  JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = auth_user_workspace_id()
    AND auth_user_is_team_lead();
$$;

GRANT EXECUTE ON FUNCTION get_workspace_member_emails() TO authenticated;
```

### Success Criteria

#### Automated Verification

- Migration applies without error: `npx supabase db push` (local) or `npx supabase migration up`
- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Supabase Studio: "team lead can view all standup entries in workspace" policy appears on `standup_entries`
- Supabase Studio: `get_workspace_member_emails` function exists with correct signature
- SQL editor (Team Lead session): `SELECT * FROM get_workspace_member_emails()` returns member rows with emails
- SQL editor (Member session): `SELECT * FROM get_workspace_member_emails()` returns empty (auth_user_is_team_lead() is false)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Threshold Update API Endpoint + Route Registration

### Overview

Create `POST /api/workspace/update-threshold` so the Team Lead can change the workspace `alert_threshold` from the team feed page. Register `/team-feed` in the route protection lists.

### Changes Required

#### 1. Threshold update endpoint

**File**: `src/pages/api/workspace/update-threshold.ts`

**Intent**: Accept a form POST with a `threshold` integer field, validate it, and update `workspace.alert_threshold` for the calling Team Lead's workspace. Follows all existing POST conventions: auth guard, CSRF check, workspace context query, role guard, Zod validation, redirect on success/error.

**Contract**: `export const prerender = false;` as line 1. `export const POST: APIRoute`. CSRF check (`Origin`/`Referer` header vs `context.url.origin` — lessons.md). Workspace context via `.from("workspace_member").select("workspace_id, role").eq("user_id", user.id).maybeSingle()`. Role guard: `member.role !== "team_lead"` → redirect with error. Zod schema: `z.object({ threshold: z.coerce.number().int().min(1) })`. Supabase UPDATE: `.from("workspace").update({ alert_threshold: threshold }).eq("id", workspaceId)`. Redirect: `/team-feed?success=threshold_updated` on success, `/team-feed?error=<message>` on failure.

#### 2. Route registration

**File**: `src/lib/routes.ts`

**Intent**: Add `/team-feed` to both protection lists so middleware enforces authentication and attaches workspace context before the page's frontmatter runs.

**Contract**: Append `"/team-feed"` to `AUTH_REQUIRED_ROUTES` (line 4) and `WORKSPACE_REQUIRED_ROUTES` (line 7). These arrays use prefix matching in middleware — `/team-feed` is a leaf route so the entry is exact.

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- As Team Lead: POST to `/api/workspace/update-threshold` with `threshold=3` → workspace `alert_threshold` updated to 3 in DB, redirected to `/team-feed?success=threshold_updated`
- As Member: same POST → redirected with error (role check fires)
- Unauthenticated: GET `/team-feed` → redirected to `/auth/signin` (middleware fires on new route entry)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Team Feed Page + Topbar Update

### Overview

Create `src/pages/team-feed.astro`: Team Lead only, server-rendered, aggregates member emails + standup entries + blocker alerts for the selected business day, renders a card grid with date navigation and inline threshold form. Update Topbar with the "Team Feed" nav link for Team Leads.

### Changes Required

#### 1. Team feed page

**File**: `src/pages/team-feed.astro`

**Intent**: The north star view. Shows who submitted, who didn't, and which members have confirmed blocker alerts — all for a selectable business day.

**Contract**:
- Gate: `if (workspaceMember?.role !== "team_lead") return Astro.redirect("/dashboard")` — mirrors `members.astro:9-11`
- Supabase guard: `if (!supabase) return Astro.redirect('/team-feed?error=...')` before any query — mirrors `members.astro:17-20`
- Date handling (inline helpers in frontmatter):
  - Read `Astro.url.searchParams.get("date")`; validate `/^\d{4}-\d{2}-\d{2}$/`; default to today
  - Clamp: not after today, not before today minus 10 calendar days
  - Snap to business day: if parsed date falls on Saturday set to Friday, if Sunday set to Friday
  - `prevBusinessDay(d)`: subtract 1 day; if result is Sunday subtract 2 more; if Saturday subtract 1 more
  - `nextBusinessDay(d)`: add 1 day; if result is Saturday add 2 more; if Sunday add 1 more
- Parallel queries via `Promise.all`:
  1. `supabase.rpc("get_workspace_member_emails")` → `{ user_id: string, email: string }[]`
  2. `supabase.from("standup_entries").select("*").eq("workspace_id", workspace!.id).eq("submitted_date", selectedDate)` → `StandupEntry[]`
  3. `supabase.from("blocker_alerts").select("*").eq("workspace_id", workspace!.id).eq("trigger_date", selectedDate).eq("status", "confirmed")` → `BlockerAlert[]`
- Build lookup maps: `entryByUserId: Record<string, StandupEntry>`, `alertByUserId: Record<string, BlockerAlert>`
- Sort member list alphabetically by email
- Feedback params: `const success = Astro.url.searchParams.get("success"); const error = Astro.url.searchParams.get("error")` — mirrors `members.astro:45-47`
- Render:
  - Date header: `<h2>{selectedDate}</h2>` with `< Prev` link (to `?date=prevBusinessDay`) and `> Next` link (to `?date=nextBusinessDay`); hide/grey Prev when at lower clamp, hide/grey Next when selectedDate === today
  - Threshold form: current `workspace.alert_threshold` shown; number input (min=1); POST to `/api/workspace/update-threshold`; success/error feedback from query params
  - Member card grid: for each member row — if `entryByUserId[member.user_id]` exists render submitted card; else render placeholder card

#### 2. Submitted card (inline template in team-feed.astro)

**Intent**: Show the member's full standup for the selected date, with a blocker badge if applicable.

**Contract**: Mirrors `dashboard.astro:197-227`. Header row: member email (left) + "Submitted ✓" badge (green, right) + "⚠ Recurring Blocker" badge (red, right) if `alertByUserId[member.user_id]` exists. Body: did / plan / blockers fields with `whitespace-pre-wrap`. `border-white/10 bg-white/5` card styling.

#### 3. Placeholder card (inline template in team-feed.astro)

**Intent**: Indicate that a member hasn't submitted yet for the selected date, without suggesting they should — this is a read-only view.

**Contract**: Same card dimensions as submitted card. `border-dashed border-white/20 opacity-60` styling. Shows member email and "No standup yet" text in muted tone. No action or link.

#### 4. Topbar update

**File**: `src/components/Topbar.astro`

**Intent**: Add "Team Feed" nav link for Team Leads, between "Dashboard" and "Members".

**Contract**: Insert a conditional link `{workspaceMember?.role === "team_lead" && <a href="/team-feed" ...>Team Feed</a>}` after the Dashboard link and before the existing Members link at `Topbar.astro:13-23`. Use the same `class` string as the existing nav links.

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- Team Lead sees "Team Feed" nav link in Topbar; Member does not
- `/team-feed` redirects Member → `/dashboard`
- Feed shows today's date by default; all workspace members appear (submitted + not-submitted)
- Submitted member cards show full did / plan / blockers content
- Not-submitted members show muted placeholder card with their email
- Confirmed blocker alert → "⚠ Recurring Blocker" badge on that member's card; no badge on clean cards
- "Previous" navigates to previous business day (skips weekend correctly)
- "Next" is hidden/disabled when viewing today
- "Previous" is hidden/disabled at the 10-calendar-day lower clamp
- Threshold form: shows current threshold value; updating saves and redirects with `?success=threshold_updated`; success message appears on page
- Threshold form error: non-integer or value < 1 shows error message

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Manual Testing Steps

1. Set up workspace with Team Lead + 2 members; have one member submit today, leave the other pending
2. Open `/team-feed` as Team Lead — verify one submitted card and one placeholder
3. Navigate "Previous" — verify business day stepping and correct entries for that date
4. Navigate from Tuesday — verify "Previous" lands on Monday (not Sunday)
5. Navigate from Monday — verify "Previous" lands on Friday
6. Navigate to today from a past date — verify "Next" disappears at today
7. Confirm a blocker alert on a past date — navigate there and verify badge appears
8. Update threshold from 2 → 3 — reload, verify the form shows 3
9. As Member: navigate to `/team-feed` — verify redirect to `/dashboard`
10. Unauthenticated: navigate to `/team-feed` — verify redirect to `/auth/signin`

## Performance Considerations

For MVP team sizes (small per PRD), the workspace-scoped `standup_entries` query on a non-indexed column (`workspace_id + submitted_date`) is acceptable — expected team size is single digits to low tens. No index added; revisit if team sizes grow.

## References

- PRD: `context/foundation/prd-v3.md` — FR-013, FR-014, FR-015, US-03
- Roadmap: `context/foundation/roadmap.md` — S-05
- Blocker alert Team Lead policy (template for standup): `supabase/migrations/20260607000000_blocker_alerts.sql:17-19`
- Standup RLS gap comment: `supabase/migrations/20260605000002_standup_entries.sql:15`
- Page-level Team Lead guard: `src/pages/workspace/members.astro:9-11`
- Entry card pattern: `src/pages/dashboard.astro:192-227`
- API workspace context query: `src/pages/api/workspace/invite.ts:26-31`
- Topbar Team Lead conditional: `src/components/Topbar.astro:16-23`
- Routes lists: `src/lib/routes.ts:4-7`
- Lessons: `context/foundation/lessons.md` (CSRF on POST, SECURITY DEFINER STABLE vs VOLATILE)

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB Migration — Team Lead standup access + member email helper

#### Automated

- [x] 1.1 Migration applies without error
- [x] 1.2 Build passes
- [x] 1.3 Lint passes

#### Manual

- [x] 1.4 Supabase Studio: Team Lead SELECT policy exists on standup_entries
- [x] 1.5 Supabase Studio: get_workspace_member_emails function exists
- [x] 1.6 SQL editor (Team Lead session): get_workspace_member_emails() returns member rows with emails
- [x] 1.7 SQL editor (Member session): get_workspace_member_emails() returns empty

### Phase 2: Threshold Update API Endpoint + Route Registration

#### Automated

- [ ] 2.1 Build passes
- [ ] 2.2 Lint passes

#### Manual

- [ ] 2.3 Team Lead POST updates alert_threshold and redirects to /team-feed?success=threshold_updated
- [ ] 2.4 Member POST redirects with error (role check fires)
- [ ] 2.5 Unauthenticated GET /team-feed redirects to /auth/signin

### Phase 3: Team Feed Page + Topbar Update

#### Automated

- [ ] 3.1 Build passes
- [ ] 3.2 Lint passes

#### Manual

- [ ] 3.3 Team Lead sees "Team Feed" nav link; Member does not
- [ ] 3.4 /team-feed redirects Member to /dashboard
- [ ] 3.5 Feed shows today's date by default with all workspace members
- [ ] 3.6 Submitted member cards show full did / plan / blockers
- [ ] 3.7 Not-submitted members show muted placeholder with email
- [ ] 3.8 Confirmed blocker alert shows badge on that member's card
- [ ] 3.9 Previous/Next navigation steps correctly across business days (including weekends)
- [ ] 3.10 Next hidden/disabled at today; Previous hidden/disabled at lower clamp
- [ ] 3.11 Threshold form saves and shows success message
