# Workspace and workspace_member Schema — Plan Brief

> Full plan: `context/changes/workspace-member-schema/plan.md`

## What & Why

Creates the `workspace` and `workspace_member` tables — the F-01 database foundation every workspace-scoped feature (S-01 through S-05) depends on. No domain tables exist yet; without this slice, S-01 cannot persist workspace creation or Team Lead assignment.

## Starting Point

Supabase is wired for auth only. No `supabase/migrations/` directory, no domain tables, `schema_paths = []` in config.toml, no `src/types.ts`. The Supabase JS client and middleware are production-ready; only the schema layer is missing.

## Desired End State

Both tables exist in Supabase with RLS enabled. An authenticated user can create a workspace (INSERT) and self-assign as Team Lead (INSERT into workspace_member). Members read only their own `workspace_member` row; Team Lead reads all rows in their workspace. `src/types.ts` exports `Workspace`, `WorkspaceMember`, and `UserRole` for downstream use.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Role field type | `text + CHECK (role IN ('member','team_lead'))` | No enum migration overhead; adding roles in v2 is a lightweight ALTER | Plan |
| Member visibility in workspace_member | Own row only (`auth.uid() = user_id`) | Tightest isolation aligned with "absolute data isolation" NFR; no MVP feature requires members to see peers | Plan |
| Workspace creation flow | App-level two INSERTs | Avoids DB trigger/RPC complexity; S-01 handles compensating DELETE on second INSERT failure | Plan |
| One-workspace constraint | `UNIQUE(user_id)` on workspace_member | Enforces MVP non-goal at DB level; downstream slices can assume at most one row per user | Plan |
| workspace.owner_id | No owner_id column | Single source of truth: Team Lead status always derived from workspace_member.role | Plan |
| TypeScript types | Hand-written in src/types.ts | No CLI dependency; sufficient for MVP's infrequent schema evolution | Plan |
| Migration file count | Single file | Both tables are FK-coupled; splitting creates ordering risk | Plan |

## Scope

**In scope:**
- `workspace` table: id, name, alert_threshold (default 2), created_at
- `workspace_member` table: id, workspace_id (FK), user_id (FK auth.users), role (check constraint), joined_at; UNIQUE(user_id)
- Three `SECURITY DEFINER` helper functions to prevent RLS recursion and workspace hijack (`auth_user_workspace_id`, `auth_user_is_team_lead`, `workspace_has_no_members`)
- 6 RLS policies: workspace (INSERT any-auth, SELECT members, UPDATE team_lead); workspace_member (SELECT own, SELECT team_lead, INSERT self-as-team_lead guarded by `workspace_has_no_members`)
- `src/types.ts` with UserRole, Workspace, WorkspaceMember

**Out of scope:**
- workspace DELETE policy (non-goal in MVP)
- workspace_member UPDATE/DELETE policies (no role promotion, no member removal in MVP)
- workspace_member INSERT policy for Team Lead inviting Members (S-02)
- supabase/seed.sql
- Supabase type generation (`supabase gen types typescript`)

## Architecture / Approach

Single migration file (`20260604000000_workspace_member_schema.sql`) applied via Supabase CLI. The ordering within the file is load-bearing: tables first, then three SECURITY DEFINER helper functions (which reference `workspace_member`), then RLS policies (which call the helpers). This ordering avoids forward-reference errors, breaks self-referential RLS recursion, and closes a workspace UUID hijack vector via the `workspace_has_no_members` guard on the team_lead INSERT policy.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Migration | workspace + workspace_member tables, 2 SECURITY DEFINER helpers, 6 RLS policies | A policy gap = silent security bug; SECURITY DEFINER functions without `SET search_path = public` are vulnerable to search_path injection |
| 2. TypeScript types | src/types.ts with UserRole, Workspace, WorkspaceMember | Type drift from schema if columns change later without updating types |

**Prerequisites:** Docker running (for `npx supabase start`); no code dependencies.
**Estimated effort:** ~1 session; Phase 1 is the bulk, Phase 2 is ~10 minutes.

## Open Risks & Assumptions

- **Non-atomic workspace creation**: the S-01 two-INSERT pattern is not wrapped in a DB transaction. If `workspace_member` INSERT fails after `workspace` INSERT succeeds, the workspace row is orphaned — S-01 must compensate with a cleanup DELETE.
- **SECURITY DEFINER search_path**: the helper functions include `SET search_path = public` to prevent injection; this must be preserved if functions are later modified.

## Success Criteria (Summary)

- `npx supabase db reset` applies migration without errors; both tables and 6 policies visible in Supabase Studio with RLS enabled
- Anon SELECT on workspace returns 0 rows (RLS blocking confirmed)
- `npm run build` and `npm run lint` pass with new `src/types.ts`
