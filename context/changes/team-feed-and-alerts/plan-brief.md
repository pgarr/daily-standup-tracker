# Team Feed and Alerts — Plan Brief

> Full plan: `context/changes/team-feed-and-alerts/plan.md`

## What & Why

S-05 is the north star of the Daily Standup Tracker: the smallest end-to-end slice that proves the core product hypothesis. We're building a Team Lead–only `/team-feed` page that aggregates all workspace members' daily standups into a single view, surfaces confirmed recurring blocker alerts, and lets the Team Lead configure the alert threshold. Without this slice, the blocker detection mechanic (S-04) never reaches its intended audience.

## Starting Point

All prerequisite slices (S-01 through S-04) are done. The DB schema is essentially complete: `standup_entries`, `blocker_alerts`, `workspace_member`, and `workspace` tables all exist with RLS. One intentional gap remains — the `standup_entries` table has no Team Lead SELECT policy (deferred to S-05 with a comment in the migration). There is also no way to correlate a `user_id` in standup entries to a human-readable email, since `workspace_member` stores only `user_id`.

## Desired End State

A Team Lead opens `/team-feed` and sees every workspace member as a card for the selected business day: submitted members show their full did/plan/blockers text; unsubmitted members show a muted "No standup yet" placeholder. Members with a confirmed recurring blocker carry a "⚠ Recurring Blocker" badge. Previous/Next buttons step through business days (up to 7 days back). An inline form lets the Team Lead adjust the alert threshold. Members who navigate to the URL are silently redirected to their own dashboard.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Member email lookup | SECURITY DEFINER function joining auth.users | No email in workspace_member; function follows existing helper pattern and avoids schema changes | Plan |
| Page structure | New dedicated /team-feed route | Keeps member-facing dashboard clean; mirrors members.astro precedent for Team Lead-only pages | Plan |
| Threshold config placement | Inline on the team feed page | Co-located with the alerts it controls — cause and effect are visible together | Plan |
| Date navigation | Previous/Next buttons, ±7 business days (10 calendar days) | Covers the "missed yesterday" case without a calendar widget; bounded scope for MVP | Plan |
| Standup content detail | Full text (did / plan / blockers) | Maximum signal for Team Lead; reuses existing entry card pattern with zero new components | Plan |
| Alert display | Badge on member's entry card | Consistent with what the member sees on their own dashboard; no new UI pattern | Plan |
| Route guard | Page-level check → redirect to /dashboard | Mirrors members.astro:9-11; no middleware changes | Plan |
| "No standup yet" | Muted card in same grid (dashed border, lower opacity) | At-a-glance completeness; consistent card layout | Plan |

## Scope

**In scope:**
- New DB migration: Team Lead SELECT policy on standup_entries + `get_workspace_member_emails()` function
- New API endpoint: `POST /api/workspace/update-threshold`
- Route registration: `/team-feed` added to AUTH_REQUIRED_ROUTES + WORKSPACE_REQUIRED_ROUTES
- New Astro page: `src/pages/team-feed.astro`
- Topbar: "Team Feed" nav link for Team Leads

**Out of scope:**
- Date picker (only prev/next buttons)
- Per-member history drill-down (S-06)
- Search or filtering within the feed
- React island for the feed (pure Astro SSR)
- New DB tables (schema already complete)

## Architecture / Approach

Pure Astro SSR: the page queries three tables in parallel (standup_entries, blocker_alerts, get_workspace_member_emails RPC), builds lookup maps keyed by user_id, then renders the card grid server-side. The threshold form is a plain HTML form POSTing to the new API endpoint. No new React components needed — the card layout reuses the pattern from `dashboard.astro:192-227`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB Migration | Team Lead can read standup_entries; member emails are queryable | SECURITY DEFINER function must correctly join auth.users across schema boundaries |
| 2. Threshold API + Routes | Threshold is updatable via POST; /team-feed is route-protected | Minor — straightforward CRUD endpoint following established patterns |
| 3. Team Feed Page + Topbar | Full /team-feed UI with date nav, cards, badge, threshold form | Business-day navigation edge cases (weekend boundaries, clamp logic) |

**Prerequisites:** S-01, S-02, S-03, S-04 all done (confirmed).
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- The `get_workspace_member_emails()` function assumes Supabase's `postgres` owner role can JOIN `auth.users` from within a SECURITY DEFINER function — this is standard Supabase behavior but should be verified in Phase 1 manual testing.
- For the workspace-scoped standup_entries query, the existing index is on `(user_id, submitted_date DESC)` not `(workspace_id, submitted_date)` — acceptable for MVP team sizes; flag for indexing if team sizes grow.

## Success Criteria (Summary)

- Team Lead opens `/team-feed` and sees all workspace members' entries for today, with confirmed blocker badges and "No standup yet" placeholders for members who haven't submitted
- Date navigation steps correctly across business days without landing on weekends
- Threshold update persists and the team feed respects the new value in blocker detection
