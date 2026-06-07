<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test runner bootstrap and auth/routing protection

- **Plan**: context/changes/testing-runner-auth-routing/plan.md
- **Scope**: Full (all 3 phases)
- **Date**: 2026-06-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical / 1 warning / 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Missing `forbidOnly` in playwright.config.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: playwright.config.ts (top-level defineConfig object)
- **Detail**: `playwright.config.ts` has no `forbidOnly: !!process.env.CI`. Without it, a committed `test.only()` silently passes CI by running only the focused test and exiting 0. This is listed in every Playwright CI quickstart as standard hardening and is present in virtually all production Playwright configs.
- **Fix**: Add `forbidOnly: !!process.env.CI` as a top-level field in `defineConfig({})`.
- **Decision**: FIXED — added `forbidOnly: !!process.env.CI` and `retries: process.env.CI ? 1 : 0` to playwright.config.ts

### F2 — Blocker skip guard has no removal signal

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/__tests__/blocker-detection.test.ts:4–14
- **Detail**: The `describe.skipIf(!implemented)` guard correctly handles the S-04 stubs, but the comment says only "Skip until S-04 ships" — there is no enforced mechanism to ensure the guard is removed when S-04 lands. The skip is invisible in CI output unless you inspect counts; a stale guard could permanently silence 11 tests with no alarm. This change created the guard as an unplanned scope addition to unblock CI; the guard is correct as a short-term measure but needs a tracked follow-up.
- **Fix**: Add an `it.todo` outside the skip block or a plain comment referencing the S-04 change-id so the guard has a visible pointer for whoever lands S-04 to remove it. E.g.: `// TODO(s-04-blocker-detection): remove skip guard when S-04 ships`.
- **Decision**: FIXED — added `// TODO(s-04-blocker-detection): remove this skip guard when S-04 ships`

### F3 — E2E spec sync comment is imprecise

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/middleware-gate.spec.ts:3
- **Detail**: The comment says "Keep in sync with AUTH_REQUIRED_ROUTES + WORKSPACE_REQUIRED_ROUTES" but `/workspace/setup` is not *in* either constant — it's implied by the `/workspace` prefix in `AUTH_REQUIRED_ROUTES`. A future reader comparing the spec list against the constants directly will not find `/workspace/setup` in either array and may wonder if the spec is stale.
- **Fix**: Rephrase to: `// Routes that AUTH_REQUIRED_ROUTES or WORKSPACE_REQUIRED_ROUTES protect (see src/lib/routes.ts).`
- **Decision**: FIXED — rephrased comment to "Routes that AUTH_REQUIRED_ROUTES or WORKSPACE_REQUIRED_ROUTES protect"

### F4 — No `retries` for CI in playwright.config.ts

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: playwright.config.ts
- **Detail**: No `retries: process.env.CI ? 1 : 0` setting. The webServer timeout is generous (120s) but if a dev server takes slightly longer on a loaded CI runner and a single HTTP request fails, the test will fail non-deterministically with no retry. Not blocking for the `api` (request-context) project, but worth adding now before browser tests are introduced in Phase 4. This is particularly relevant since `npm run dev` launches the Cloudflare workerd runtime which can have a cold start variance.
- **Fix**: Add `retries: process.env.CI ? 1 : 0` to the top-level `defineConfig({})`. One retry is the standard CI recommendation; it catches flaky cold-start failures without masking real bugs.
- **Decision**: FIXED — bundled with F1 fix in playwright.config.ts
