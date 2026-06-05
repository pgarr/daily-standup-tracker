<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test Runner Bootstrap + Auth/Routing Protection (Phase 1)

- **Plan**: `context/changes/testing-runner-auth-routing/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-05
- **Verdict**: SOUND (after triage fixes)
- **Findings**: 0 critical, 2 warnings, 1 observation — all triaged

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | WARNING → FIXED |
| Architectural Fitness | WARNING → FIXED |
| Blind Spots | WARNING → FIXED |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓ (`src/middleware.ts`, `src/lib/supabase.ts`, `src/pages/`, `.github/workflows/ci.yml`, `wrangler.jsonc`, `package.json`), 3/3 symbols ✓ (`AUTH_REQUIRED_ROUTES`, `WORKSPACE_REQUIRED_ROUTES`, `createClient`), brief↔plan ✓

## Findings

### F1 — AUTH_REQUIRED_PREFIXES duplication creates a false-green sync hazard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — "Create the filesystem-crawl gap-detection test"
- **Detail**: Test stored AUTH_REQUIRED_PREFIXES as a local constant that "must be kept in sync manually" with src/middleware.ts. If middleware is updated but test constant is not, gap-detection gives false confidence. Deep verification confirmed constants can be trivially extracted to src/lib/routes.ts (no dependencies).
- **Fix A ⭐ Applied**: Extract constants to src/lib/routes.ts — added Phase 1 change #0; test now imports AUTH_REQUIRED_ROUTES directly from @/lib/routes.
- **Decision**: FIXED via Fix A

### F2 — Filesystem crawl doesn't filter Astro's _ prefix convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — "Create the filesystem-crawl gap-detection test"
- **Detail**: Astro ignores _-prefixed files/dirs in src/pages/. Without filtering, a src/pages/_utils.ts would produce a false-positive "ungated route" failure. Added filter: skip entries whose basename starts with _.
- **Fix Applied**: Added `_` prefix filter to the crawl contract alongside the dynamic-route normalization note.
- **Decision**: FIXED

### F3 — Chromium browser project configured for API-only tests

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 — "Create Playwright configuration"
- **Detail**: All Phase 1 tests use only the request fixture — no browser needed. Chromium project caused unnecessary ~200MB binary download in CI.
- **Fix Applied**: Replaced chromium project with `{ name: 'api', use: {} }`; removed `npx playwright install` from CI step and Phase 2 success criteria; renumbered Progress items 2.1–2.4.
- **Decision**: FIXED
