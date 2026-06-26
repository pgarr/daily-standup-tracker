---
date: 2026-06-05T18:09:13+02:00
researcher: Claude Sonnet 4.6
git_commit: a1690808ead22d8469774a058725343b8ad1dbf1
branch: master
repository: 10xdev-dst
topic: "Test Phase 3 — domain logic spec grounding: business-day streak and blocker confirmation flow"
tags: [research, testing, streak, blocker, domain-logic, vitest, spec-first]
status: complete
last_updated: 2026-06-05
last_updated_by: Claude Sonnet 4.6
---

# Research: Test Phase 3 — Domain Logic Spec Grounding

**Date**: 2026-06-05T18:09:13+02:00
**Researcher**: Claude Sonnet 4.6
**Git Commit**: a1690808ead22d8469774a058725343b8ad1dbf1
**Branch**: master
**Repository**: 10xdev-dst

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md`: "Domain logic — streak + blocker." Research was conducted spec-first because S-03 (standup-submission-and-history) and S-04 (blocker-detection-flow) have not shipped — no domain code exists to read. Research maps the Vitest test infrastructure from Phase 1, extracts the complete domain spec from PRD v3 + roadmap, identifies what pure functions will need to exist, and verifies the risk response guidance in the test plan against spec reality.

## Summary

Phase 3 domain code does not exist. No `standup_entries` table, no streak function, no blocker detection logic. Both S-03 and S-04 are prerequisites that have not yet been planned or implemented. The Vitest infrastructure from Phase 1 is ready and imposes no constraints that would require changes for unit-testing pure functions. The domain spec is fully defined in PRD v3 and is specific enough to derive test oracles now. The test plan's risk response guidance for Risk #4 and #5 is sound — one scope note applies (the confirmation-persistence integration test belongs in Phase 4, not Phase 3).

## Detailed Findings

### 1. Domain Code Survey — Nothing Exists Yet

Searched `src/` and `supabase/` for: `streak`, `blocker`, `standup`, `similarity`, `consecutive`, `businessDay`, `business_day`, `confirmBlock`, `alertThreshold`.

Results:
- **Zero hits in `src/`** for any of the above terms.
- **One schema-level hit in `supabase/migrations/`**: `alert_threshold integer NOT NULL DEFAULT 2` on the `workspace` table — stores the configurable threshold value only, contains no business logic.
- **No `standup_entries` table** in any migration.
- **No `blocker_alerts` table** in any migration.
- `context/changes/standup-submission-and-history/` contains only `change.md` — no research, no plan, no implementation.
- `context/changes/blocker-detection-flow/` does not exist.

**Implication for the test plan**: Phase 3 cannot be implemented until S-03 ships (streak function exists) and S-04 ships (blocker confirmation flow exists). The plan written from this research must reflect that constraint explicitly.

### 2. Current Schema Baseline

**File**: `supabase/migrations/20260604000000_workspace_member_schema.sql`

Tables that exist:
- `workspace(id, name, alert_threshold int DEFAULT 2, created_at)` — `alert_threshold` is the only domain-related column; it configures the blocker alert threshold per workspace.
- `workspace_member(id, workspace_id, user_id, role CHECK IN ('member','team_lead'), joined_at)` — role model is in place.

Types that exist (`src/types.ts`):
- `UserRole = "member" | "team_lead"`
- `Workspace { id, name, alert_threshold: number, created_at }`
- `WorkspaceMember { id, workspace_id, user_id, role, joined_at }`
- **No `StandupEntry`, `Streak`, or `Blocker` types.** These will be introduced by S-03/S-04.

`src/lib/` contains: `supabase.ts` (auth client), `routes.ts` (route constants), `utils.ts` (cn helper), `config-status.ts` (env check). No domain services or business logic.

### 3. Vitest Test Infrastructure from Phase 1

**File**: `vitest.config.ts`
```typescript
export default defineConfig({
  test: {
    environment: "node",            // no browser simulation
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

**Key contracts for Phase 3 test authors**:
- Test files must live in `src/__tests__/` with extension `.test.ts`.
- Vitest functions are NOT global — must import explicitly: `import { describe, it, expect } from "vitest"`.
- Path alias `@/` resolves to `src/` — domain modules import as `import { fn } from "@/lib/streak"`.
- Environment is Node.js — no `window`, `document`, or browser globals needed for pure function tests.
- `npm test` runs all tests once (CI mode); `npm run test:watch` for development.

**Existing test files** (both passing, `npm test` exits 0):
- `src/__tests__/smoke.test.ts` — trivial `expect(1 + 1).toBe(2)` runner check.
- `src/__tests__/route-coverage.test.ts` — filesystem crawl verifying every page is gated or explicitly public; imports from `@/lib/routes`.

**What Phase 3 does NOT need to install**:
- No new Vitest config changes (Node.js env is correct for pure functions).
- No mocking library (streak and blocker logic will be pure functions with no I/O).
- No Supabase test client (Phase 3 is unit, not integration; Phase 2 handles RLS integration).
- No Playwright (that is Phase 2 and later).

### 4. Domain Spec — Streak Rules (Risk #5)

Source: PRD v3 FR-011 (`context/foundation/prd-v3.md:122–123`), Roadmap S-03 (`context/foundation/roadmap.md:102–113`).

**Resolved constraints**:
- Business days are Mon–Fri **only**. Weekend gaps (Sat/Sun) do NOT break the streak.
- Fri→Mon transition counts as consecutive (no business-day gap between them).
- Resolved in PRD v3 — this is no longer an open question.

**Open implementation question** (not yet resolved, owner: user):
- Should streak evaluation use **UTC** or the **user's local timezone**? A user submitting at Fri 11 pm local time (UTC Saturday midnight) must still see their streak preserved. The S-03 plan must resolve this; the Phase 3 test must drive from that decision.

**Test oracle** (from PRD v3 FR-011 — NOT from the implementation):
- `Mon + Tue + Wed` entries → streak = 3
- `Fri + Mon` entries (skipping Sat/Sun) → streak = 2
- A single lone entry → streak = 1
- `Mon + Wed` entries (Tue gap) → streak = 1 (Tue is a business day; skipping it breaks the streak)
- `Thu + Mon` entries (Fri gap) → streak = 1 (Fri is a business day; skipping it breaks the streak)

**Anti-pattern to avoid**: Testing only Mon→Tue→Wed misses the Fri→Mon business-day boundary entirely. The boundary case — where a calendar-day test (Fri=5, Mon=8, difference=3) would wrongly flag a gap — is the precise failure mode Risk #5 is guarding against.

**Expected pure function shape** (to be confirmed by S-03 plan):
```typescript
// src/lib/streak.ts (does not exist yet)
export function calculateStreak(
  entries: StandupEntry[],     // sorted descending by submission date
  referenceDate?: Date         // defaults to "now"; injectable for testing
): number
```
- Pure function: no Supabase calls, no side effects.
- Timezone decision will be reflected in how `entries[*].submitted_at` is normalized.

### 5. Domain Spec — Blocker Detection Rules (Risk #4)

Source: PRD v3 FR-012 (`prd-v3.md:127–128`, `prd-v3.md:150–154`), Roadmap S-04 (`roadmap.md:115–126`).

**Confirmed constraints**:
- System evaluates similarity between **consecutive business-day** blocker entries.
- When similarity is detected, a match suggestion is **surfaced to the member**.
- The blocker alert fires **ONLY** after member confirmation. Dismissal leaves no alert.
- Threshold N (default=2, configurable per workspace by Team Lead): the number of consecutive business days with similar blockers required before a match suggestion fires.
- The similarity evaluation mechanism (keyword overlap, Levenshtein, AI call) is **deferred to S-04 implementation**. Phase 3 unit tests must treat similarity as an injected result or stub, not as an implementation detail.

**Critical confirmation-flow distinction** (important for Phase 3 scope):
- The detection logic (does a match trigger?) and the persistence logic (was the confirmation saved?) are separate concerns.
- Phase 3 unit tests cover: detection firing correctly (or not) given consecutive/non-consecutive days and threshold.
- Confirmation persistence (the integration concern: "member confirms → alert record saved in DB") belongs in Phase 4 or a future integration sub-phase — NOT Phase 3.

**Test oracle** (from PRD v3 FR-012 business rule — NOT from the similarity function's output):

| Scenario | Expected outcome |
|----------|-----------------|
| 2 consecutive business days, similar blockers, member confirms | Alert fires |
| 2 consecutive business days, similar blockers, member dismisses | No alert |
| 2 non-consecutive business days (e.g. Mon + Wed with Tue gap), similar blockers | No match suggestion surfaced |
| 2 consecutive business days, blockers evaluated as different | No match suggestion surfaced |
| Threshold=3, 2 consecutive days with similar blockers | No match suggestion (threshold not met) |
| Threshold=3, 3 consecutive days with similar blockers, member confirms | Alert fires |
| Threshold=2, consecutive days, blocker field empty on day 2 | No match suggestion (empty blocker excluded per US-02 AC) |

**Anti-pattern to avoid**: Using the similarity function's return value as the expected test value — that is the oracle problem. The expected value must come from the PRD business rule table above, not from what the current similarity function returns.

**Expected pure function shape** (to be confirmed by S-04 plan):
```typescript
// src/lib/blocker.ts (does not exist yet)

// Step 1: business-day gap evaluation (pure, no Supabase)
export function isNextBusinessDay(prev: Date, next: Date): boolean

// Step 2: match detection (pure; receives similarity result as parameter,
// so tests can stub similarity without mocking the function under test)
export function shouldSuggestBlockerMatch(
  entries: StandupEntry[],   // consecutive business-day entries with blocker content
  threshold: number,         // from workspace.alert_threshold
  similarityFn: (a: string, b: string) => boolean  // injected; testable with stub
): boolean
```
Treating `similarityFn` as injectable separates the detection logic (business-day counting + threshold) from the similarity mechanism (implementation TBD in S-04).

### 6. Risk Response Guidance Verification

**Risk #4 — blocker alert misfires**

Test plan guidance: "Unit: pure function tests with explicit input sequences (blocker similarity + day gap + threshold); Integration: confirmation → assert alert persisted; dismiss → assert no alert."

Verification:
- ✅ Unit tests for pure functions (day gap + threshold) are feasible. No code correction needed.
- ⚠️ **Scope note — not a risk correction**: The integration test "confirmation → assert alert persisted" requires a `blocker_alerts` table and a real Supabase client. This is NOT a Phase 3 unit test. It belongs in Phase 4 (which covers integration tests once S-04 and S-05 ship) or in a Phase 3 sub-phase if the test plan is updated to split unit from integration. Phase 3 as currently scoped is "unit" only — the plan must reflect this split explicitly.

**Risk #5 — streak wrong count**

Test plan guidance: "Unit: pure function with explicit date sequences."

Verification:
- ✅ Correct. Streak calculation will be a pure function. Unit test with injected dates is the right approach.
- ✅ The Fri→Mon test case must be explicit in the test file — it is the primary guard for this risk.
- ⚠️ **Timezone caveat**: The test can only cover the timezone boundary once the S-03 plan resolves UTC vs. local. The Phase 3 plan must note that the timezone test cases are conditional on that decision.

### 7. Test File Locations and Import Pattern

Based on Phase 1 constraints:

```
src/__tests__/
  smoke.test.ts              ← existing
  route-coverage.test.ts     ← existing
  streak.test.ts             ← Phase 3 (to be created when S-03 ships)
  blocker-detection.test.ts  ← Phase 3 (to be created when S-04 ships)
```

Standard import pattern:
```typescript
import { describe, it, expect } from "vitest";
import { calculateStreak } from "@/lib/streak";
import { isNextBusinessDay, shouldSuggestBlockerMatch } from "@/lib/blocker";
```

No additional test utilities, setup files, or mocking libraries are needed for these pure function tests.

## Code References

- `vitest.config.ts:1–14` — Vitest configuration (env: node, include pattern, alias)
- `package.json:5–14` — npm test scripts; `"test": "vitest run"`
- `src/__tests__/smoke.test.ts:1–7` — trivial runner check pattern
- `src/__tests__/route-coverage.test.ts:1–77` — structural test importing from `@/lib/routes`
- `src/lib/routes.ts:1–8` — example of a lib module shared by middleware and tests
- `src/types.ts:1–16` — current type surface (no standup/streak/blocker types)
- `supabase/migrations/20260604000000_workspace_member_schema.sql:2–8` — workspace table with `alert_threshold`
- `context/foundation/prd-v3.md:122–128` — FR-011 (streak) and FR-012 (blocker) resolved rules
- `context/foundation/prd-v3.md:150–154` — Business Logic section with blocker flow spec
- `context/foundation/roadmap.md:102–126` — S-03 and S-04 unknowns and risks

## Architecture Insights

**Pure function pattern is the right layer for Phase 3.** Both streak calculation and blocker detection are business rules applied to a sequence of dates and strings. They have no intrinsic dependency on the database — they consume data that the API layer fetches. Testing them as pure functions is cheaper, faster, and more precise than any integration or e2e approach.

**Similarity is injectable.** The blocker detection function's dependency on a similarity evaluation should be taken as a parameter, not called internally. This keeps the detection logic (business-day counting + threshold enforcement) testable independently of the similarity mechanism, which is explicitly deferred to S-04.

**Timezone handling will be a wrapper concern, not a pure-function concern.** The streak function's `referenceDate` parameter allows the caller (the Astro API route) to normalize timezone before calling the pure function. The test can inject any date it wants, so timezone coverage only requires tests that pass dates near a business-day boundary (e.g., Fri 11:59 PM UTC vs Sat 00:01 UTC).

**No new Vitest infrastructure needed.** Phase 3 drops two test files into the existing `src/__tests__/` directory. The existing Node.js environment handles them without changes to `vitest.config.ts`.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-workspace-member-schema/` — F-01 established `workspace.alert_threshold` column. This is the only persisted configuration for blocker threshold. Tests that verify threshold behavior must read from `workspace.alert_threshold`, not a hardcoded constant.
- `context/archive/2026-06-04-auth-and-workspace/` — S-01 established the `workspace_member.role` model ('member' | 'team_lead'). The Team Lead role is the only actor that can change `alert_threshold` (FR-015). Phase 3 unit tests don't test this permission — that is Phase 4's scope — but the role model is background context.
- `context/changes/testing-runner-auth-routing/` — Phase 1 bootstrap. Vitest config, test file pattern, and import conventions established here are binding for Phase 3.

## Open Questions

1. **UTC vs. local timezone for streak evaluation** — Must be resolved in the S-03 plan. Phase 3 test cases for timezone boundary (Risk #5) cannot be finalized until S-03 decides. The Phase 3 plan should note this dependency and mark the timezone test cases as conditional.

2. **Streak storage model** — Is `streak` stored as a column on `standup_entries` or derived on read from the entry history? This affects what `calculateStreak()` receives as input. The S-03 plan must specify. If streak is a stored column (not derived), the pure function may instead be a recalculation helper used on writes, which changes the test shape slightly.

3. **Similarity function interface** — The S-04 plan will define the signature of the similarity evaluation. Phase 3 tests should stub it with a boolean-returning function, but the Phase 3 plan must note that the stub must match the final interface.

4. **Confirmation persistence** — The integration test "member confirms → alert persisted in DB" is out of scope for Phase 3 unit tests. Where does it land? Options: (a) Phase 4 (security + invite integration) as an additional sub-phase; (b) a Phase 3.5 integration sub-phase added after S-04 ships. The Phase 3 plan should note this scope gap and leave a placeholder.
