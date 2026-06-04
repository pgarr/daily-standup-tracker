<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Workspace and workspace_member Schema

- **Plan**: `context/changes/workspace-member-schema/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-04
- **Verdict**: SOUND (post-triage)
- **Findings**: 0 critical / 1 warning / 2 observations

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

4/4 existing paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — workspace_member INSERT policy allows team_lead hijack via known UUID

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — workspace_member INSERT policy
- **Detail**: The `WITH CHECK (auth.uid() = user_id AND role = 'team_lead')` policy had no predicate on `workspace_id`. Any authenticated user could INSERT themselves as team_lead into an arbitrary workspace UUID they obtained externally (e.g., from a S-02 invite link). The `UNIQUE(user_id)` constraint only prevents multiple rows per user, not workspace-ownership verification.
- **Fix Applied**: Added `workspace_has_no_members(uuid)` SECURITY DEFINER function and `AND workspace_has_no_members(workspace_id)` to the INSERT policy WITH CHECK. Restricts team_lead self-insert to empty workspaces only.
- **Decision**: FIXED

### F2 — Progress item 1.6 had no backing Success Criteria bullet

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Progress section vs. Manual Verification bullets
- **Detail**: Progress item `1.6` had no corresponding Manual Verification bullet in Phase 1 Success Criteria.
- **Fix Applied**: Added the backing bullet: "Authenticated user can INSERT into workspace, then INSERT into workspace_member with `role='team_lead'`; second INSERT with same `user_id` returns UNIQUE constraint violation."
- **Decision**: FIXED

### F3 — RLS boundary cases absent from Phase 1 success criteria

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Manual Verification
- **Detail**: No verification steps for the critical isolation guarantees: member can only see own row; team lead can see all rows.
- **Fix Applied**: Added two Manual Verification bullets and corresponding Progress items 1.8–1.9.
- **Decision**: FIXED
