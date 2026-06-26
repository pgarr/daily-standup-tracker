<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Blocker Detection Flow (S-04) Implementation Plan

- **Plan**: context/changes/blocker-detection-flow/plan.md
- **Mode**: Deep
- **Date**: 2026-06-07
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

5/5 paths ✓ (2 correctly absent: similarity.ts, migration), 4/4 symbols ✓ (rawBlockers:55, isNextBusinessDay, shouldSuggestBlockerMatch, Workspace.alert_threshold:6), brief↔plan ✓

Additional verification via sub-agent:
- No existing E2E tests will break from the `?blocker_match=1` redirect change ✓
- `workspace_member` pattern in submit.ts:41–46 is documented for API routes and reusable verbatim ✓
- `workspace!` non-null assertion is safe: middleware redirects to `/workspace/setup` before SSR runs if workspace is null ✓

## Findings

### F1 — Upsert without `ignoreDuplicates: true` is semantically wrong for immutable data

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 (RLS schema) + Phase 3 (confirm/dismiss contracts)
- **Detail**: The plan says no UPDATE policy (alerts immutable), but the upsert contract generates ON CONFLICT DO UPDATE. PostgreSQL's permissive RLS produces a silent 0-row no-op today, but it's fragile: a future UPDATE policy would silently overwrite status, and stricter PG configs may error. `ignoreDuplicates: true` is the semantically correct primitive for immutable data.
- **Fix**: Add `ignoreDuplicates: true` to both upsert calls in confirm.ts and dismiss.ts contracts.
- **Decision**: FIXED — added `ignoreDuplicates: true` to both upsert contracts in Phase 3.

### F2 — Phase 1 Progress tracks 5 criteria; plan body has 6 success criteria

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria / Progress section
- **Detail**: Phase 1 Manual Verification had a 3rd item ("npm run build succeeds; no new type errors") duplicating automated criterion 1.2. The Progress section tracked only 1.4–1.5, so the 3rd item had no checkbox.
- **Fix**: Remove the duplicate manual build criterion from Phase 1 body.
- **Decision**: FIXED — duplicate criterion removed from Phase 1 Manual Verification.
