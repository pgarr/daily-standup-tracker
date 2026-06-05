# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-05 (Phase 1 change opened)

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
| 2 | Member reads another member's standup entries — RLS policy gap on the standup_entries table (S-03) | High | Medium | PRD NFR "horizontal data isolation is absolute"; interview Q3 (low confidence in RLS policies); F-01 archive plan (SECURITY DEFINER workaround complexity on workspace_member) |
| 3 | Member accesses Team Lead-only team feed — app-layer role gate missing or incorrect (S-05) | High | Medium | PRD Access Control "Members cannot see other members' entries"; roadmap S-05 risk note "first slice where Team Lead role gating is exercised end-to-end"; interview Q2 (past burn: route without gate) |
| 4 | Blocker alert misfires — fires for non-consecutive days, wrong threshold, or silently misses a genuine repeated blocker (S-04) | High | Medium | PRD FR-012 (similarity mechanism unresolved; an Open Question in v1); roadmap S-04 risk note "if it fires too eagerly or too rarely, user trust breaks before the north star is demonstrated" |
| 5 | Streak shows wrong count — Fri→Mon business-day boundary or timezone edge case produces incorrect increment or reset (S-03) | Medium | Medium | PRD FR-011; roadmap S-03 unknowns (UTC vs. local timezone; business-day definition explicitly unresolved at design time) |
| 6 | Invite token reused or accepted by wrong user — unauthorized member joins workspace (S-02) | Medium | Medium | Abuse lens (auth surface; invite link acceptance); roadmap S-02 risk "invite acceptance merges with registration — orphaned records or duplicate accounts"; F-01 plan (`workspace_has_no_members` guard protects team_lead INSERT) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Every request without a valid session to a protected route receives a 302 redirect to `/auth/signin`, not the page content; a new route added under `src/pages/` is also gated if it should be | "The gate is enforced because I can read it in the code" — reading code is not a signal | How the route protection list is maintained; how the middleware resolves the user; what happens when `createClient()` returns null | Integration: send unauthenticated HTTP request, assert redirect location | Static list mirror — testing only the hardcoded route list misses new routes added after this phase |
| #2 | A SELECT executed as Member A (real JWT) on standup_entries returns 0 rows of Member B, even when the workspace_id is known | "RLS is enabled on the table" — enabled ≠ correct policies | standup_entries table schema and RLS policies (S-03 must ship first); whether any API route uses the service-role key (which bypasses RLS) | Integration against local Supabase; real JWT per role | Service-role key in tests — bypasses RLS and produces false-green results |
| #3 | A Member-role session hitting the team feed endpoint is rejected (403 or redirect), not served team data; the check is enforced at the app layer, independent of DB | "The database won't return other members' rows anyway" — app-layer role check is a separate defense layer | How role gating is implemented in the team feed route (per-page check vs. middleware extension); what the route will be named in S-05 | Integration: Member session → team feed endpoint → assert 403/redirect | Accepting empty data as proof of gating — empty data could be a silent RLS gap, not a correct role check |
| #4 | Alert fires at threshold on consecutive business days with similar blockers; does NOT fire when days are non-consecutive; does NOT fire when blockers differ | "A happy-path test shows it fired" — does not cover non-firing branches | Similarity function signature and threshold mechanism; business-day gap evaluation logic; alert storage model | Unit: pure function tests with explicit input sequences | Oracle from implementation output — expected value must come from the PRD business rule (threshold N, consecutive days, similarity definition), not the function's current return value |
| #5 | Streak=3 for Mon/Tue/Wed entries; streak=2 for Fri+Mon entries; streak=1 for lone entry; timezone boundary does not miscalculate | "Streak increments by 1 each day" — does not cover Fri→Mon or timezone edge | Business-day streak function signature; how the UTC vs. local decision was resolved; how weekend entries are handled | Unit: pure function with explicit date sequences | Date tests covering only Mon–Tue–Wed; miss the Friday-to-Monday boundary |
| #6 | Second call with the same used token is rejected; token is not valid for a different email address; workspace membership matches expectations after acceptance | "The token is a UUID so it's secret enough" — obscurity is not access control | Token generation, storage, and invalidation model; whether the token is email-bound; invite table schema | Integration: submit invite acceptance twice; assert second call rejected | Testing only the happy-path acceptance flow; misses replay/reuse which is the actual abuse vector |

---

## 3. Phased Rollout

Each row is a discrete rollout phase that opens its own change folder via
`/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status and Change folder as artifacts appear on disk.

| # | Phase name | Goal | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Runner + auth/routing protection | Bootstrap Vitest; prove middleware correctly gates unauthenticated requests; protect against new-route-gap regression | #1 | integration (HTTP/middleware) | change opened | context/changes/testing-runner-auth-routing/ |
| 2 | Standup data isolation | Prove standup_entries RLS enforces absolute horizontal isolation under a real Member JWT; document the service-role trap | #2 | integration (local Supabase, real JWT) | not started | — |
| 3 | Domain logic — streak + blocker | Unit tests for business-day streak boundary and blocker alert firing logic | #4, #5 | unit | not started | — |
| 4 | Security — role gating + invite | Prove team feed rejects Members; prove invite token replay is rejected and is email-bound | #3, #6 | integration | not started | — |

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
- Phase 3: gates on S-03 and S-04 shipping (streak and blocker functions must exist).
- Phase 4: gates on S-02 and S-05 shipping (invite flow and team feed must exist).

---

## 4. Stack

The classic test base for this project. No test runner is installed yet — Phase 1 bootstraps the suite. All tools carry a `checked:` date.

| Layer | Tool | Notes |
|---|---|---|
| Unit + integration | Vitest — checked: 2026-06-05 | None yet — Phase 1 installs and wires it. Compatible with the project's Vite 7 setup. |
| Supabase RLS integration | Vitest + `@supabase/supabase-js` (already installed) + local Supabase CLI (`supabase` in devDeps) — checked: 2026-06-05 | Local Supabase already wired; Phase 2 adds per-role JWT fixtures for RLS tests. |
| e2e | Playwright — checked: 2026-06-05 | None yet — Phase 1 adds Playwright for middleware routing smoke tests. |
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
| e2e on critical flows (auth routing, standup submission) | CI on PR | required after §3 Phase 1 | broken critical user paths that unit/integration tests cannot reach |
| post-edit hook | local (agent loop) | recommended after §3 Phase 1 | regressions at edit time before commit |
| pre-prod smoke | between merge + prod | optional | environment-specific failures (Cloudflare Worker binding, Supabase remote connection) |

---

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the
relevant rollout phase ships.

### 6.1 Adding a unit test

TBD — see §3 Phase 3 (domain logic sub-phase will document the unit test location, naming convention, reference test, and run command for streak/blocker logic).

### 6.2 Adding an integration test for a middleware/routing rule

TBD — see §3 Phase 1 (runner bootstrap sub-phase will document how to add a routing integration test, what test harness is used, and the run command).

### 6.3 Adding an integration test for a Supabase RLS policy

TBD — see §3 Phase 2 (data isolation sub-phase will document how to issue a query as a specific role using a real JWT, the fixture setup for local Supabase, and the pattern for proving a policy rejects cross-member reads).

### 6.4 Adding a test for a new protected API endpoint

TBD — see §3 Phase 1 and Phase 4. Phase 1 documents the auth-gate pattern; Phase 4 adds the role-gate variant.

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

- Strategy (§1–§5) last reviewed: 2026-06-05
- Stack versions last verified: 2026-06-05
- AI-native tool references last verified: N/A — no AI-native test layer planned for current rollout

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner, AI layer added),
- §7 negative-space no longer matches what the team believes.
