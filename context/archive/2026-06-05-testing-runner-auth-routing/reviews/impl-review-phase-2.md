<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Runner Bootstrap + Auth/Routing Protection

- **Plan**: context/changes/testing-runner-auth-routing/plan.md
- **Scope**: Phase 2 of 3
- **Date**: 2026-06-07
- **Verdict**: APPROVED (all findings fixed during triage)
- **Findings**: 0 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → FIXED |
| Architecture | PASS |
| Pattern Consistency | WARNING → FIXED |
| Success Criteria | PASS |

## Findings

### F1 — PROTECTED_ROUTES list duplicates src/lib/routes.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: e2e/middleware-gate.spec.ts:3
- **Detail**: `PROTECTED_ROUTES` is hand-maintained; could drift from `src/lib/routes.ts` silently. Route-coverage.test.ts is the canonical gate; E2E spec tests specific HTTP behaviours.
- **Fix Applied**: Fix A — added sync comment above `PROTECTED_ROUTES` cross-referencing `src/lib/routes.ts`
- **Decision**: FIXED

### F2 — Public-route assertion not.toBe(302) passes on server errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/middleware-gate.spec.ts:18
- **Detail**: `not.toBe(302)` would pass on 500/503 — broken public route looks healthy.
- **Fix Applied**: Changed to `toBe(200)` for all public-route assertions.
- **Decision**: FIXED

### F3 — No webServer.timeout — CI cold-start may exceed 60 s default

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: playwright.config.ts:10
- **Detail**: Playwright's 60 s default may be exceeded on a cold CI runner by Astro + Cloudflare workerd startup.
- **Fix Applied**: Added `timeout: 120_000` to `webServer` block.
- **Decision**: FIXED

### F4 — location header assertion uses toContain (too loose)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/middleware-gate.spec.ts:11
- **Detail**: `toContain("/auth/signin")` too loose. Astro emits `location: /auth/signin` (relative).
- **Fix Applied**: Changed to `toBe("/auth/signin")` — confirmed via curl that Astro emits a relative path.
- **Decision**: FIXED

### F5 — No describe blocks around the two test groups

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/middleware-gate.spec.ts:7, 19
- **Detail**: Flat tests — can't target groups with `--grep`; CI output harder to scan.
- **Fix Applied**: Wrapped both loops in `test.describe("protected routes", …)` and `test.describe("public routes", …)`.
- **Decision**: FIXED

### F6 — Comment in playwright.config.ts says "Phase 1"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: playwright.config.ts:6
- **Detail**: Comment said "Phase 1 request-context tests" — phase reference removed.
- **Fix Applied**: Removed phase number from comment.
- **Decision**: FIXED
