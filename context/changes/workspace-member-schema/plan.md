# Workspace and workspace_member Schema Implementation Plan

## Overview

Creates the `workspace` and `workspace_member` Supabase tables — the F-01 foundation that all workspace-scoped features (S-01 through S-05) depend on. Includes per-operation, per-role RLS policies, SECURITY DEFINER helper functions, and the TypeScript types downstream slices will consume.

## Current State Analysis

No domain tables exist. Supabase is wired for auth only (`schema_paths = []` in `supabase/config.toml`; no `supabase/migrations/` directory). `src/types.ts` does not exist. `Astro.locals.user` provides the Supabase `User` object (with `.id`) via the existing middleware — this `.id` maps directly to `auth.uid()` in RLS policies.

## Desired End State

`workspace` and `workspace_member` tables exist in the local and remote Supabase instance with row-level security enabled. The S-01 implementation can insert a workspace and self-assign Team Lead in two sequential INSERTs without hitting an RLS denial. Members can only read their own `workspace_member` row; Team Lead can read all rows in their workspace. `src/types.ts` exports `Workspace`, `WorkspaceMember`, and `UserRole` for downstream consumption.

Verify by: running `npx supabase db reset` without errors, inspecting both tables and all 6 RLS policies in Supabase Studio.

### Key Discoveries

- `supabase/migrations/` directory does not exist — must be created with this change.
- `schema_paths = []` in `config.toml` is for schema-only (non-timestamped) files; timestamped migrations in `supabase/migrations/` are discovered automatically — no `config.toml` update needed.
- `auth.uid()` in RLS policies maps to `Astro.locals.user.id` provided by the existing middleware.
- A Team Lead's SELECT policy on `workspace_member` must check the requesting user's own membership record to confirm `role = 'team_lead'`. Querying `workspace_member` inside a `workspace_member` RLS policy creates a self-referential loop. Fix: three `SECURITY DEFINER STABLE` functions (`auth_user_workspace_id`, `auth_user_is_team_lead`, `workspace_has_no_members`) that bypass RLS for those inner checks.
- The workspace_member INSERT policy must prevent a user from claiming `team_lead` in a workspace they did not create (exploitable if a workspace UUID is known, e.g., from a future S-02 invite link). Fix: `workspace_has_no_members(workspace_id)` guard restricts self-insert as team_lead to empty workspaces only.
- The S-01 workspace creation flow (two sequential INSERTs from the Supabase JS client) is **not atomic**. If the `workspace_member` INSERT fails after `workspace` INSERT succeeds, the workspace row is orphaned. S-01 must compensate with a cleanup DELETE on the workspace row.

## What We're NOT Doing

- No `supabase/seed.sql` — seed data belongs to individual feature slices.
- No `supabase/config.toml` changes — timestamped migrations are discovered automatically.
- No RLS INSERT policy for Team Lead inviting Members — that is S-02's scope.
- No UPDATE or DELETE policies on `workspace_member` — role promotion and member removal are MVP non-goals.
- No `owner_id` column on `workspace` — Team Lead status is always derived from `workspace_member.role`.
- No Supabase type generation (`supabase gen types typescript`) — hand-written types in `src/types.ts`.

## Implementation Approach

Single migration file with both tables and all policies. Tables are created first, then the `SECURITY DEFINER` helper functions (which reference `workspace_member`), then the RLS policies (which reference the helpers). TypeScript types are written as a separate phase after the migration is verified locally.

## Critical Implementation Details

**SECURITY DEFINER recursion workaround**: the Team Lead SELECT policy on `workspace_member` must check if `auth.uid()` has `role = 'team_lead'` in `workspace_member` — but that check re-triggers the same RLS policy, causing infinite recursion. Three `SECURITY DEFINER STABLE` functions (`auth_user_workspace_id`, `auth_user_is_team_lead`, `workspace_has_no_members`) bypass RLS when called, breaking the loop. These must appear in the migration **after** both tables are created and **before** any policy that calls them.

**Non-atomic workspace creation**: the Supabase JS client does not wrap multiple `.insert()` calls in a DB transaction. If the `workspace_member` INSERT fails after the `workspace` INSERT succeeds, the workspace row is orphaned. S-01 must handle this by attempting a compensating DELETE on the workspace row when the second INSERT returns an error.

**workspace INSERT must use client-generated UUID**: the workspace SELECT policy requires a `workspace_member` row to exist before the creator can SELECT their workspace. Using `Prefer: return=representation` on the workspace INSERT fails because PostgREST tries to SELECT the new row back before the workspace_member row exists. S-01 must generate the workspace UUID on the client side (e.g., `crypto.randomUUID()`) and pass it as the `id` field on INSERT, avoiding any SELECT round-trip to obtain the workspace ID.

---

## Phase 1: Migration — workspace and workspace_member schema with RLS

### Overview

Creates `supabase/migrations/20260604000000_workspace_member_schema.sql` with both tables, the SECURITY DEFINER helper functions, and all RLS policies needed for workspace creation and read flows.

### Changes Required

#### 1. Migration SQL file

**File**: `supabase/migrations/20260604000000_workspace_member_schema.sql`

**Intent**: Define both tables, their constraints, the SECURITY DEFINER helpers, and all RLS policies in a single atomic migration. This is the first migration for the project; the helper function pattern here will be reused by future policy-bearing migrations.

**Contract**: Complete file — write exactly these definitions in this order (FK ordering and helper-before-policy ordering are both load-bearing):

```sql
-- workspace: workspace identity and per-workspace configuration.
-- alert_threshold (FR-015): number of consecutive business days before a blocker alert fires.
CREATE TABLE workspace (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  alert_threshold integer     NOT NULL DEFAULT 2,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;

-- workspace_member: user→workspace mapping with role.
-- UNIQUE (user_id) enforces the one-workspace-per-user MVP constraint at the DB level.
CREATE TABLE workspace_member (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('member', 'team_lead')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE workspace_member ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helpers: bypass RLS for inner membership checks used by team_lead
-- policies, preventing self-referential recursion on workspace_member.
-- SET search_path = public guards against search_path injection.
CREATE OR REPLACE FUNCTION auth_user_workspace_id()
  RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT workspace_id FROM workspace_member WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_user_is_team_lead()
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT EXISTS (
    SELECT 1 FROM workspace_member
    WHERE user_id = auth.uid() AND role = 'team_lead'
  );
$$;

-- Guards the team_lead INSERT policy: only allows self-insert into a workspace
-- that has no existing members, preventing team_lead hijack via a known workspace UUID.
CREATE OR REPLACE FUNCTION workspace_has_no_members(ws_id uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT NOT EXISTS (SELECT 1 FROM workspace_member WHERE workspace_id = ws_id);
$$;

-- workspace RLS --

-- Any authenticated user can create a workspace (FR-003)
CREATE POLICY "authenticated users can create a workspace"
  ON workspace FOR INSERT TO authenticated
  WITH CHECK (true);

-- Members and Team Lead can read the workspace they belong to
CREATE POLICY "workspace members can view their workspace"
  ON workspace FOR SELECT TO authenticated
  USING (id = auth_user_workspace_id());

-- Only the Team Lead of this workspace can update workspace settings
CREATE POLICY "team lead can update workspace settings"
  ON workspace FOR UPDATE TO authenticated
  USING  (auth_user_is_team_lead() AND id = auth_user_workspace_id())
  WITH CHECK (auth_user_is_team_lead() AND id = auth_user_workspace_id());

-- DELETE: no policy — implicitly denied for all roles in MVP

-- workspace_member RLS --

-- Every authenticated user can see their own membership row
CREATE POLICY "members can view own workspace_member row"
  ON workspace_member FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Team Lead can view all member rows in their workspace
CREATE POLICY "team lead can view all workspace members"
  ON workspace_member FOR SELECT TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Workspace creation: user inserts themselves as team_lead into an empty workspace.
-- workspace_has_no_members guard prevents hijacking a known workspace UUID.
-- S-02 will add a separate policy for Team Lead inserting invited members.
CREATE POLICY "workspace creator can join as team_lead"
  ON workspace_member FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'team_lead'
    AND workspace_has_no_members(workspace_id)
  );

-- UPDATE: no policy — no role promotion in MVP
-- DELETE: no policy — member removal is a non-goal in MVP
```

### Success Criteria

#### Automated Verification

- Migration file exists at `supabase/migrations/20260604000000_workspace_member_schema.sql`
- `npx supabase db reset` completes without errors (requires Docker + `npx supabase start`)
- `npm run build` passes (no TypeScript or Astro build errors introduced)

#### Manual Verification

- Supabase Studio (http://127.0.0.1:54323) → Table Editor shows both `workspace` and `workspace_member` with correct columns and defaults
- `\d workspace_member` in psql confirms UNIQUE constraint on `user_id` and CHECK constraint on `role`
- Authentication → Policies lists all 6 policies (2 on workspace, 4 on workspace_member)
- SQL editor (anon role): `SELECT * FROM workspace;` returns 0 rows — RLS blocks unauthenticated access
- Authenticated user can INSERT into workspace, then INSERT into workspace_member with `role='team_lead'`; a second INSERT with the same `user_id` returns a UNIQUE constraint violation
- SELECT on workspace_member as a Member user returns exactly 1 row (own); no peer rows are visible
- SELECT on workspace_member as the Team Lead returns all rows in the workspace

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: TypeScript types in src/types.ts

### Overview

Adds `UserRole`, `Workspace`, and `WorkspaceMember` to `src/types.ts` so downstream slices have a typed representation of the schema from day one.

### Changes Required

#### 1. Domain entity types

**File**: `src/types.ts` (new file)

**Intent**: Hand-write entity types mirroring the Phase 1 migration columns. `UserRole` as a string union gives TypeScript exhaustiveness checking without a generated DB types file.

**Contract**: Export three declarations matching migration column names and types exactly:

```typescript
export type UserRole = 'member' | 'team_lead';

export interface Workspace {
  id: string;
  name: string;
  alert_threshold: number;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: UserRole;
  joined_at: string;
}
```

### Success Criteria

#### Automated Verification

- `npm run build` passes (no TypeScript errors)
- `npm run lint` passes

#### Manual Verification

- Column names in `src/types.ts` match migration column names exactly (no drift between schema and types)

---

## Testing Strategy

### Manual Testing Steps

1. `npx supabase start` → `npx supabase db reset` — confirm no errors in terminal output
2. Open Supabase Studio at http://127.0.0.1:54323
3. Table Editor: verify both tables exist with correct columns, data types, and defaults
4. Authentication → Policies: confirm 6 policies are listed across both tables
5. SQL Editor (select role "anon"): `SELECT * FROM workspace;` → must return 0 rows
6. Confirm UNIQUE constraint: attempt inserting two `workspace_member` rows with the same `user_id` — second insert must fail with a unique violation

## Migration Notes

First migration for this project — `supabase/migrations/` directory must be created. Subsequent migrations follow the same `YYYYMMDDHHmmss_short_description.sql` naming convention from CLAUDE.md.

The helper functions `auth_user_workspace_id()`, `auth_user_is_team_lead()`, and `workspace_has_no_members()` are shared infrastructure. S-02 will reuse `auth_user_is_team_lead()` in its Team Lead INSERT policy for inviting members; `workspace_has_no_members()` is only used by the team_lead self-insert policy in this migration.

## References

- Roadmap item F-01: `context/foundation/roadmap.md`
- PRD Access Control + FR-003 + FR-015 + NFR data isolation: `context/foundation/prd-v2.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration — workspace and workspace_member schema with RLS

#### Automated

- [x] 1.1 Migration file exists at supabase/migrations/20260604000000_workspace_member_schema.sql — e3d981d
- [x] 1.2 npx supabase db reset applies migration without errors — e3d981d
- [x] 1.3 npm run build passes — e3d981d

#### Manual

- [x] 1.4 Both tables exist in Supabase with correct columns and constraints — e3d981d
- [x] 1.5 RLS is enabled on both tables; all 6 policies are visible in Studio — e3d981d
- [x] 1.6 Authenticated user can INSERT into workspace and workspace_member as team_lead; second INSERT with same user_id fails with UNIQUE violation — e3d981d
- [x] 1.7 Anon SELECT on workspace returns 0 rows (RLS blocks unauthenticated access) — e3d981d
- [x] 1.8 Member SELECT on workspace_member returns only own row (no peer rows visible) — e3d981d
- [x] 1.9 Team Lead SELECT on workspace_member returns all rows in the workspace — e3d981d

### Phase 2: TypeScript types in src/types.ts

#### Automated

- [x] 2.1 npm run build passes
- [x] 2.2 npm run lint passes

#### Manual

- [ ] 2.3 Types in src/types.ts match migration columns exactly
