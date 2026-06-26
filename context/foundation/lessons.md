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

## Multi-step DB operations that must be atomic belong in a SECURITY DEFINER function

- **Context**: member-invite-and-join accept flow — two-statement accept (INSERT workspace_member, then UPDATE workspace_invitation.accepted_at) with compensating DELETE.
- **Problem**: Between the two statements the invite still appears pending, concurrent accepts can both pass has_valid_invitation() and race to insert, and if the second statement never executes the member row exists with no closed invite. The compensating DELETE is best-effort and cannot guarantee consistency.
- **Rule**: When two or more DB writes must succeed or fail together (e.g., claim a resource and mark it consumed), wrap them in a single SECURITY DEFINER function using FOR UPDATE row-locking and plpgsql transactions. Do not rely on application-layer compensation (DELETE on failure) as the primary consistency mechanism.
- **Applies to**: plan, plan-review, implement, impl-review

## A UNIQUE constraint on (col_a, col_b) covers prefix queries on col_a alone

- **Context**: workspace_invitation table — UNIQUE (workspace_id, email) raised a question about whether a separate workspace_id index was needed.
- **Problem**: It is easy to assume that a composite UNIQUE constraint only helps equality queries on both columns together, leading to unnecessary extra indexes.
- **Rule**: PostgreSQL B-tree indexes (including those backing UNIQUE constraints) support prefix lookups. A UNIQUE index on (a, b) efficiently serves WHERE a = ? queries in addition to WHERE a = ? AND b = ? queries. Before adding a standalone index on a leading composite column, verify one does not already exist via a UNIQUE or other composite constraint.
- **Applies to**: plan, plan-review, implement, impl-review

## Close the linked GitHub issue on impl-review completion

- **Context**: Any phase touching a tracked roadmap item with a linked GitHub issue.
- **Problem**: Issue stays Open after work is merged — gives a misleading picture of project state in the tracker.
- **Rule**: Close the linked GitHub issue when a change's impl-review is complete and work is merged. Update the issue's Status field before closing.
- **Applies to**: implement, impl-review

## POST form endpoints must validate Origin or Referer header

- **Context**: POST API endpoints under `src/pages/api/` that handle HTML form submissions (e.g. `src/pages/api/workspace/invite-cancel.ts`).
- **Problem**: Without an explicit Origin/Referer check, CSRF safety relies on Supabase cookie `SameSite=Lax` defaults. If cookie configuration ever changes to `SameSite=None` (e.g. for an embedded context), cross-site POSTs become exploitable. Hit during navigation impl-review (F4).
- **Rule**: Every POST endpoint that accepts form submissions must check the `Origin` or `Referer` header against the app's own origin (`context.url.origin`) at the top of the handler. Return 403 on mismatch. Pattern: parse the header with `new URL(...)` and compare `.origin` fields. Absence of the header is permissive (may be a direct API call).
- **Applies to**: plan, plan-review, implement, impl-review

## Silent LLM fallback can mask model deprecation or API failures

- **Context**: src/lib/similarity.ts — haikuSimilarity catches all Anthropic API errors and falls back to Jaccard similarity without surfacing the failure to callers or operators.
- **Problem**: If the model snapshot ID is deprecated (or billing lapses, or the API rate-limits), every call silently downgrades to the keyword-match fallback. LLM-based detection stops working with no visible signal — accuracy degrades invisibly.
- **Rule**: [Fill in: e.g. "When an LLM call falls back to a deterministic alternative, log a warning at WARN level (not just console.error) and expose a health metric or flag so operators can detect silent degradation."]
- **Applies to**: [Fill in: e.g. "Any module that silently falls back from an LLM API call to a non-LLM alternative."]
