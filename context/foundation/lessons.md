# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Use client-generated UUIDs when INSERT caller cannot SELECT the created row

- **Context**: Supabase RLS migrations — any table whose SELECT policy depends on a second table (e.g. workspace SELECT requires workspace_member to exist before the creator can read their own row).
- **Problem**: `Prefer: return=representation` on an INSERT fails with an RLS error because PostgREST tries to SELECT the new row back before the dependency row exists. This was hit in workspace-member-schema (F-01): workspace INSERT with `return=representation` returned 42501 until workspace_member was populated.
- **Rule**: When a table's SELECT RLS policy requires a join to a second table that doesn't exist yet at INSERT time, the caller must generate the UUID client-side (e.g. `crypto.randomUUID()`) and pass it as the `id` field on INSERT — avoiding any SELECT round-trip to recover the generated ID.
- **Applies to**: plan, plan-review, implement

## SECURITY DEFINER guard functions checking "current state" should be VOLATILE, not STABLE

- **Context**: supabase/migrations/20260604000000_workspace_member_schema.sql — `workspace_has_no_members(ws_id uuid)`
- **Problem**: `workspace_has_no_members` was declared STABLE. STABLE allows PostgreSQL to cache the function's result per-argument within a single statement. For single-row INSERTs this is harmless, but for multi-row INSERTs sharing the same workspace_id PostgreSQL can call the function once, cache "no members", and allow all rows through — bypassing the intended "empty workspace only" guard.
- **Rule**: SECURITY DEFINER functions used as RLS guard conditions that check live row state (e.g., "does this workspace have members?") must be declared VOLATILE, not STABLE. STABLE is appropriate only for functions that read a value tied to the calling user's session (e.g., auth_user_workspace_id, auth_user_is_team_lead), where stale results within a statement are semantically safe.
- **Applies to**: plan, plan-review, implement, impl-review
