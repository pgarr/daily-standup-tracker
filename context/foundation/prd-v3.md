---
project: "Daily Standup Tracker"
version: 3
status: draft
created: 2026-05-27
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 5
  hard_deadline: "2026-07-31"
  after_hours_only: true
---

# Daily Standup Tracker

## Vision & Problem Statement

Developers and knowledge workers have no dedicated, searchable home for their daily standup log. Entries scatter across Slack messages, Jira ticket comments, sticky notes, and memory — making it impossible to spot a blocker that has silently persisted for three days. The ritual itself breaks down without a dedicated surface.

The insight that makes this worth building: standup-logging tools already exist (Notion templates, Jira standup comments, Slack bots), but none of them apply a domain rule to the entries. The streak + repeated-blocker alert turns a passive log into an active signal — and that signal is what no existing tool provides.

## User & Persona

**Primary persona**: A developer or knowledge worker who attends or self-documents a daily standup — either as a solo practitioner tracking their own work, or as a member of a small team. They need to answer "what did I actually do last week?" or "why has this been blocked so long?" without digging through Slack history.

**Note on scope**: The user chose "both solo and team use from day one." A solo-first approach (team workspace in v2) is a valid scope-down if MVP proves too large. This tension is carried into Access Control and the MVP functional requirements.

## Success Criteria

### Primary
- A new user registers, creates a workspace, and submits their first standup (did / plan / blockers) successfully.
- A Team Lead views the shared team standup feed showing all members' entries.
- When a member logs the same blocker on 2 or more consecutive business days, a blocker alert is surfaced (to the member and/or Team Lead) after the member confirms the match.

### Secondary
- A user can full-text search their standup history by keyword or date range.

### Guardrails
- A member's standup entries are never visible to other members — only to the Team Lead.
- A submitted standup is durable: if the user sees a confirmation, the entry survives browser refresh and server restart.

## User Stories

### US-01: Member submits first standup

- **Given** a registered member who has joined a workspace
- **When** they fill in the standup form (did: required, plan: required, blockers: optional) and submit
- **Then** they see a success confirmation, their streak increments to 1, and their entry appears in their history list

#### Acceptance Criteria
- Did and Plan fields are required; submission fails with inline error if either is blank
- Blockers field is optional; empty blockers field does not block submission
- Streak counter shows "Day 1" on first successful submission
- Entry appears immediately in the member's history list

### US-02: Blocker alert fires on confirmed repeated blocker

- **Given** a member who logged a blocker entry on a previous business day
- **When** they submit a standup on the next business day with a similar blocker content
- **Then** the system surfaces a match suggestion asking the member to confirm whether it is the same blocker

#### Acceptance Criteria
- Match suggestion is surfaced when the system evaluates consecutive blocker entries as likely similar
- Member confirms or dismisses the suggestion; blocker alert fires only on confirmation
- Alert does not fire when the blocker field is empty
- Alert does not fire when blockers are evaluated as clearly different
- Confirmed blocker alerts are visible to the member and to the Team Lead in the team feed

### US-03: Team Lead views team feed

- **Given** a logged-in Team Lead
- **When** they open the team feed
- **Then** they see today's standup entries for all workspace members; members who haven't submitted show a 'No standup yet' placeholder

#### Acceptance Criteria
- Only Team Lead can see other members' entries; members see only their own
- Team feed shows entries from the current day by default
- Blocker alerts for any team member are visible in the team feed

## Functional Requirements

### Authentication & Workspace

- FR-001: User can register with email + password. Priority: must-have
  > Socratic: Counter-argument considered: "invite-only would control early user base." Resolution: self-registration kept; invite-only adds management overhead for early adopters.

- FR-002: User can log in and log out. Priority: must-have
  > Socratic: Counter-argument considered: "explicit logout is optional if sessions expire automatically." Resolution: kept as must-have; explicit logout button ships; session auto-expiry is an implementation choice.

- FR-003: Team Lead can create a workspace. Priority: must-have
  > Socratic: Counter-argument considered: "pre-create workspaces manually to avoid building self-serve creation." Resolution: kept; self-serve workspace creation is required for any real-world adoption.

- FR-004: Team Lead can invite members via email invite link. Priority: must-have
  > Socratic: Counter-argument considered: "shareable join code is simpler than per-email invites." Resolution: kept as email invite link; join codes weaken access control and are harder to revoke.

- FR-005: Invited user can join a workspace by accepting the invite. Priority: must-have
  > Socratic: Counter-argument considered: none; invite acceptance is required for the team use case. Resolution: invite acceptance merged with registration flow — the link opens registration pre-filled with the invited email.

### Standup Logging

- FR-006: Member can submit a daily standup (did / plan / optional blockers). Priority: must-have
  > Socratic: Counter-argument considered: "blockers field should be optional." Resolution: accepted — blockers field is optional. Did and Plan are required fields; Blockers is optional.

- FR-007: Member can edit their own standup entry. Priority: must-have
  > Socratic: Previously cut from MVP (immutable submissions in v1). Reinstated as must-have per decision on 2026-06-05. Edit capability is part of the core CRUD surface for MVP.

- FR-008: Member can delete their own standup entry. Priority: must-have
  > Socratic: Previously cut from MVP alongside FR-007 (immutable submissions in v1). Reinstated as must-have per decision on 2026-06-05.

### History & Discovery

- FR-009: Member can view a list of their own past entries. Priority: must-have
  > Socratic: Counter-argument considered: "pagination is unnecessary if entry count stays low in MVP." Resolution: kept as must-have; simple flat list ships without pagination. Pagination added in v2 if needed.

- FR-010: Member can search their entry history by keyword. Priority: nice-to-have
  > Socratic: Counter-argument considered: "search is only useful with 30+ entries — the MVP user base won't have that volume." Resolution: deferred to v2. Date filter is sufficient for v1.

- FR-011: Member can see their current streak (consecutive business days logged, Mon–Fri; weekend gaps do not break the streak). Priority: must-have
  > Socratic: Counter-argument considered: "streak is a vanity metric that motivates logging, not quality logging." Resolution: kept; streak is the habit-formation mechanic. Quality of entries is a separate concern. Resolved: business-day streak (Mon–Fri only).

### Blocker Detection

- FR-012: System evaluates consecutive blocker entries for potential similarity, surfaces a match suggestion to the member for confirmation, and fires a blocker alert only upon member confirmation. Priority: must-have
  > Socratic: Counter-argument raised: "consecutive-day matching on free-text is fragile — minor rephrasing breaks detection." Resolution: system evaluates similarity rather than relying on exact text match, and requires member confirmation before alerting — preventing both false positives and missed matches due to rephrasing. The similarity evaluation mechanism is a downstream implementation decision.

### Team Feed

- FR-013: Team Lead can view the shared team standup feed. Priority: must-have
  > Socratic: Counter-argument considered: "partial team feed is misleading — missing entries should be surfaced, not hidden." Resolution: accepted — when a member has not submitted today, their slot in the team feed shows 'No standup yet' rather than being absent.

- FR-014: Team Lead can see blocker alerts across the team. Priority: must-have
  > Socratic: Counter-argument considered: "team-level alerts amplify noise if FR-012 matching is fragile." Resolution: FR-014 is kept; the member-confirmation step in FR-012 guards against noise — alerts in the team feed are confirmed matches only.

- FR-015: Team Lead can configure the blocker alert threshold (number of consecutive business days) for the workspace. Priority: must-have
  > Added during Phase 5 NFR discovery. Default is 2 consecutive business days; Team Lead can adjust per workspace.

## Non-Functional Requirements

- A submitted standup form confirms success to the user within 3 seconds on a standard broadband connection.
- A member's standup entries are never accessible to other members, even by navigating directly to an entry URL — horizontal data isolation is absolute.
- The product is fully usable on the latest two major versions of Chrome, Firefox, Safari, and Edge.
- No standup entry data is shared with third parties. User data (entries, profile, workspace membership) is permanently deleted within 30 days of account deletion.

## Business Logic

The system detects a recurring blocker when a workspace member's standup entries, across N or more consecutive business days (where N is configured by the Team Lead; default is 2), are evaluated as describing the same blocking issue. When the system suspects a match between consecutive blocker entries, it surfaces a confirmation prompt to the member; the blocker alert fires only upon member confirmation.

The inputs the rule consumes are: the content of the member's "blockers" field across consecutive business-day entries, the configured threshold N, and the submission dates of those entries (to verify consecutiveness on business days). The output is a blocker alert: a visible signal attached to the affected member's entries, appearing as a highlighted warning on their standup history and as a flagged entry in the Team Lead's team feed.

The similarity evaluation mechanism — how the system determines whether two blocker entries describe the same issue — is a downstream implementation decision.

## Access Control

Authentication: email + password. No social login in MVP.

Two roles:

- **Member** — can log their own standups, edit their own standup entries, delete their own standup entries, view their own entry history, see their own streak and blocker alerts. Cannot see other members' entries.
- **Team Lead** — all Member capabilities plus: can view the shared team standup feed (all members' entries), can see blocker alerts across the team.

Workspace model: A Team Lead creates a workspace and invites Members via email invite link. A user belongs to one workspace in MVP (multi-workspace is a non-goal). Sign-up: new users register; existing users log in. Unauthenticated users are redirected to login.

Role assignment: the user who creates a workspace becomes Team Lead. Invited users join as Members. Promotion of a Member to Team Lead is a non-goal for MVP.

## Non-Goals

- **No Slack / Jira / GitHub integrations** — standup history stays inside the app in v1. External integrations add auth complexity and API dependency before the core loop is proven.
- **No native mobile app** — the web app must be mobile-browser friendly, but no dedicated iOS or Android app ships in v1.
- **No multi-workspace support** — a user belongs to exactly one workspace in MVP. Workspace-switching is out of scope.
- **No PDF export or report generation** — standup data remains inside the app. Export features ship in v2 if users request them.

## Open Questions

No open questions remain. Both previously open items were resolved before v2 was written:

1. **Blocker matching mechanism** — Resolved: system evaluates similarity between consecutive blocker entries and prompts the member to confirm before surfacing an alert. The evaluation mechanism is a downstream implementation decision. Owner: user. Resolved: 2026-05-27.
2. **Streak calendar vs. business days** — Resolved: business days only (Mon–Fri). Weekend gaps do not break the streak. Owner: user. Resolved: 2026-05-27.
