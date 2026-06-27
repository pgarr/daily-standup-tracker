<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test Security: Role Gate + Invite Token

- **Plan**: context/changes/test-security-role-invite/plan.md
- **Mode**: Deep
- **Date**: 2026-06-27
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical  1 warning  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

5/5 paths ✓, 4/4 symbols ✓, brief↔plan ✓. Role gate at `team-feed.astro:13` ✓.

## Findings

### F1 — Two invalid Playwright APIs in role-gating.spec.ts

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — e2e/role-gating.spec.ts contract
- **Detail**: (a) `test.describe.configure({ mode: 'skip' })` — TypeScript rejects 'skip'; only 'default'|'parallel'|'serial' are valid (verified against node_modules/playwright/types/test.d.ts:4213). (b) Top-level `await isSupabaseRunning()` — no ESM/tsconfig config; CommonJS mode; syntax error at runtime.
- **Fix**: Remove both constructs. Use module-scope `let shouldSkip = true` flipped to false in beforeAll; call `test.skip(shouldSkip, reason)` inside each test.
- **Decision**: FIXED — plan updated with shouldSkip flag pattern

### F2 — globalTeardown silently skips when Supabase is unreachable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — e2e/global-teardown.ts contract
- **Detail**: `if (!(await isSupabaseRunning())) return` — if Supabase goes down between globalSetup and teardown, test workspace + users persist as orphans. On next run globalSetup creates new users; orphans accumulate.
- **Fix**: Attempt cleanup unconditionally; catch failures and log a warning with workspaceId.
- **Decision**: FIXED — plan updated with try/catch teardown pattern

### F3 — Progress section missing two manual checkboxes

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress section
- **Detail**: Phase 1 Manual has 3 criteria but only 2 Progress checkboxes (1.5, 1.6). Phase 2 Manual includes Supabase Studio teardown check with no matching checkbox.
- **Fix**: Add checkboxes 1.7 and 2.13.
- **Decision**: FIXED — added to Progress section
