---
date: 2026-06-07T13:09:26+00:00
researcher: Piotr Garlej
git_commit: 22e0669da5553f307d937a8294963a7f5a90e716
branch: master
repository: 10xdev-dst
topic: "Can E2E tests with Supabase run in current CI, or should they stay local?"
tags: [research, ci, e2e, playwright, supabase, test-plan]
status: complete
last_updated: 2026-06-07
last_updated_by: Piotr Garlej
---

# Research: E2E tests with Supabase — CI vs local

**Date**: 2026-06-07T13:09:26+00:00
**Researcher**: Piotr Garlej
**Git Commit**: 22e0669da5553f307d937a8294963a7f5a90e716
**Branch**: master
**Repository**: 10xdev-dst

## Research Question

Is it possible to run E2E tests with Supabase in the current CI setup? Or should E2E tests be kept for local dev only?

## Summary

**Short answer: it depends on which tests you mean, and the existing plans already answer both cases.**

There are three distinct categories to keep separate:

| Category | Needs Supabase? | Runs in CI? | Decision source |
|---|---|---|---|
| Phase 1 Playwright (auth routing smoke tests) | No | Yes — planned | `testing-runner-auth-routing/plan.md:265,282` |
| Phase 2 RLS integration tests (Vitest + Supabase SDK) | Yes (local) | No — deferred but feasible | `test-standup-data-isolation/plan.md:50` |
| Full browser E2E (login → submit standup — not yet defined) | Yes (local) | Feasible, not yet planned | — |

The existing test plan's quality gates (`test-plan.md:128`) do expect E2E in CI — but "E2E" in Phase 1 means Playwright HTTP request-context tests that require **no Supabase at all**. The question of CI + Supabase applies to Phase 2 and beyond, where the plan deliberately deferred it.

---

## Detailed Findings

### Phase 1 Playwright — E2E without Supabase (already planned for CI)

**File**: `context/changes/testing-runner-auth-routing/plan.md:263-284`

Phase 1 adds Playwright tests that exercise the middleware routing layer via HTTP only (no browser). These tests verify that unauthenticated requests to protected routes receive a 302 redirect.

Key fact: when `SUPABASE_URL` and `SUPABASE_KEY` are absent, `createClient()` returns `null`, the middleware sets `user = null`, and protected routes redirect correctly. The Phase 1 tests **exploit this intentionally** — no Supabase instance required.

Planned CI addition (Phase 1, Phase 3 sub-step):
```yaml
- run: npm test
- run: npx playwright test
```
No browser binary install needed (Playwright `request` context, no Chromium/Firefox). No `env:` block needed.

**Status**: Phase 1 is `implementing`. CI integration is the final sub-phase (Phase 3 in the plan). This is already decided and will land when Phase 1 completes.

---

### Phase 2 RLS integration tests — Vitest + local Supabase (deferred from CI)

**File**: `context/changes/test-standup-data-isolation/plan.md:50`

> "CI configuration changes — CI will pick up `npm test` naturally once local Supabase is available there."

Phase 2 tests use `@supabase/supabase-js` directly (not through Playwright) to assert that RLS policies reject cross-member reads under a real JWT. They require `supabase start` to be active.

The plan gives these tests a **skip guard**: when the local Supabase liveness probe fails, the suite exits 0 with a skip notice. This means they do not break CI today — they are simply skipped.

The plan explicitly excludes CI configuration from Phase 2 scope. The sentence "CI will pick up `npm test` naturally once local Supabase is available there" is a passive deferral — it acknowledges the work needs doing without committing a phase to it.

---

### Is running `supabase start` in GitHub Actions CI technically feasible?

**Yes.** Here is what makes it possible and what constrains it:

**Enablers** (all confirmed from codebase):
- `supabase` CLI is in `devDependencies` at `^2.23.4` (`package.json`)
- `supabase/config.toml` exists with full local config; `supabase start` will apply all migrations automatically
- GitHub Actions `ubuntu-latest` runners have Docker available (no `services:` block or DinD needed — the CLI manages containers directly)
- The local anon key in `.dev.vars` (`sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH`) is deterministic — the same JWT secret is used every time; it is not a secret in the production sense and can be hard-coded in CI env vars

**Constraints**:
- `supabase start` adds ~60-90 seconds of cold-start overhead per CI run
- Memory: GitHub Actions ubuntu-latest provides ~7 GB RAM. Local Supabase (PostgreSQL + GoTrue + PostgREST + Storage + Realtime) uses approximately 4-6 GB. This is tight. If stability is an issue, `supabase start --ignore-health-check` avoids startup failures on memory-constrained runners.
- The anon key must be available as a CI env var (or inlined). It is already in `.dev.vars` and is not sensitive.

**Minimal CI addition to enable Phase 2 tests**:
```yaml
- name: Start local Supabase
  run: npx supabase start
- run: npm test
  env:
    SUPABASE_URL: http://127.0.0.1:54321
    SUPABASE_KEY: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```
This would replace the current `npm test` step (which has no env block today) for the phase when Phase 2 tests ship.

---

### Current CI state (`ci.yml`)

**File**: `.github/workflows/ci.yml`

```
lint → build (with remote Supabase secrets) → [migrations → deploy] (master only)
```

There is no `npm test` step at all today. The test suite (`npm test` / `vitest run`) runs only locally. Phase 1 will add `npm test` + `npx playwright test` before the build step.

The remote Supabase secrets (`SUPABASE_URL`, `SUPABASE_KEY` in the `build` step) are for production — they are not usable for integration tests without polluting production data.

---

## Architecture Insights

**Three distinct Supabase "environments" exist or are implied:**

1. **Remote production** — the live Supabase project (via `SUPABASE_PROJECT_REF` secret in CI). Migrations push here on master. Tests must never touch it.
2. **Local dev** (`supabase start`) — what Phase 2 tests use today. Port 54321, deterministic anon key.
3. **Local-in-CI** — same as (2) but started inside the GitHub Actions runner. Technically identical; just needs a step in the workflow.

The skip guard in Phase 2 tests (`'local Supabase not running — run npx supabase start'`) was designed for local dev ergonomics, but it doubles as CI safety: until the CI workflow is updated, the tests skip cleanly rather than failing.

---

## Historical Context (from prior changes)

- `context/changes/testing-runner-auth-routing/plan.md:282` — Phase 1 explicitly designed Playwright tests to not need Supabase, so CI integration is trivial for that phase.
- `context/changes/test-standup-data-isolation/plan.md:50` — Phase 2 deferral wording is a soft TODO, not a permanent exclusion. The phrasing "once local Supabase is available there" implies the team expects to add it — just not as part of Phase 2's scope.
- `context/foundation/test-plan.md:128` — Quality gates table states "e2e on critical flows (auth routing, standup submission) - CI on PR - required after Phase 1". This explicitly targets CI, confirming E2E-in-CI is the intent.

---

## Code References

- `.github/workflows/ci.yml:1-37` — current CI: lint + build + migrations/deploy (no tests)
- `context/changes/testing-runner-auth-routing/plan.md:263-284` — Phase 3 CI integration plan
- `context/changes/test-standup-data-isolation/plan.md:50` — explicit deferral of CI Supabase
- `context/foundation/test-plan.md:128` — quality gate: E2E in CI required after Phase 1
- `supabase/config.toml:10` — local Supabase API port 54321
- `.dev.vars:1-2` — local Supabase URL + deterministic anon key
- `package.json` — `supabase: ^2.23.4` in devDeps; `@playwright/test` NOT installed yet

---

## Open Questions

1. **When to add `supabase start` to CI**: The Phase 2 plan defers this. A decision is needed: add it when Phase 2 is complete (so the tests actually run in CI), or leave it as local-only and accept the skip in CI permanently. The test-plan quality gates suggest CI is the goal.

2. **Memory budget**: Confirm ubuntu-latest headroom with `supabase start`. If memory is tight, `--ignore-health-check` is available, or a larger runner can be requested (GitHub Actions supports `ubuntu-latest-8-cores` via `runs-on: ubuntu-latest-8-cores` if the repo/org has it).

3. **Full browser E2E**: Not yet defined. If a future phase requires Playwright to exercise the actual login form (not just HTTP routing), `playwright.config.ts webServer` can start `npm run dev` in the CI job, and that step would also need `SUPABASE_URL` + `SUPABASE_KEY` pointing at the local instance.
