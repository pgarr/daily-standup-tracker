<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Runner Bootstrap + Auth/Routing Protection — Phase 1

- **Plan**: context/changes/testing-runner-auth-routing/plan.md
- **Scope**: Phase 1 of 3
- **Date**: 2026-06-05
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical | 2 warnings | 2 observations — all fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING → PASS (F1 fixed) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS (F2, F3 fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS (F4 fixed) |
| Success Criteria | PASS |

## Success Criteria

- `npm test` → 2/2 pass ✅
- `npm run lint` → 0 errors ✅ (2 pre-existing warnings in unrelated files)
- Manual 1.3 (team.astro gap-detection) → confirmed [x]

## Findings

### F1 — deriveUrlPath skips dynamic-segment normalization

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/__tests__/route-coverage.test.ts:39-46
- **Detail**: Plan specified `[id]` → `:id` normalization before prefix check. Omitted in implementation. Protection logic still correct for current static pages, but would produce confusing bracket-literal error messages for dynamic routes and prevent EXPLICIT_PUBLIC_ROUTES matches on public dynamic pages.
- **Fix**: Added `const normalized = withoutIndex.replace(/\/\[[^\]]+\].*$/, ""); return "/" + (normalized || withoutIndex);` after index stripping.
- **Decision**: FIXED

### F2 — process.cwd() makes route-coverage test fragile outside project root

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/route-coverage.test.ts:6
- **Detail**: `process.cwd()` resolves correctly when run via `npm test` but throws an unhandled ENOENT if Vitest is run from a subdirectory. Plan's own sample code had this gap.
- **Fix**: Replaced `resolve(process.cwd(), "src/pages")` with `resolve(__dirname, "../pages")` (Vitest injects `__dirname`).
- **Decision**: FIXED

### F3 — .ts file collector may flag non-route TypeScript helpers

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/route-coverage.test.ts:32
- **Detail**: All `.ts` files under `src/pages/` are treated as routes. A non-`_`-prefixed co-located helper would be flagged as an ungated route. No current pages have this issue.
- **Fix**: Added a comment at the collector site documenting the `_` prefix requirement for helpers.
- **Decision**: FIXED

### F4 — Misleading guard comment in routes.ts

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/routes.ts:5-6
- **Detail**: Comment said "Never add '/workspace' here" but was positioned between the two constants, making it ambiguous. Intent is to guard `WORKSPACE_REQUIRED_ROUTES` against adding `/workspace/setup`.
- **Fix**: Reworded to "Never add '/workspace/setup' to this list — it is the redirect target for no-workspace users and would create an infinite redirect loop."
- **Decision**: FIXED
