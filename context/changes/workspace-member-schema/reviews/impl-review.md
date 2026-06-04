<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Workspace and workspace_member Schema

- **Plan**: context/changes/workspace-member-schema/plan.md
- **Scope**: Phase 1 + Phase 2 (all phases)
- **Date**: 2026-06-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — TOCTOU: no partial unique index prevents two concurrent team_lead rows in one workspace

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260604000000_workspace_member_schema.sql:45–49, 86–92
- **Detail**: `workspace_has_no_members` is a non-atomic read-then-insert. Two concurrent users who both observe an empty workspace pass the NOT EXISTS check and both succeed with their INSERT — producing a workspace with two `team_lead` rows. `UNIQUE (user_id)` guards against the same *user* duplicating, but there is no DB-level uniqueness constraint on `(workspace_id) WHERE role = 'team_lead'`. All downstream RLS checks then return non-deterministic results for the workspace.
- **Fix A ⭐ Recommended**: Add `CREATE UNIQUE INDEX ON workspace_member (workspace_id) WHERE role = 'team_lead';` to the existing migration
  - Strength: Converts the TOCTOU window into a serialization error; closes the gap at the DB level regardless of concurrency. Zero application-code changes.
  - Tradeoff: Migration was already applied; requires `npx supabase db reset` locally. No prod data at risk.
  - Confidence: HIGH — standard PostgreSQL pattern, fully supported by Supabase/PostgREST.
  - Blind spot: None significant.
- **Fix B**: New migration with the partial index
  - Strength: Safer if migration has been applied to non-resettable data.
  - Tradeoff: Two migration files for what should be one atomic schema.
  - Confidence: HIGH — viable, just noisier.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added `CREATE UNIQUE INDEX workspace_member_one_team_lead_per_workspace ON workspace_member (workspace_id) WHERE role = 'team_lead';` to migration after line 23.

### F2 — workspace_has_no_members declared STABLE; VOLATILE safer for concurrent multi-row inserts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260604000000_workspace_member_schema.sql:46
- **Detail**: `STABLE` allows PostgreSQL to cache the function's result within a statement. For a single-row INSERT this is harmless. But if a future multi-row INSERT shares the same `workspace_id`, PostgreSQL can call the function once, cache "no members", and allow all rows through. `VOLATILE` forces a fresh table read per call. The plan itself specified `STABLE`; this is a safety observation, not drift.
- **Fix**: Change line 46 from `SECURITY DEFINER STABLE` to `SECURITY DEFINER VOLATILE` on `workspace_has_no_members` only (leave the other two as STABLE).
- **Decision**: FIXED + ACCEPTED-AS-RULE: SECURITY DEFINER guard functions checking "current state" should be VOLATILE, not STABLE

### F3 — team_lead SELECT policy exposes raw auth user_id UUIDs of all workspace members

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260604000000_workspace_member_schema.sql:79–81
- **Detail**: "team lead can view all workspace members" grants full row visibility including `user_id` UUID (maps to `auth.users.id`). Almost certainly intentional for S-02 member management. Undocumented assumption.
- **Fix**: Add comment above the policy: `-- Exposes user_id intentionally: team_lead needs it for S-02 member management.`
- **Decision**: FIXED — added comment above policy documenting intentional user_id exposure.

### F4 — No documentation that service_role bypasses all RLS policies

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/supabase.ts
- **Detail**: `service_role` key bypasses RLS entirely. No comment documents this assumption. If a future server-side function uses the service client by mistake, all six RLS policies are silently skipped.
- **Fix**: Add a comment in `src/lib/supabase.ts` near client creation noting that only the anon key should be used for user-facing requests; service_role must never reach client-side code.
- **Decision**: FIXED — added comment to src/lib/supabase.ts documenting anon-key-only policy and service_role bypass risk.
