# Blocker Detection Flow (S-04) — Plan Brief

> Full plan: `context/changes/blocker-detection-flow/plan.md`
> Frame brief: `context/changes/blocker-detection-flow/frame.md`
> Research: `context/changes/blocker-detection-flow/research.md`

## What & Why

When a member logs a similar blocker on two or more consecutive business days, the system
should surface a match suggestion so they can confirm it as a persistent blocker — turning a
passive standup log into an active signal. S-04 delivers this detection loop end-to-end: detect
→ confirm/dismiss → persist → badge in history. The similarity mechanism (Claude Haiku) was
chosen over a keyword algorithm to ensure semantic rephrasing ("CI failing" vs "CI keeps
breaking") is caught — the roadmap's core risk is "fires too rarely, user trust breaks."

## Starting Point

S-03 is complete: `standup_entries` table, `calculateStreak`, and the dashboard history list
are in place. `src/lib/blocker.ts` has async stub functions and `blocker-detection.test.ts`
has 11 tests gated behind a skip guard. No `blocker_alerts` table, no Anthropic SDK, no
detection logic.

## Desired End State

A member who submits a standup with a blocker similar to their previous business day's blocker
sees a confirmation banner on their dashboard. They can confirm (persistent blocker — badge
appears in their history) or dismiss (different issue — no badge, no re-prompt). The entire
flow uses POST-redirect-GET server actions; no React island is needed. 11 unit tests un-skip
and go green automatically.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Similarity mechanism | Claude Haiku (`claude-haiku-4-5-20251001`) | Handles semantic rephrasing; fits tech-stack "external inference endpoint" pattern | Frame / User |
| Detection architecture | Shape 2 — dashboard SSR frontmatter | Submit always redirects; detection in SSR absorbs Haiku latency with zero UX impact | Frame |
| similarityFn contract | Async `Promise<boolean>` | Required by Haiku; already updated in blocker.ts stub and test-phase-3 binding contract | Plan |
| Haiku failure mode | Jaccard keyword fallback (≥ 0.25) | Maintains the suggestion for obvious matches even during API outages | User |
| Detection trigger | `?blocker_match=1` on submit redirect | Once-per-submission; zero Haiku calls on repeat dashboard loads | User |
| Dismiss persistence | DB-persisted (`blocker_alerts` with status) | Prevents banner re-appearing on reload; same table serves confirmed + dismissed | User |

## Scope

**In scope:**
- `blocker_alerts` table + RLS (member INSERT/SELECT; team_lead SELECT pre-provisioned for S-05)
- `isNextBusinessDay` + `shouldSuggestBlockerMatch` real implementations
- `haikuSimilarity` with Jaccard fallback in `src/lib/similarity.ts`
- Submit API trigger (`?blocker_match=1` redirect)
- `/api/blocker/confirm` + `/api/blocker/dismiss` POST routes
- Confirmation banner + history alert badges in `dashboard.astro`

**Out of scope:**
- Team feed rendering (S-05)
- `alert_threshold` UI (S-05 / FR-015)
- Edit/delete of standup entries (S-06)
- Playwright E2E tests (separate test phase)

## Architecture / Approach

```
[Submit standup with blockers]
          │
          ▼
submit.ts ──redirect──▶ /dashboard?blocker_match=1
          │
          ▼
dashboard.astro (SSR frontmatter):
  1. Fetch recentEntries (already done)
  2. Fetch blockerAlerts for user
  3. if blocker_match=1 && no existing alert for today:
       showBlockerBanner = await shouldSuggestBlockerMatch(
         recentEntries, workspace.alert_threshold, haikuSimilarity
       )
          │
          ▼ (if showBlockerBanner)
[Confirmation banner in template]
  ├── "Yes" → POST /api/blocker/confirm → upsert status:confirmed → redirect /dashboard
  └── "No"  → POST /api/blocker/dismiss → upsert status:dismissed → redirect /dashboard
          │
          ▼
[History list: badge on entries where confirmed alert exists]
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema + Infrastructure | `blocker_alerts` table, `BlockerAlert` type, `ANTHROPIC_API_KEY` env, SDK install | RLS policy gaps could allow cross-user alert reads |
| 2. Detection Logic | Real `isNextBusinessDay` + `shouldSuggestBlockerMatch`; `haikuSimilarity` with fallback; 11 tests go green | UTC date-parsing bug (timezone day-shift in `isNextBusinessDay`) |
| 3. Submit Trigger + Actions | `?blocker_match=1` on submit; confirm + dismiss POST routes | Upsert conflict on duplicate submit (handled via `onConflict`) |
| 4. Dashboard Integration | Banner + badges wired; full end-to-end flow works | Haiku latency adds to SSR round-trip (~300–600ms); fail-safe catch block required |

**Prerequisites:** S-03 archived; `test-phase-3` async contract committed (both done)
**Estimated effort:** ~3 sessions across 4 phases (after-hours budget)

## Open Risks & Assumptions

- Claude Haiku pricing at ~$0.25/M input tokens; low QPS means cost stays negligible at MVP scale
- `astro:env/server` virtual module is not available in Vitest — `similarity.ts` must never be imported from test files (isolation maintained by `similarityFn` injection pattern)
- `submitted_date` strings are user-supplied local dates from the client (`toLocaleDateString("sv")`); UTC parsing is still correct because the detection compares relative day-of-week, not absolute timestamp

## Success Criteria (Summary)

- All 11 `blocker-detection.test.ts` tests pass (skip guard lifts after Phase 2)
- Happy path: submit similar consecutive blockers → banner → confirm → badge in history
- Haiku failure path: invalid API key → Jaccard fallback → banner still appears for obvious matches
