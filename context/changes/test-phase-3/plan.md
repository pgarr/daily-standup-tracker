# Test Phase 3: Domain Logic Unit Tests — Implementation Plan

## Overview

Write spec-first unit tests for the two domain logic functions that Power Phase 3 of the test rollout: business-day streak calculation (Risk #5) and blocker match detection (Risk #4). The plan defines binding function contracts that S-03 and S-04 must implement, and provides test-case oracles derived from PRD v3 business rules. Tests are implemented in two sub-phases — Phase 3.1 (streak) gates on S-03 shipping; Phase 3.2 (blocker detection) gates on S-04 shipping.

## Current State Analysis

Neither `standup_entries` (S-03) nor the blocker detection flow (S-04) exists in the codebase. The Vitest v4.1.8 infrastructure installed by Phase 1 is the only test foundation in place. Two test files currently pass (`smoke.test.ts`, `route-coverage.test.ts`); both live in `src/__tests__/` and use the established import pattern.

No streak or blocker logic exists anywhere in `src/` or `supabase/`. The only domain-adjacent fact in the codebase is `workspace.alert_threshold integer NOT NULL DEFAULT 2` in `supabase/migrations/20260604000000_workspace_member_schema.sql` — the configurable threshold for blocker alerts (FR-015). There are no `StandupEntry`, `Streak`, or `Blocker` TypeScript types in `src/types.ts`.

This is a **test-driven plan**: the function signatures below are binding contracts. S-03 must expose `calculateStreak` matching the contract in Phase 1; S-04 must expose `isNextBusinessDay` and `shouldSuggestBlockerMatch` matching the contracts in Phase 2. Any deviation from the signatures requires an update to this plan before the implementation proceeds.

## Desired End State

After all three phases of this plan are complete:

1. `src/__tests__/streak.test.ts` contains 7 test cases (including a timezone-boundary pair) and `npm test` passes.
2. `src/__tests__/blocker-detection.test.ts` contains 11 test cases and `npm test` passes.
3. `context/foundation/test-plan.md §6.1` is filled with the unit-test cookbook pattern — location, naming convention, import pattern, run command, and reference to the two new test files.

### Key Discoveries

- Vitest config (`vitest.config.ts:1–14`) runs Node.js environment; tests go in `src/__tests__/**/*.test.ts`; no globals — must import from vitest directly. No config change needed for pure-function tests.
- Existing test pattern (`src/__tests__/route-coverage.test.ts:4`): `import { describe, it, expect } from "vitest"` + `import { ... } from "@/lib/..."`
- The `@/` alias (`vitest.config.ts:10–12`) resolves to `src/` and matches `tsconfig.json:paths`.
- `workspace.alert_threshold` is the only domain-adjacent column that exists today; it stores the N threshold that `shouldSuggestBlockerMatch` will receive as a parameter.
- Similarity is deferred to S-04; it must be injectable so Phase 3.2 tests can prove business-day-counting logic independently of the similarity mechanism.

## What We're NOT Doing

- **Not writing production implementations of `src/lib/streak.ts` or `src/lib/blocker.ts`** — those are S-03 and S-04 deliverables. This plan writes the tests that target those files. Minimal stub files (functions that throw "not yet implemented") are created as part of Phase 1 and Phase 2 to allow TypeScript compilation and lint to pass immediately; S-03/S-04 must replace the stubs with real implementations.
- **Not testing confirmation persistence** ("member confirms → alert record saved in DB") — that requires a real `blocker_alerts` table and Supabase client. Out of scope for Phase 3; belongs in Phase 4 integration tests or a future sub-phase once S-04 ships.
- **Not testing the similarity evaluation algorithm** — the similarity mechanism (keyword overlap, Levenshtein, AI call) is S-04's implementation detail. Phase 3.2 stubs it.
- **Not changing `vitest.config.ts`** — existing Node.js config is correct for pure-function tests.
- **Not writing Playwright or Supabase integration tests** — those are Phase 1 (Playwright) and Phase 2 (RLS) responsibilities.

## Implementation Approach

Both `calculateStreak` and `shouldSuggestBlockerMatch` are pure functions: no I/O, no Supabase, no HTTP. Tests inject fixtures as plain JavaScript objects and verify return values against oracles derived from the PRD v3 business rules. Stub source files for `streak.ts` and `blocker.ts` are created alongside the test files so TypeScript resolves the imports and `npm run lint` passes immediately. `npm test` will exit non-zero (tests fail on thrown errors from stubs) until S-03/S-04 ship real implementations — this is intentional and honest. Progress items 1.1 and 2.1 ("npm test exits 0") are explicitly gated on S-03 and S-04 respectively.

`shouldSuggestBlockerMatch` takes a `similarityFn` parameter — tests pass `() => true` or `() => false` stubs. This keeps business-day-counting and threshold logic independently testable.

## Binding Function Contracts

These signatures are the contracts that S-03 and S-04 must implement. Any change to a signature requires updating this plan before the corresponding `/10x-implement` session.

### `calculateStreak` — export from `src/lib/streak.ts` (S-03 must create this file)

```typescript
export function calculateStreak(
  entries: ReadonlyArray<{ submitted_date: string }>,
  // 'YYYY-MM-DD' strings, sorted descending (newest first).
  // Only submitted_date is consumed; other StandupEntry fields are ignored.
): number
// Returns the length of the longest run of consecutive Mon–Fri days
// ending at entries[0]. Weekend gaps (Sat/Sun) between Friday and Monday
// are invisible — Fri→Mon counts as consecutive. Returns 0 for empty array.
```

### `isNextBusinessDay` — export from `src/lib/blocker.ts` (S-04 must create this file)

```typescript
export function isNextBusinessDay(prev: Date, next: Date): boolean
// Returns true if next is the immediate next business day after prev.
// Fri→Mon = true. Mon→Wed = false (Tue is a business day between them).
// Uses UTC date components (year, month, day) for comparison.
```

### `shouldSuggestBlockerMatch` — export from `src/lib/blocker.ts` (S-04)

```typescript
export function shouldSuggestBlockerMatch(
  entries: ReadonlyArray<{ submitted_date: string; blockers: string | null }>,
  // Sorted descending (newest first). Only submitted_date and blockers consumed.
  threshold: number,
  // From workspace.alert_threshold. Number of consecutive business days required.
  similarityFn: (a: string, b: string) => boolean,
  // Injected; tests pass () => true or () => false stubs.
): boolean
// Returns true if the (threshold) most recent entries form threshold consecutive
// business days AND each consecutive pair has non-null/non-empty blockers that
// similarityFn returns true for. Returns false if any entry has a null or empty
// blockers field.
```

---

## Critical Implementation Details

The **oracle source** for all test assertions is the PRD v3 business rule, not the function's return value. The test must state in a comment WHY the expected value is what it is — e.g., "streak=2 because Fri→Mon is consecutive per PRD v3 FR-011" — so a future reader can verify the assertion against the spec rather than the implementation.

---

## Phase 1: Streak unit tests (Phase 3.1 — gates on S-03 shipping)

**Gate**: A stub `src/lib/streak.ts` is created as part of this phase (see Changes Required §0) so TypeScript resolves the import. The stub throws `new Error("not yet implemented")` — tests will fail on the thrown error until S-03 ships the real `calculateStreak`. Progress item 1.1 (`npm test exits 0`) is explicitly deferred until S-03 ships; items 1.0, 1.2, 1.3, 1.4, 1.5 can be verified in this phase.

### Overview

Create `src/__tests__/streak.test.ts` with 7 test cases that prove business-day streak boundary behavior per PRD v3 FR-011. Tests use plain date string fixtures; no Supabase client, no HTTP.

### Changes Required

#### 0. Streak stub file

**File**: `src/lib/streak.ts`

**Intent**: Minimal stub so TypeScript resolves the `@/lib/streak` import and `npm run lint` passes. Not a real implementation — S-03 must replace this file entirely.

**Contract**:
```typescript
// STUB — replace with real implementation in S-03 (standup-submission-and-history)
// Contract: context/changes/test-phase-3/plan.md § Binding Function Contracts

export function calculateStreak(
  entries: ReadonlyArray<{ submitted_date: string }>,
): number {
  throw new Error("not yet implemented — ships with S-03");
}
```

#### 1. Streak unit test file

**File**: `src/__tests__/streak.test.ts`

**Intent**: Write a suite covering the PRD v3 FR-011 oracle values (6 boundary cases) plus a timezone-boundary pair that documents the `submitted_date` storage contract. Assertions source from the spec; comments explain the business-day rule being exercised.

**Contract**: 7 `it()` blocks under a `describe("calculateStreak")` group; import `calculateStreak` from `@/lib/streak`. Test fixtures are inline `{ submitted_date: 'YYYY-MM-DD' }` objects; no shared setup. The test cases and their expected values are binding — do not derive expected values from the function output:

| # | entries (submitted_date, newest first) | threshold | expected | rule exercised |
|---|---|---|---|---|
| 1 | `['2026-06-03', '2026-06-02', '2026-06-01']` (Wed/Tue/Mon) | — | 3 | standard consecutive run |
| 2 | `['2026-06-01', '2026-05-29']` (Mon/Fri prev week) | — | 2 | Fri→Mon is consecutive; weekend is invisible |
| 3 | `['2026-06-01']` (Mon) | — | 1 | lone entry |
| 4 | `['2026-06-03', '2026-06-01']` (Wed/Mon; Tue gap) | — | 1 | Tue is a business day; skipping it breaks the streak |
| 5 | `['2026-06-01', '2026-05-28']` (Mon/Thu prev week; Fri gap) | — | 1 | Fri 2026-05-29 is a business day; skipping it breaks the streak |
| 6a | `['2026-06-08', '2026-06-05']` (Mon/Fri; correct local date) | — | 2 | timezone-boundary: correct storage returns consecutive streak |
| 6b | `['2026-06-08', '2026-06-06']` (Mon/Sat; wrong UTC date) | — | 1 | timezone-boundary: incorrect UTC storage breaks streak because Sat is not a business day |

Test 6a and 6b are grouped under `describe("timezone boundary")` with a comment:
```
// Tests 6a and 6b document the storage contract for S-03:
// submitted_date MUST be the user's local business date, not the UTC date.
// If a user submits on Fri at 23:59 UTC+2 (= 21:59 UTC), submitted_date
// must be '2026-06-05' (Fri local) for streak continuity.
// calculateStreak trusts submitted_date; the conversion is S-03's responsibility.
```

### Success Criteria

#### Automated Verification

- `src/lib/streak.ts` stub created with correct `calculateStreak` signature (verifiable immediately)
- `npm run lint` passes with both new files
- TypeScript compilation succeeds (`npm run build` or `tsc --noEmit`)
- `npm test` exits 0 with 7 streak tests passing — **gated: verify after S-03 ships real `calculateStreak`**

#### Manual Verification

- Test names in `npm test` output are human-readable and identify the business-day rule exercised (e.g., "Fri→Mon is consecutive; weekend is invisible")
- Test 6a and 6b comments are clear enough that a future S-03 implementer understands the timezone storage contract without reading this plan

---

## Phase 2: Blocker detection unit tests (Phase 3.2 — gates on S-04 shipping)

**Gate**: A stub `src/lib/blocker.ts` is created as part of this phase (see Changes Required §0) so TypeScript resolves the import. The stub functions throw `new Error("not yet implemented")` — tests will fail on the thrown error until S-04 ships real implementations. Progress item 2.1 (`npm test exits 0`) is explicitly deferred until S-04 ships; items 2.0, 2.2, 2.3, 2.4, 2.5, 2.6 can be verified in this phase.

### Overview

Create `src/__tests__/blocker-detection.test.ts` with 11 test cases. Five cover `isNextBusinessDay` (including the Fri→Mon boundary). Six cover `shouldSuggestBlockerMatch` with injectable similarity stubs, proving business-day-counting and threshold enforcement independently of the similarity evaluation algorithm.

### Changes Required

#### 0. Blocker stub file

**File**: `src/lib/blocker.ts`

**Intent**: Minimal stub so TypeScript resolves the `@/lib/blocker` import and `npm run lint` passes. Not a real implementation — S-04 must replace this file entirely.

**Contract**:
```typescript
// STUB — replace with real implementation in S-04 (blocker-detection-flow)
// Contract: context/changes/test-phase-3/plan.md § Binding Function Contracts

export function isNextBusinessDay(_prev: Date, _next: Date): boolean {
  throw new Error("not yet implemented — ships with S-04");
}

export function shouldSuggestBlockerMatch(
  _entries: ReadonlyArray<{ submitted_date: string; blockers: string | null }>,
  _threshold: number,
  _similarityFn: (a: string, b: string) => boolean,
): boolean {
  throw new Error("not yet implemented — ships with S-04");
}
```

#### 1. Blocker detection unit test file

**File**: `src/__tests__/blocker-detection.test.ts`

**Intent**: Prove the detection logic (consecutive-day counting + threshold enforcement + empty-blocker exclusion) is correct per PRD v3 FR-012 business rules. The similarity algorithm is completely replaced by a stub — this is deliberate and load-bearing: these tests must never regress when the similarity algorithm changes.

**Pre-requisite**: `src/lib/blocker.ts` stub must be created first (see Changes Required §0 below).

**Contract**: Two `describe` groups under a top-level `describe("blocker detection")`:

**Group 1 — `describe("isNextBusinessDay")`** — 5 test cases:

| # | prev | next | expected | rule exercised |
|---|---|---|---|---|
| 1 | Mon 2026-06-01 | Tue 2026-06-02 | true | standard consecutive |
| 2 | Fri 2026-05-29 | Mon 2026-06-01 | true | Fri→Mon is next business day; weekend is invisible |
| 3 | Mon 2026-06-01 | Wed 2026-06-03 | false | Tue is between them; not next business day |
| 4 | Thu 2026-05-28 | Mon 2026-06-01 | false | Fri 2026-05-29 is between them |
| 5 | Fri 2026-05-29 | Sat 2026-05-30 | false | Sat is a weekend day |

Pass `Date` objects constructed from ISO strings: `new Date('2026-06-01')`.

**Group 2 — `describe("shouldSuggestBlockerMatch")`** — 6 test cases:

Shared stubs (define at top of describe block):
```typescript
const alwaysMatch = () => true;
const neverMatch = () => false;
```

Entry builder helper (inline fixture — no separate file):
```typescript
const e = (submitted_date: string, blockers: string | null) => ({ submitted_date, blockers });
```

| # | entries (newest first) | threshold | similarityFn | expected | rule exercised |
|---|---|---|---|---|---|
| 1 | `[e('2026-06-01','X'), e('2026-05-29','X')]` (Mon, Fri prev) | 2 | `alwaysMatch` | true | threshold met, consecutive, similar |
| 2 | `[e('2026-06-01','X'), e('2026-05-29','Y')]` | 2 | `neverMatch` | false | similar=false; no match suggestion |
| 3 | `[e('2026-06-03','X'), e('2026-06-01','X')]` (Wed, Mon; Tue gap) | 2 | `alwaysMatch` | false | non-consecutive days; no match suggestion |
| 4 | `[e('2026-06-01','X'), e('2026-05-29','X')]` | 3 | `alwaysMatch` | false | only 2 entries; threshold=3 not met |
| 5 | `[e('2026-06-03','X'), e('2026-06-02','X'), e('2026-06-01','X')]` (Wed/Tue/Mon) | 3 | `alwaysMatch` | true | 3 consecutive days; threshold=3 met |
| 6 | `[e('2026-06-01',null), e('2026-05-29','X')]` | 2 | `alwaysMatch` | false | null blocker on most recent entry; US-02 AC: no match on empty blocker |

Each test case assertion includes a comment citing the PRD v3 FR-012 rule it exercises — e.g., `// PRD v3 FR-012: alert fires ONLY on member confirmation; detection requires similar blockers`.

### Success Criteria

#### Automated Verification

- `src/lib/blocker.ts` stub created with correct `isNextBusinessDay` + `shouldSuggestBlockerMatch` signatures (verifiable immediately)
- `npm run lint` passes with both new files
- TypeScript compilation succeeds
- `npm test` exits 0 with all 11 blocker-detection tests passing (plus all prior tests) — **gated: verify after S-04 ships real implementations**

#### Manual Verification

- Test output identifies which business-day rule each test exercises
- The `alwaysMatch`/`neverMatch` stubs make it obvious to a future reader that similarity is not tested here
- Test 6 (null blocker) comment references US-02 acceptance criteria so the rule source is traceable

---

## Phase 3: Cookbook and test-plan update

### Overview

Fill in `§6.1 Adding a unit test` in `context/foundation/test-plan.md` with the concrete cookbook entry now that Phase 3.1 and 3.2 have shipped. Also annotate the `§3 Phase 3` row to reflect the 3.1/3.2 sub-split and update the timing dependencies note.

> **Note**: Both deliverables (§6.1 content + Phase 3 row annotation) were pre-applied to `test-plan.md` during the planning session. Progress items 3.2–3.4 were true before implementation began and are pre-checked. Phase 3 implementation is a verification-only pass: run `npm run lint` to confirm the file is well-formed (3.1) and visually confirm the pre-applied content meets the manual criteria.

### Changes Required

#### 1. Fill §6.1 cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` placeholder in §6.1 with the concrete unit-test cookbook pattern established by Phase 3.1 and 3.2. This becomes the canonical answer to "how do I add a unit test for domain logic in this project?"

**Contract**: Replace the current `§6.1` body with:

```markdown
### 6.1 Adding a unit test

**Location**: `src/__tests__/` — all Vitest tests live here.
**Naming**: `{feature}.test.ts` (e.g., `streak.test.ts`, `blocker-detection.test.ts`).
**Import pattern**:
  - Vitest: `import { describe, it, expect } from "vitest"`
  - Domain module: `import { fn } from "@/lib/{module}"`
**Run command**: `npm test` (single-run, CI mode) or `npm run test:watch` (development).
**Environment**: Node.js — no browser globals, no Supabase client needed for pure functions.
**Reference tests**: `src/__tests__/streak.test.ts` (date-fixture pure function), `src/__tests__/blocker-detection.test.ts` (injectable-stub pure function).
**Key pattern**: Assertions must cite the PRD business rule they test, not the function output. The expected value comes from the spec, not the code.
```

#### 2. Annotate §3 Phase 3 row

**File**: `context/foundation/test-plan.md`

**Intent**: Update the Phase 3 row in the `§3 Phased Rollout` table to reflect the 3.1/3.2 sub-split and update the timing dependency note.

**Contract**: Update the `Phase 3` goal cell to add: "(Phase 3.1: streak tests, gates on S-03; Phase 3.2: blocker tests, gates on S-04)". Update the timing dependency line to: "Phase 3: Phase 3.1 gates on S-03 shipping (calculateStreak must exist); Phase 3.2 gates on S-04 shipping (isNextBusinessDay + shouldSuggestBlockerMatch must exist)."

### Success Criteria

#### Automated Verification

- `npm run lint` passes (no .md lint rules, but confirms the file is well-formed)

#### Manual Verification

- `§6.1` is no longer a `TBD` — it contains file location, naming, import pattern, run command, and reference tests
- A developer unfamiliar with the project can follow the cookbook to add a new unit test for domain logic without reading any other doc
- `§3 Phase 3` row notes the 3.1/3.2 split so future `/10x-test-plan` invocations can derive state correctly

---

## Testing Strategy

### Unit Tests

This plan IS the testing strategy. All deliverables are test files. The risk-response coverage:

- **Risk #5 (streak)**: Cases 1–5 cover the boundary table from the test plan's Risk Response Guidance; 6a/6b prove the timezone storage contract.
- **Risk #4 (blocker detection)**: `isNextBusinessDay` tests cover the business-day-gap logic; `shouldSuggestBlockerMatch` tests cover threshold enforcement, non-consecutive rejection, and empty-blocker exclusion. Similarity is injected — algorithm changes cannot break these tests.

### What is NOT Covered by Phase 3

- Confirmation persistence (member confirms → alert stored): Phase 4 integration tests
- RLS isolation on standup_entries: Phase 2
- Team Lead role gate on team feed: Phase 4
- Edit/delete derived-state consistency: Phase 5

## References

- Research: `context/changes/test-phase-3/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risks #4, #5), §3 (Phase 3), §6.1
- PRD v3 FR-011 (streak): `context/foundation/prd-v3.md:122–123`
- PRD v3 FR-012 (blocker): `context/foundation/prd-v3.md:127–128`, `150–154`
- Roadmap S-03: `context/foundation/roadmap.md:102–113`
- Roadmap S-04: `context/foundation/roadmap.md:115–126`
- Vitest config: `vitest.config.ts:1–14`
- Existing test pattern: `src/__tests__/route-coverage.test.ts:1–4`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Streak unit tests (Phase 3.1 — gates on S-03)

#### Automated

- [x] 1.0 `src/lib/streak.ts` stub created with `calculateStreak` contract
- [ ] 1.1 `npm test` exits 0 with 7 streak tests passing — gated: verify after S-03 ships
- [x] 1.2 `npm run lint` passes with both new files
- [x] 1.3 TypeScript compilation succeeds

#### Manual

- [x] 1.4 Test names in `npm test` output are human-readable and identify the business-day rule exercised
- [x] 1.5 Test 6a/6b comments are clear enough that an S-03 implementer understands the timezone storage contract

### Phase 2: Blocker detection unit tests (Phase 3.2 — gates on S-04)

#### Automated

- [ ] 2.0 `src/lib/blocker.ts` stub created with `isNextBusinessDay` + `shouldSuggestBlockerMatch` contracts
- [ ] 2.1 `npm test` exits 0 with all 11 blocker-detection tests passing (plus all prior tests) — gated: verify after S-04 ships
- [ ] 2.2 `npm run lint` passes with both new files
- [ ] 2.3 TypeScript compilation succeeds

#### Manual

- [ ] 2.4 Test output identifies which business-day rule each test exercises
- [ ] 2.5 The `alwaysMatch`/`neverMatch` stubs make similarity independence obvious to a future reader
- [ ] 2.6 Test 6 (null blocker) comment references US-02 acceptance criteria

### Phase 3: Cookbook and test-plan update

#### Automated

- [ ] 3.1 `npm run lint` passes

#### Manual

- [x] 3.2 `§6.1` is no longer a `TBD` — contains location, naming, imports, run command, and reference tests
- [x] 3.3 A developer unfamiliar with the project can follow the cookbook without reading any other doc
- [x] 3.4 `§3 Phase 3` row notes the 3.1/3.2 sub-split
