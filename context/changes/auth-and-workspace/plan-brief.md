# Auth and Workspace Creation — Plan Brief

> Full plan: `context/changes/auth-and-workspace/plan.md`

## What & Why

S-01 adds the workspace creation flow to a codebase that already has fully-working auth (sign-in, sign-up, sign-out, session middleware). The goal is FR-003: a newly registered user can create a workspace and become its Team Lead. Without this slice, no user-facing feature can store data — every downstream slice (standup submission, team feed, blocker detection) depends on a workspace existing.

## Starting Point

Auth UI and API routes are complete. Middleware attaches `context.locals.user` and protects `/dashboard`, but has no awareness of workspace membership. The `workspace` and `workspace_member` tables (F-01) are live with RLS; `src/types.ts` already exports `Workspace`, `WorkspaceMember`, and `UserRole`. The dashboard is a stub showing user email and a sign-out button.

## Desired End State

A new user registers, logs in, fills in a workspace name on `/workspace/setup`, and arrives at `/dashboard` showing their workspace name and Team Lead role. The middleware enforces three-tier routing: unauthenticated → sign-in, authenticated-no-workspace → `/workspace/setup`, authenticated-with-workspace → dashboard. Signup form inputs are validated with Zod.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| When workspace creation happens | Separate `/workspace/setup` page after first login | Email confirmation in prod means no session at signup time; separate page works consistently in dev and prod | Plan |
| Workspace setup fields | Name only | alert_threshold config is FR-015 (S-05 scope); DB default of 2 covers MVP | Plan |
| Middleware workspace loading | On every authenticated request | One DB call keeps context available to all pages without per-page fetches | Plan |
| Route gating | Three-tier: unauth → signin, auth+no-ws → setup, auth+ws → dashboard | Prevents users reaching dashboard in broken (no-workspace) state | Plan |
| Non-atomic failure handling | Compensating DELETE on workspace_member INSERT failure | Avoids orphaned workspace rows; retry path stays clean | Plan (+ F-01 lesson) |
| Workspace UUID | Client-generated (`crypto.randomUUID()`) | SELECT RLS on workspace requires workspace_member first; avoids `return=representation` RLS 42501 | Lesson (F-01) |
| Input validation | Zod on signup.ts + workspace create endpoint | CLAUDE.md convention; Supabase errors are too generic to surface usefully | Plan |

## Scope

**In scope:**
- Three-tier middleware routing + workspace context loading
- `/workspace/setup` page + `WorkspaceSetupForm` component + `POST /api/workspace/create`
- Dashboard showing workspace name + Team Lead role
- Zod validation on signup.ts and create.ts
- `signin.ts` redirect change from `/` to `/dashboard`

**Out of scope:**
- Workspace editing / deletion (S-05)
- Member invitation (S-02)
- signin.ts Zod validation
- Social / passwordless login
- Email template customization

## Architecture / Approach

Middleware is the single authority for workspace context: one `workspace_member` query per authenticated request, results attached to `context.locals`. Routing gates use two route lists (`AUTH_REQUIRED_ROUTES`, `WORKSPACE_REQUIRED_ROUTES`). Workspace creation uses the F-01-documented non-atomic pattern: client-generated UUID → INSERT workspace → INSERT workspace_member → compensating DELETE on failure. New UI follows the existing auth component patterns (FormField, SubmitButton, ServerError from `src/components/auth/`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. App.Locals + middleware gating | Typed workspace context in every page; three-tier routing enforced | Middleware null-guard on createClient(); maybeSingle() vs single() |
| 2. Workspace setup page + API | `/workspace/setup` page, form, create endpoint, signin redirect fix | Non-atomic INSERT + compensating DELETE correctness |
| 3. Dashboard + signup validation | Dashboard shows workspace/role; signup.ts gets Zod | None — straightforward updates |

**Prerequisites:** F-01 migration applied (workspace + workspace_member tables with RLS).
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- In production, email confirmation is required before first login — the setup page flow handles this correctly but the manual testing steps assume dev mode (auto-confirm) for most verification.
- Middleware adds one Supabase round-trip per request; acceptable at MVP scale (low QPS per PRD), but worth profiling if latency degrades in production.

## Success Criteria (Summary)

- Full E2E: register → login → workspace setup → dashboard showing workspace name and "Team Lead"
- Three-tier routing enforced at middleware level (verified manually)
- No orphaned workspace rows on partial creation failure
