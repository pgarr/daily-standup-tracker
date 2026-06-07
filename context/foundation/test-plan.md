# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-07 (§3 Phase 2 status + change folder; §4 Playwright CI/Supabase strategy; §5 E2E gate clarification; §8 freshness)

---

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   `<area>`" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (22 commits/30d).

---

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job; see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Unauthenticated user reaches a protected route — middleware regression or new route added without updating the gate | High | High | Interview Q1 (top fear); interview Q2 (past burn: new route not added to gate); hot-spot `src/pages/api` dir (7 commits/30d); hot-spot `src/middleware.ts` file (4 commits/30d — single-file peak) |
| 2 | Member reads or mutates (edits/deletes) another member's standup entry — RLS gap on standup_entries fails to reject write operations by Member A on Member B's rows (S-03, S-06) | High | Medium | PRD NFR "horizontal data isolation is absolute"; PRD v3 FR-007/FR-008 reinstated as must-have (write-path routes now exist); interview Q3 (low confidence in RLS policies); F-01 archive plan (SECURITY DEFINER workaround complexity on workspace_member) |
| 3 | Member accesses Team Lead-only team feed — app-layer role gate missing or incorrect (S-05) | High | Medium | PRD Access Control "Members cannot see other members' entries"; roadmap S-05 risk note "first slice where Team Lead role gating is exercised end-to-end"; interview Q2 (past burn: route without gate) |
| 4 | Blocker alert misfires — fires without member confirmation, fires on non-consecutive business days, fires on wrong threshold, or confirmation event is silently lost leaving alert state inconsistent (S-04) | High | Medium | PRD v3 FR-012 (alert fires ONLY on member confirmation — confirmation is the canonical false-positive guard; resolved open question); roadmap S-04 risk note "if it fires too eagerly or too rarely, user trust breaks before the north star is demonstrated" |
| 5 | Streak shows wrong count — Fri→Mon business-day boundary or timezone edge case produces incorrect increment or reset (S-03) | Medium | Medium | PRD v3 FR-011 (resolved: Mon–Fri business days; weekend gaps do not break streak); roadmap S-03 open implementation question: UTC vs. user local timezone for streak evaluation |
| 6 | Invite token reused or accepted by wrong user — unauthorized member joins workspace (S-02) | Medium | Medium | Abuse lens (auth surface; invite link acceptance); roadmap S-02 risk "invite acceptance merges with registration — orphaned records or duplicate accounts"; F-01 plan (`workspace_has_no_members` guard protects team_lead INSERT) |
| 7 | Edit/delete of a standup entry creates inconsistent derived state — streak recalculates incorrectly, or a confirmed blocker alert becomes orphaned/stale after its source entry is deleted (S-06) | Medium | Medium | Roadmap S-06 risk note "interaction between entry mutation and derived state (streak, confirmed blocker alerts from S-04) should be scoped explicitly"; PRD v3 FR-007/FR-008 reinstated as must-have |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Every request without a valid session to a protected route receives a 302 redirect to `/auth/signin`, not the page content; a new route added under `src/pages/` is also gated if it should be | "The gate is enforced because I can read it in the code" — reading code is not a signal | How the route protection list is maintained; how the middleware resolves the user; what happens when `createClient()` returns null | Integration: send unauthenticated HTTP request, assert redirect location | Static list mirror — testing only the hardcoded route list misses new routes added after this phase |
| #2 | A SELECT executed as Member A (real JWT) on standup_entries returns 0 rows of Member B, even when the workspace_id is known; an UPDATE/DELETE executed as Member A on Member B's entry ID is rejected by RLS — not silently accepted | "RLS is enabled on the table" — enabled ≠ correct write policies; "RLS covers reads so writes are fine" — read and write policies are separate | standup_entries table schema and RLS policies for SELECT, UPDATE, DELETE (S-03 ships SELECT policies; S-06 adds write-path routes); whether any API route uses the service-role key (which bypasses RLS) | Integration against local Supabase; real JWT per role for both read and write operations | Service-role key in tests — bypasses RLS and produces false-green results for both reads and writes |
| #3 | A Member-role session hitting the team feed endpoint is rejected (403 or redirect), not served team data; the check is enforced at the app layer, independent of DB | "The database won't return other members' rows anyway" — app-layer role check is a separate defense layer | How role gating is implemented in the team feed route (per-page check vs. middleware extension); what the route will be named in S-05 | Integration: Member session → team feed endpoint → assert 403/redirect | Accepting empty data as proof of gating — empty data could be a silent RLS gap, not a correct role check |
| #4 | Alert fires only after member confirmation on consecutive business days at threshold; does NOT fire when: days are non-consecutive, blockers are evaluated as different, or member dismisses the suggestion; confirmation event is not silently lost on network failure | "A happy-path test shows it fired" — does not cover the non-firing branches or the confirmation-required guard; "confirmation UI exists so it fires" — confirmed ≠ persisted | Similarity evaluation and business-day gap evaluation logic; confirmation event storage model; whether a dismissed suggestion can be resurfaced; alert storage model | Unit: pure function tests with explicit input sequences (blocker similarity + day gap + threshold); Integration: confirmation → assert alert persisted; dismiss → assert no alert | Oracle from implementation output — expected value must come from the PRD v3 business rule (threshold N, consecutive business days, similarity definition, confirmation required), not the function's current return value |
| #5 | Streak=3 for Mon/Tue/Wed entries; streak=2 for Fri+Mon entries; streak=1 for lone entry; timezone boundary does not miscalculate | "Streak increments by 1 each day" — does not cover Fri→Mon or timezone edge | Business-day streak function signature; how the UTC vs. local decision was resolved; how weekend entries are handled | Unit: pure function with explicit date sequences | Date tests covering only Mon–Tue–Wed; miss the Friday-to-Monday boundary |
| #6 | Second call with the same used token is rejected; token is not valid for a different email address; workspace membership matches expectations after acceptance | "The token is a UUID so it's secret enough" — obscurity is not access control | Token generation, storage, and invalidation model; whether the token is email-bound; invite table schema | Integration: submit invite acceptance twice; assert second call rejected | Testing only the happy-path acceptance flow; misses replay/reuse which is the actual abuse vector |
| #7 | After deleting a standup entry, streak recalculates to the correct value; after deleting an entry that triggered a confirmed blocker alert, alert state is handled consistently (deleted or marked stale — not orphaned); after editing an entry, streak reflects the edit if applicable | "The entry is deleted so it's gone" — derived state (streak column or cached value, alert FK) may not be recalculated | How streak is stored (column vs. derived-on-read); whether confirmed alerts store a FK to entries; delete cascade or nullification policy on that FK (S-06 must ship first) | Integration: submit entries → confirm alert → delete source entry → verify streak and alert state | Testing only the "delete own most recent entry" happy path; missing mid-streak delete and the confirmed-alert-orphan cases |

---

## 3. Phased Rollout

Each row is a discrete rollout phase that opens its own change folder via
`/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status and Change folder as artifacts appear on disk.

| # | Phase name | Goal | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Runner + auth/routing protection | Bootstrap Vitest; prove middleware correctly gates unauthenticated requests; protect against new-route-gap regression | #1 | integration (HTTP/middleware) | implementing | context/changes/testing-runner-auth-routing/ |
| 2 | Standup data isolation | Prove standup_entries RLS enforces absolute horizontal isolation under a real Member JWT; document the service-role trap | #2 | integration (local Supabase, real JWT) | planned | context/changes/test-standup-data-isolation/ |
| 3 | Domain logic — streak + blocker | Unit tests for business-day streak boundary and blocker alert firing logic (Phase 3.1: streak tests, gates on S-03; Phase 3.2: blocker tests, gates on S-04) | #4, #5 | unit | planned | context/changes/test-phase-3/ |
| 4 | Security — role gating + invite | Prove team feed rejects Members; prove invite token replay is rejected and is email-bound | #3, #6 | integration | not started | — |
| 5 | Entry mutation integrity | Prove edit/delete correctly recalculates streak; prove confirmed alert is not orphaned on entry deletion; prove write-path IDOR is rejected by RLS (extends Phase 2 scope) | #7 (write-path IDOR component of #2 also tested here) | integration | not started | — |

**Status vocabulary (fixed):**

| Value | Meaning |
|---|---|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

**Phase timing dependencies:**
- Phase 1: can start now (S-01 is done; middleware and auth routes exist).
- Phase 2: gates on S-03 shipping (standup_entries table must exist).
- Phase 3: Phase 3.1 gates on S-03 shipping (`calculateStreak` must exist in `src/lib/streak.ts`); Phase 3.2 gates on S-04 shipping (`isNextBusinessDay` + `shouldSuggestBlockerMatch` must exist in `src/lib/blocker.ts`).
- Phase 4: gates on S-02 and S-05 shipping (invite flow and team feed must exist).
- Phase 5: gates on S-06 shipping (edit/delete routes must exist; S-03 and S-04 also required for derived-state tests).

---

## 4. Stack

The classic test base for this project. No test runner is installed yet — Phase 1 bootstraps the suite. All tools carry a `checked:` date.

| Layer | Tool | Notes |
|---|---|---|
| Unit + integration | Vitest — checked: 2026-06-05 | None yet — Phase 1 installs and wires it. Compatible with the project's Vite 7 setup. |
| Supabase RLS integration | Vitest + `@supabase/supabase-js` (already installed) + local Supabase CLI (`supabase` in devDeps) — checked: 2026-06-07 | Phase 2 adds per-role JWT fixtures for RLS tests. Tests carry a **skip guard** — when `supabase start` is not running the suite exits 0 with a skip notice, so `npm test` stays green in CI today. Adding `supabase start` to CI is deferred: technically feasible (Docker available on ubuntu-latest, ~90 s startup, ~4-6 GB of the runner's 7 GB RAM, anon key is deterministic), but not in Phase 2 scope. Address when Phase 2 is complete. |
| e2e | Playwright — checked: 2026-06-07 | Phase 1 adds Playwright for middleware routing smoke tests using HTTP `request` context only — no browser binary install needed, no Supabase credentials required. Runs in CI without `supabase start`. Full browser E2E (login form → standup submission) is not yet defined; when it is, it will need `supabase start` in CI and a `webServer` entry in `playwright.config.ts`. |
| API mocking | MSW — checked: 2026-06-05 | None yet — Phase 1 evaluates whether MSW is needed for Cloudflare Worker integration tests or if Playwright HTTP can substitute. |

**Stack grounding tools (current session):**
- Docs: none (no Context7 or framework docs MCP available) — checked: 2026-06-05
- Search: WebSearch available — not queried for this guide; tooling choices grounded in local `package.json` and project conventions; checked: 2026-06-05
- Runtime/browser: no Playwright MCP, no browser automation tool available in session — checked: 2026-06-05
- Provider/platform: Gmail / Google Calendar / Google Drive MCPs available — no quality-gate relevance for this project; checked: 2026-06-05

---

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck (`npm run lint && npm run build`) | local + CI | required now | syntactic/type drift; already wired in CI (`.github/workflows/ci.yml`) |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions, RLS policy gaps, middleware routing regressions |
| e2e — auth routing (Playwright HTTP, no Supabase) | CI on PR | required after §3 Phase 1 | broken middleware gate; new unprotected routes |
| e2e — Supabase integration tests (`npm test` with skip guard) | local; CI pending `supabase start` step | required after §3 Phase 2 completes | RLS policy gaps invisible to HTTP-layer tests |
| e2e — full browser flows (login → standup submission) | CI on PR (future) | not yet defined | broken critical user paths requiring a real browser + Supabase | 
| post-edit hook | local (agent loop) | recommended after §3 Phase 1 | regressions at edit time before commit |
| pre-prod smoke | between merge + prod | optional | environment-specific failures (Cloudflare Worker binding, Supabase remote connection) |

---

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the
relevant rollout phase ships.

### 6.1 Adding a unit test

**Location**: `src/__tests__/` — all Vitest tests live here; picked up automatically by `vitest.config.ts` include pattern `src/__tests__/**/*.test.ts`.
**Naming**: `{feature}.test.ts` (e.g., `streak.test.ts`, `blocker-detection.test.ts`).
**Import pattern**:
```typescript
import { describe, it, expect } from "vitest";        // no globals — must import explicitly
import { fn } from "@/lib/{module}";                   // @/ resolves to src/
```
**Run command**: `npm test` (single-run CI mode); `npm run test:watch` (development).
**Environment**: Node.js — no browser globals, no Supabase client needed for pure functions.
**Reference tests**: `src/__tests__/streak.test.ts` (date-fixture pure function), `src/__tests__/blocker-detection.test.ts` (injectable-stub pure function). See `context/changes/test-phase-3/plan.md` for the full test-case oracles.
**Key pattern**: Assertions must cite the PRD business rule they test, not the function output. The expected value comes from the spec, not the current return value of the function. Injecting dependencies (e.g., `similarityFn: () => true`) keeps the logic under test isolated from not-yet-implemented layers.

### 6.2 Adding an integration test for a middleware/routing rule

TBD — see §3 Phase 1 (runner bootstrap sub-phase will document how to add a routing integration test, what test harness is used, and the run command).

### 6.3 Adding an integration test for a Supabase RLS policy

**When to use this pattern**: any time you need to prove that a row-level security policy actually enforces isolation — SELECT invisibility, INSERT rejection, or UPDATE/DELETE rejection under a real authenticated user session.

**Reference test**: `src/__tests__/standup-data-isolation.test.ts` — five tests covering the full `standup_entries` RLS surface. Read it alongside this entry.

**Run command**: `npm test` (Vitest). Tests skip automatically when local Supabase is not running; the overall run stays green.

#### Imports

```typescript
import {
  isSupabaseRunning,   // liveness probe — call this first
  createServiceClient, // bypasses RLS — setup/teardown ONLY
  createUserClient,    // enforces RLS — use for ALL assertions
  SUPABASE_URL,        // needed only if you call signInWithPassword directly
  SUPABASE_ANON_KEY,   // needed only if you call signInWithPassword directly
} from "./helpers/supabase-test";
import { createClient } from "@supabase/supabase-js"; // for sign-in client
```

#### Skip guard (required)

```typescript
const supabaseAvailable = await isSupabaseRunning(); // top-level await — ESM supported

describe.skipIf(!supabaseAvailable)(
  "my table RLS (local Supabase not running — run npx supabase start)",
  () => { ... }
);
```

`isSupabaseRunning()` probes `SUPABASE_URL/rest/v1/` and returns `false` (never throws) on any connection failure. The suite is skipped, not failed, so `npm test` exits 0 in CI.

#### Two client roles — never mix them

| Client | How to create | When to use |
|---|---|---|
| **Service-role** (bypasses RLS) | `createServiceClient()` | `beforeAll`/`afterAll` only — creates auth users, workspace rows, fixture data, then cleans up |
| **User JWT** (enforces RLS) | `createUserClient(accessToken)` | ALL test assertions — the only client that reflects what a real user actually sees |

**Anti-pattern**: never use `createServiceClient()` in an assertion query. It bypasses RLS and produces false-green results. To confirm your test is actually exercising RLS: swap the user client for the service client in one assertion — if it now returns data it shouldn't (e.g. `data.length === 1` where the RLS test expects 0), the policy is real.

#### Fixture lifecycle

```typescript
let userId = "";
let accessToken = "";

beforeAll(async () => {
  const svc = createServiceClient();
  const ts = Date.now();

  // 1. Create the test user (service-role for admin.createUser)
  const { data: authData, error: createErr } = await svc.auth.admin.createUser({
    email: `rls-test-${ts}@example.com`,
    password: "test-password-123",
    email_confirm: true,
  });
  if (!authData.user) throw new Error(`createUser: ${createErr?.message ?? "unknown"}`);
  userId = authData.user.id;

  // 2. Seed any related rows (workspace, workspace_member, etc.) using service client.
  //    Use crypto.randomUUID() for IDs — avoids SELECT round-trips that can fail
  //    if RLS hasn't settled yet (see lessons.md: "Use client-generated UUIDs").

  // 3. Sign in as the user to get a real JWT for assertions
  const signInClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, // prevents hang after suite exits
  });
  const { data: session, error: signInErr } = await signInClient.auth.signInWithPassword({
    email: `rls-test-${ts}@example.com`,
    password: "test-password-123",
  });
  if (!session.session) throw new Error(`signIn: ${signInErr?.message ?? "unknown"}`);
  accessToken = session.session.access_token;
});

afterAll(async () => {
  const svc = createServiceClient();
  // Delete workspace rows first; CASCADE removes child rows.
  if (userId) await svc.auth.admin.deleteUser(userId);
});
```

#### Assertion patterns

```typescript
// SELECT invisibility (RLS hides the row — no error, just empty results)
const { data, error } = await createUserClient(accessToken)
  .from("some_table")
  .select("*");
expect(error).toBeNull();
expect(data).toHaveLength(0);

// INSERT rejection (RLS policy WITH CHECK fails — PostgreSQL error 42501)
const { error: insertErr } = await createUserClient(accessToken)
  .from("some_table")
  .insert({ user_id: otherUserId, ... });
expect(insertErr?.code).toBe("42501");
expect(insertErr?.message).toContain("row-level security");
```

`42501` is PostgreSQL's `insufficient_privilege` SQLSTATE — PostgREST passes it through unchanged. The `message` assertion survives minor PostgREST version variation and provides a clearer failure description.

### 6.4 Adding a test for a new protected API endpoint

TBD — see §3 Phase 1 and Phase 4. Phase 1 documents the auth-gate pattern; Phase 4 adds the role-gate variant.

### 6.5 Adding a test for entry mutation + derived state consistency

TBD — see §3 Phase 5 (entry mutation integrity sub-phase will document how to test streak recalculation after edit/delete, how to assert confirmed-alert FK state after entry deletion, and how to verify write-path IDOR rejection via real Member JWT).

### 6.5 Per-rollout-phase notes

(Filled in by `/10x-implement` as each phase completes.)

---

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5 and project context).

- **Supabase auth SDK internals** (signIn, signUp, signOut calls into `@supabase/supabase-js`) — that is testing the vendor's library, not our code. Our responsibility ends at the inputs we pass and the session state we expect back. Re-evaluate if we wrap the auth calls in custom logic that diverges from the SDK contract. (Source: interview Q5.)
- **Visual layout and styling** — no snapshot tests or visual regression tests on Astro/React components. They break on trivial class changes and catch nothing functional. Re-evaluate if a critical screen's layout becomes a product differentiator. (Source: project context; consistent with PRD non-goals.)
- **Static/marketing pages** — the landing page (`src/pages/index.astro`) has no business logic and almost never changes. Re-evaluate if it gains data-driven content or user-visible logic. (Source: project context.)

---

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-07 (§3 Phase 2 status; §4 Playwright + Supabase CI strategy; §5 E2E gate split)
- Source documents: PRD v3 (`context/foundation/prd-v3.md`), Roadmap v2 (`context/foundation/roadmap.md` updated 2026-06-05)
- Stack versions last verified: 2026-06-07
- CI/E2E strategy last verified: 2026-06-07 — see `context/changes/test-plan-refresh-2026-06-07/research.md`
- AI-native tool references last verified: N/A — no AI-native test layer planned for current rollout

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner, AI layer added),
- §7 negative-space no longer matches what the team believes.
