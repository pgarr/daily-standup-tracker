<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Standup Entry Edit & Delete

- **Plan**: context/changes/standup-entry-edit-delete/plan.md
- **Scope**: All Phases (1–4)
- **Date**: 2026-06-27
- **Verdict**: APPROVED (after triage fixes)
- **Findings**: 0 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — UPDATE RLS USING clause omits workspace_id

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260627000001_standup_entry_edit_delete.sql:4–7
- **Detail**: UPDATE policy's USING clause checked only `auth.uid() = user_id`. A workspace-migrated user could row-select old-workspace entries as UPDATE candidates. WITH CHECK vetoed actual writes, but posture was asymmetric with INSERT policy.
- **Fix**: New migration 20260627000002 — added `workspace_id = auth_user_workspace_id()` to USING clause, matching INSERT policy.
- **Decision**: FIXED (new migration 20260627000002)

### F2 — E2E tests 1 and 2 have an implicit ordering dependency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/standup-edit-delete.spec.ts:79–113
- **Detail**: Test 1 (edit) and Test 2 (delete) shared mutable `entryId`; test 2 destroyed the row test 1 verified. `--grep "delete"` alone would fail.
- **Fix**: Applied `test.describe.serial()` — ordering is now explicit.
- **Decision**: FIXED via Fix A (test.describe.serial)

### F3 — CSRF guard skips silently when Origin and Referer are both absent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/standup/update.ts:20–29, src/pages/api/standup/delete.ts:17–26
- **Detail**: `if (requestOrigin)` guard is bypassable by clients omitting both Origin and Referer. Codebase-wide pattern. Systemic risk, not unique to this change.
- **Fix**: Deferred — lesson recorded in context/foundation/lessons.md; to be addressed in a dedicated security hardening change covering all POST endpoints.
- **Decision**: ACCEPTED-AS-RULE (lesson saved, defer to hardening change)

### F4 — DELETE RLS USING clause omits workspace_id

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260627000001_standup_entry_edit_delete.sql:9–11
- **Detail**: DELETE has no WITH CHECK — USING is the sole RLS gate. User who left workspace A could delete their old entries permanently.
- **Fix**: Folded into migration 20260627000002 — added `workspace_id = auth_user_workspace_id()` to DELETE USING clause.
- **Decision**: FIXED (folded into F1's migration)

### F5 — Edit form labels not associated with inputs (missing htmlFor/id)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/standup/StandupHistoryList.tsx:107–152
- **Detail**: Edit form `<label>` elements had no `htmlFor`; textareas had no `id`. Clicking a label didn't focus the textarea; screen readers couldn't announce the label. Also missing `noValidate`.
- **Fix**: Added `id="edit-did"`, `id="edit-plan"`, `id="edit-blockers"` and matching `htmlFor` values; added `noValidate` to the form element.
- **Decision**: FIXED

### F6 — No E2E coverage for cross-user ownership isolation

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/standup-edit-delete.spec.ts
- **Detail**: No test verified that a second authenticated user cannot edit another user's entry. The `.eq("user_id", user.id)` + RLS USING gate had no regression coverage.
- **Fix**: Added "ownership guard" test — creates a second user in the same workspace; asserts that POSTing to `/api/standup/update` with the first user's `entryId` returns `302` with `error=Entry+not+found`.
- **Decision**: FIXED
