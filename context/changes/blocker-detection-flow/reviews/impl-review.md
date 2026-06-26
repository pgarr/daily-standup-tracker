<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Blocker Detection Flow (S-04)

- **Plan**: context/changes/blocker-detection-flow/plan.md
- **Scope**: All 4 Phases (full plan)
- **Date**: 2026-06-26
- **Verdict**: APPROVED (after triage fixes)
- **Findings**: 0 critical  2 warnings  2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → FIXED |
| Architecture | WARNING → FIXED |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — blocker_alerts query is unbounded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:39
- **Detail**: `blocker_alerts` fetch had no date filter and no LIMIT. History badges only render on last 30 entries (~6 weeks). After a year of active daily use this grows to ~250 rows fetched and discarded on every load.
- **Fix**: Added `.gte("trigger_date", sixtyDaysAgo).limit(90)` — covers 30 displayEntries with headroom, matches standup_entries limit=60 budget.
- **Decision**: FIXED

### F2 — Two DB queries ran sequentially on every dashboard load

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:26–40
- **Detail**: standup_entries and blocker_alerts fetches were independent but issued sequentially. Each round-trip added network latency on every dashboard load.
- **Fix A ⭐ Applied**: Parallelized with Promise.all — both queries now fire concurrently.
- **Decision**: FIXED via Fix A

### F3 — Immutable-alert design undocumented at the table level

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260607000000_blocker_alerts.sql:21
- **Detail**: No UPDATE policy exists — correct by design. Application code documents this, but the migration itself had no comment. A DBA adding a future UPDATE policy would silently break the invariant.
- **Fix**: Added `-- No UPDATE policy: alerts are immutable (first action wins, ignoreDuplicates=true)` comment above the INSERT policy.
- **Decision**: FIXED

### F4 — Silent LLM fallback can mask model deprecation or API failures

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/similarity.ts:30
- **Detail**: `haikuSimilarity` catches all API errors and falls back to Jaccard without surfacing the failure. If the model snapshot is deprecated or billing lapses, LLM detection stops working with no visible signal.
- **Fix**: Upgraded log message to include "LLM detection degraded" as a searchable keyword and model ID for operator diagnostics. Lesson saved to context/foundation/lessons.md.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Silent LLM fallback can mask model deprecation or API failures
