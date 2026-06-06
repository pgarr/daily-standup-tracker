<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Member Invite and Join

- **Plan**: context/changes/member-invite-and-join/plan.md
- **Scope**: Phase 1 of 4
- **Date**: 2026-06-05
- **Verdict**: NEEDS ATTENTION (resolved during triage)
- **Findings**: 1 critical · 4 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL (resolved) |
| Architecture | PASS |
| Pattern Consistency | WARNING (resolved) |
| Success Criteria | PASS |

## Findings

### F1 — UPDATE policy allows column mutation (workspace_id pivot attack)

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605000000_workspace_invitation.sql:73–80
- **Detail**: WITH CHECK only validated email match. A malicious invited user could UPDATE workspace_id/token to redirect their invitation to a workspace they were not invited to, via direct Supabase API call.
- **Fix A Applied**: Added `accept_invitation(p_token text)` SECURITY DEFINER function in migration 20260605000001. Dropped the "invited user can accept invitation" RLS UPDATE policy. Phase 3 plan updated to use `supabase.rpc('accept_invitation', {p_token})`.
- **Decision**: FIXED via Fix A

### F2 — Non-atomic accept flow creates inconsistency window

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: Design gap (Phase 3 implementation)
- **Detail**: Two-statement accept (INSERT + UPDATE) with compensating DELETE — concurrent accepts race through has_valid_invitation(); crash between statements leaves member without closed invite.
- **Fix**: Resolved by F1's accept_invitation() function (FOR UPDATE lock + atomic transaction).
- **Decision**: ACCEPTED-AS-RULE: Multi-step DB operations that must be atomic belong in a SECURITY DEFINER function

### F3 — get_invitation_by_token has no explicit GRANT statement

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605000000_workspace_invitation.sql:22
- **Detail**: No GRANT/REVOKE clause; anon access intentional but undocumented at the DB layer.
- **Fix**: Added `GRANT EXECUTE ON FUNCTION get_invitation_by_token(text) TO anon, authenticated` with rationale comment to migration 20260605000001.
- **Decision**: FIXED

### F4 — WorkspaceInvitation.role typed as UserRole — wider than DB allows

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/types.ts:21
- **Detail**: DB CHECK (role IN ('member')) but type was UserRole = "member" | "team_lead".
- **Fix**: Changed to `role: "member"` literal type in src/types.ts.
- **Decision**: FIXED

### F5 — SECURITY DEFINER section missing rationale comment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260605000000_workspace_invitation.sql:19
- **Detail**: Sibling migration has multi-line rationale; new migration had only a bare section banner.
- **Fix**: Added 4-line rationale comment matching sibling migration's verbosity.
- **Decision**: FIXED

### F6 — workspace_id queries covered by composite index

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605000000_workspace_invitation.sql:4–14
- **Detail**: UNIQUE (workspace_id, email) B-tree index covers prefix queries on workspace_id alone. No separate index needed.
- **Decision**: ACCEPTED-AS-RULE: A UNIQUE constraint on (col_a, col_b) covers prefix queries on col_a alone

### F7 — Concurrent accepts race — UNIQUE (user_id) backstop

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Detail**: Concurrent accepts could both pass has_valid_invitation() before accepted_at is set. Resolved by F1's FOR UPDATE lock in accept_invitation().
- **Decision**: ACCEPTED (resolved by F1)
