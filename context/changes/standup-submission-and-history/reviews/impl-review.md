<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Standup Submission and History

- **Plan**: context/changes/standup-submission-and-history/plan.md
- **Scope**: All phases (Phase 1–3)
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION (all findings fixed/skipped)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — route-coverage test failing: 2 ungated S-02 routes not registered

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/__tests__/route-coverage.test.ts:12
- **Detail**: `npm test` exits non-zero. The route-coverage test reports 2 ungated routes: `/api/workspace/accept-invite` and `/auth/accept-invite`. Both were added by S-02 but never registered in the test's `EXPLICIT_PUBLIC_ROUTES` set. The S-03 plan criterion 2.1 "npm test exits 0" was marked passing — the 7 streak tests pass in isolation but the full suite does not exit 0.
- **Fix**: Add the two S-02 routes to EXPLICIT_PUBLIC_ROUTES in route-coverage.test.ts.
- **Decision**: FIXED

### F2 — submit.ts missing `export const prerender = false`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/standup/submit.ts:1
- **Detail**: CLAUDE.md requires all API routes to export `const prerender = false`. Every other API route has it. Under `output: "server"` the omission causes no runtime failure but violates the project convention and the plan's explicit requirement.
- **Fix**: Added `export const prerender = false;` as the first line.
- **Decision**: FIXED

### F3 — `user?.id ?? ""` passes empty string instead of null-guarding

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:19
- **Detail**: The query used `.eq("user_id", user?.id ?? "")` — an empty-string fallback added to satisfy the linter's no-non-null-assertion rule. The correct pattern is an early null-check redirect before the query block, matching workspace/members.astro.
- **Fix**: Added `if (!user) return Astro.redirect("/auth/signin");` before the query block; changed to `user.id` directly.
- **Decision**: FIXED

### F4 — StandupForm prop named `error` breaks peer convention `serverError`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/standup/StandupForm.tsx:7
- **Detail**: `WorkspaceSetupForm.tsx` uses `serverError`. `StandupForm.tsx` used `error`. Plan-compliant but inconsistent with peer components.
- **Fix**: Renamed prop to `serverError` in StandupForm.tsx; updated call site in dashboard.astro.
- **Decision**: FIXED

### F5 — `submitted_date` accepted from client without server-side date bounds

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/standup/submit.ts:12,45
- **Detail**: `submitted_date` is accepted verbatim from the client (only format-checked). A user could submit for arbitrary past dates to manufacture a streak. The plan explicitly documents this as an accepted MVP trade-off. The UNIQUE constraint prevents double-posting the same date.
- **Fix**: None for MVP. When streak visibility goes public, add a server-side date bounds check.
- **Decision**: SKIPPED
