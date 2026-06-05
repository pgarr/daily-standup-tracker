---
project: "Daily Standup Tracker"
version: 1
status: draft
created: 2026-06-04
updated: 2026-06-05
prd_version: 2
main_goal: market-feedback
top_blocker: time
---

# Roadmap: Daily Standup Tracker

> Derived from `context/foundation/prd-v2.md` (v2) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Developers and knowledge workers have no dedicated home for their daily standup log — entries scatter across Slack, Jira comments, and memory, making it impossible to spot a blocker that has silently persisted for days. What makes this worth building is the domain rule applied on top of the log: the streak counter and repeated-blocker alert turn a passive log into an active signal that no other standup tool provides. The product's distinguishing trait — the one feature that, if removed, makes it indistinguishable from any other standup logger — is that it detects and surfaces recurring blockers, confirmed by the member, to both the member and the Team Lead.

## North star

**S-05: Team Lead views team feed with confirmed blocker alerts** — the north star is the smallest end-to-end slice whose successful delivery proves the product's core hypothesis: that the system correctly detects recurring blockers (the core hypothesis being that similarity-based detection + member confirmation surfaces persistent impediments that would otherwise be invisible to Team Leads), surfaces them through member confirmation, and makes them visible in a shared team feed. Every other slice exists to enable this one.

## At a glance

| ID   | Change ID                      | Outcome (user can …)                                                                           | Prerequisites          | PRD refs                            | Status   |
|------|--------------------------------|------------------------------------------------------------------------------------------------|------------------------|-------------------------------------|----------|
| F-01 | workspace-member-schema        | (foundation) workspace and workspace_member tables exist with RLS                             | —                      | NFR (data isolation), Access Control | done     |
| S-01 | auth-and-workspace             | register, log in/out, and create a workspace (becoming Team Lead)                              | F-01                   | FR-001, FR-002, FR-003              | done     |
| S-02 | member-invite-and-join         | Team Lead invites a member by email; invited user joins the workspace as a Member              | S-01                   | FR-004, FR-005                      | proposed |
| S-03 | standup-submission-and-history | submit a standup, view their history list, and see their streak                                | S-01                   | FR-006, FR-009, FR-011, US-01       | proposed |
| S-04 | blocker-detection-flow         | submit two similar consecutive blockers, see a match suggestion, confirm it, and see an alert  | S-03                   | FR-012, US-02                       | proposed |
| S-05 | team-feed-and-alerts           | view the team feed with today's entries, confirmed alerts, and configure the alert threshold   | S-01, S-02, S-03, S-04 | FR-013, FR-014, FR-015, US-03       | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                                          | Note                                                                       |
|--------|------------------------|------------------------------------------------|----------------------------------------------------------------------------|
| A      | Core validation path   | `F-01` → `S-01` → `S-03` → `S-04` → `S-05`   | Critical path to the north star; sequences the standup + blocker mechanic. |
| B      | Member onboarding      | `S-02`                                         | Branches from S-01 parallel with S-03; joins Stream A at S-05.             |

## Baseline

What's already in place in the codebase as of 2026-06-04 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6 + React 19 + Tailwind 4 wired; landing and dashboard pages exist; shadcn/ui minimal (button.tsx only) — `src/pages/dashboard.astro`
- **Backend / API:** partial — Astro SSR + Cloudflare Workers runtime wired; only auth API routes exist; no domain business logic — `src/pages/api/auth/`
- **Data:** partial — Supabase client wired for auth only; no domain tables, no migrations — `supabase/config.toml` (`schema_paths = []`)
- **Auth:** partial — Supabase auth fully wired (sign-in/up/out, session, middleware); no workspace, role, or team concepts — `src/middleware.ts`
- **Deploy / infra:** present — GitHub Actions CI + Cloudflare Workers deploy via wrangler; secrets configured — `.github/workflows/ci.yml`
- **Observability:** partial — `wrangler.jsonc` has `observability: enabled`; no logging library or error tracking in app code

## Foundations

### F-01: workspace-member-schema

- **Outcome:** (foundation) `workspace` and `workspace_member` tables exist in Supabase with row-level security policies; a new workspace can be created and a user can be assigned the Team Lead role on creation.
- **Change ID:** workspace-member-schema
- **PRD refs:** NFR "A member's standup entries are never accessible to other members, even by navigating directly to an entry URL — horizontal data isolation is absolute"; Access Control section (two-role model: Member / Team Lead; one workspace per user in MVP)
- **Unlocks:** S-01 (workspace creation + Team Lead role assignment can be persisted and verified end-to-end); the data isolation NFR requires RLS to be correct before any user-facing data flows touch workspace-scoped rows
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** RLS policies on workspace tables are the first and most critical access control contract; a gap here violates the absolute data isolation NFR silently — getting them right in this foundation prevents per-slice policy patches later
- **Status:** done

## Slices

### S-01: auth-and-workspace

- **Outcome:** user can register with email + password, log in, log out, and a newly registered user can create a workspace and become its Team Lead.
- **Change ID:** auth-and-workspace
- **PRD refs:** FR-001, FR-002, FR-003
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** workspace creation must wire correctly with the F-01 schema (insert into `workspace`, assign Team Lead role in `workspace_member`); this is the root of the entire auth + access control chain — a schema mismatch here propagates through every downstream slice
- **Status:** done

### S-02: member-invite-and-join

- **Outcome:** Team Lead can send an email invite to a new member; the invited user registers via the invite link and appears in the workspace as a Member.
- **Change ID:** member-invite-and-join
- **PRD refs:** FR-004, FR-005
- **Prerequisites:** S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - How will the invite email be sent — Supabase built-in invite / magic link, custom SMTP, or Resend? — Owner: user. Block: no (implementation choice; any mechanism satisfying FR-004/FR-005 acceptance criteria is valid).
- **Risk:** invite acceptance merges with registration (per FR-005: "the link opens registration pre-filled with the invited email"); this double-duty path needs care to avoid orphaned invite records or duplicate accounts; sequenced before S-05 because the team feed needs actual members to be meaningful
- **Status:** proposed

### S-03: standup-submission-and-history

- **Outcome:** member can submit a standup (did and plan required; blockers optional), immediately see their history list, and see their streak counter showing consecutive business days logged (Mon–Fri; weekend gaps do not reset the streak).
- **Change ID:** standup-submission-and-history
- **PRD refs:** FR-006, FR-009, FR-011, US-01
- **Prerequisites:** S-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:**
  - Should "consecutive business day" for streak computation be evaluated in UTC or the user's local timezone? — Owner: user. Block: no (implementation decision; an explicit choice should be recorded in `/10x-plan standup-submission-and-history`).
- **Risk:** `standup_entries` table and business-day streak logic introduce new Supabase migrations; on the critical path to the north star (S-04 and S-05 both depend on this slice) — any schema gap or streak bug defers the validation milestone
- **Status:** proposed

### S-04: blocker-detection-flow

- **Outcome:** when a member submits two or more consecutive business-day standups with similar blocker content, a match suggestion is surfaced; the member confirms or dismisses the suggestion; a confirmed match fires a blocker alert visible in the member's history.
- **Change ID:** blocker-detection-flow
- **PRD refs:** FR-012, US-02
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How will blocker similarity be evaluated — keyword overlap, Levenshtein distance, or an external AI inference call (per tech-stack.md: AI is out-of-bundle, would be wired as an Astro API route or Cloudflare Worker)? — Owner: user. Block: no. prd-v2.md Business Logic explicitly defers this to a downstream implementation decision; any mechanism satisfying US-02 acceptance criteria is valid.
- **Risk:** similarity evaluation is the product's core differentiating mechanic; if it fires too eagerly (false positives) or too rarely, user trust breaks before the north star is demonstrated — getting the similarity heuristic right in this slice matters even if the exact mechanism is an implementation call
- **Status:** proposed

### S-05: team-feed-and-alerts

- **Outcome:** Team Lead can open the team feed and see today's standup entries for all workspace members (with "No standup yet" placeholders for members who haven't submitted), confirmed blocker alerts for any member, and can configure the workspace's alert threshold (default: 2 consecutive business days).
- **Change ID:** team-feed-and-alerts
- **PRD refs:** FR-013, FR-014, FR-015, US-03
- **Prerequisites:** S-01, S-02, S-03, S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** this is the north star and the most integration-heavy slice — it reads from workspace members (S-01/S-02), standup entries (S-03), and blocker alerts (S-04); any upstream schema or RLS gap surfaces here; also the first slice where Team Lead role gating is exercised end-to-end
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                      | GitHub Issue                                                                                     | Ready for `/10x-plan` | Notes                                    |
|------------|--------------------------------|--------------------------------------------------------------------------------------------------|-----------------------|------------------------------------------|
| F-01       | workspace-member-schema        | [#1 Add workspace + workspace_member schema with RLS](https://github.com/pgarr/daily-standup-tracker/issues/1) | yes    | Run `/10x-plan workspace-member-schema`  |
| S-01       | auth-and-workspace             | [#2 Auth flow + workspace creation + Team Lead role](https://github.com/pgarr/daily-standup-tracker/issues/2)  | no     | Requires F-01                            |
| S-02       | member-invite-and-join         | [#3 Email invite + member registration + workspace join](https://github.com/pgarr/daily-standup-tracker/issues/3) | no  | Requires S-01; parallel with S-03        |
| S-03       | standup-submission-and-history | [#4 Standup form + history list + business-day streak](https://github.com/pgarr/daily-standup-tracker/issues/4)  | no  | Requires S-01; parallel with S-02        |
| S-04       | blocker-detection-flow         | [#5 Blocker similarity detection + confirmation UI + alert recording](https://github.com/pgarr/daily-standup-tracker/issues/5) | no | Requires S-03 |
| S-05       | team-feed-and-alerts           | [#6 Team feed + confirmed alerts + threshold config ⭐ north star](https://github.com/pgarr/daily-standup-tracker/issues/6) | no | Requires S-01, S-02, S-03, S-04 |

## Open Roadmap Questions

No blocking questions remain — both PRD v1 Open Questions were resolved in prd-v2.md (blocker matching: similarity + member confirmation; streak: business days only, Mon–Fri).

Non-blocking implementation questions (do not block planning; surface at `/10x-plan` time):

1. **How should the invite email be sent?** (Supabase built-in invite, custom SMTP, or Resend) — Owner: user. Block: S-02 implementation detail only.
2. **Should business-day streak evaluation use UTC or user local timezone?** — Owner: user. Block: S-03 implementation detail only.
3. **What similarity mechanism will power blocker detection?** (keyword overlap, Levenshtein, or AI inference call via external endpoint) — Owner: user. Block: S-04 implementation detail only.

## Parked

- **No Slack / Jira / GitHub integrations** — Why parked: PRD §Non-Goals; external integrations add auth complexity before the core loop is proven.
- **No native mobile app** — Why parked: PRD §Non-Goals; web app must be mobile-browser-friendly; dedicated iOS/Android ships in v2 if warranted.
- **No multi-workspace support** — Why parked: PRD §Non-Goals; a user belongs to exactly one workspace in MVP.
- **No PDF export or report generation** — Why parked: PRD §Non-Goals; ships in v2 if users request it.
- **FR-007: Member can edit own standup** — Why parked: nice-to-have per PRD; immutable submissions in v1 reduce CRUD surface.
- **FR-008: Member can delete own standup** — Why parked: nice-to-have per PRD; deferred alongside FR-007.
- **FR-010: Full-text search of history** — Why parked: nice-to-have per PRD; useful only at 30+ entries; date filter sufficient for v1.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)

- **F-01: (foundation) workspace and workspace_member tables exist with RLS** — Archived 2026-06-04 → `context/archive/2026-06-04-workspace-member-schema/`. Lesson: —.
- **S-01: user can register with email + password, log in, log out, and a newly registered user can create a workspace and become its Team Lead.** — Archived 2026-06-05 → `context/archive/2026-06-04-auth-and-workspace/`. Lesson: —.
