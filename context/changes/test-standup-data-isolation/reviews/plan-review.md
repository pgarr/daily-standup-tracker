<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Standup Data Isolation Tests

- **Plan**: `context/changes/test-standup-data-isolation/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical | 2 warnings | 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

4/4 existing paths ✓, 3/3 symbols ✓ (1 uncertain → F1), brief↔plan ✓

## Findings

### F1 — RLS INSERT error code asserted as single value with no fallback

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 Contract, INSERT test assertions
- **Detail**: `error?.code === '42501'` unverified for RLS violations. PostgREST passes SQLSTATE for constraint errors (23505 works in submit.ts:66) but RLS WITH CHECK violations may route differently by PostgREST version.
- **Fix A ⭐ Applied**: Assert both `error?.code === '42501'` and `error?.message?.includes('row-level security')` — survives version variation, provides clearer failure output.
- **Decision**: FIXED via Fix A

### F2 — Sign-in client's autoRefreshToken timer leaks into the test process

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 Contract (beforeAll sign-in step) + Phase 1 Helper contract
- **Detail**: `createClient(url, anonKey).auth.signInWithPassword(...)` defaults to `autoRefreshToken: true`, starting a background `setInterval` timer that can cause Vitest to hang after the suite exits.
- **Fix Applied**: Added `auth: { persistSession: false, autoRefreshToken: false }` to sign-in client spec in Phase 1 helper contract and Phase 2 beforeAll sign-in step.
- **Decision**: FIXED

### F3 — afterAll not robust to partial beforeAll failure

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 Contract, afterAll
- **Detail**: If beforeAll fails after user creation but before workspace creation, afterAll fires with undefined IDs — malformed query, orphaned auth users in local Supabase.
- **Fix Applied**: Added null-guard guidance to Phase 2 Contract afterAll: initialise fixture IDs to `undefined`, guard each delete with existence check.
- **Decision**: FIXED
