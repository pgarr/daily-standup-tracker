# Frame Brief: Blocker Detection Flow (S-04)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

S-04 (blocker-detection-flow) must be planned. The roadmap outcome is: detect similar
consecutive blockers → surface match suggestion → member confirms or dismisses → confirmed
match fires a blocker alert visible in member history and the team feed.

The leading question brought from research: which similarity mechanism — keyword overlap vs
AI — and is the synchronous `similarityFn` contract right if we go async?

## Initial Framing (preserved)

- **User's stated approach**: keyword overlap for MVP; Claude Haiku (Anthropic) as the upgrade
  path; similarity mechanism is the lead planning question.
- **User's proposed direction**: resolve similarity mechanism framing → plan S-04.
- **Pre-dispatch narrowing**: "The similarity mechanism — keyword overlap vs AI, and whether
  the synchronous similarityFn contract is still correct if we go async."

## Dimension Map

The similarity mechanism decision could be wrongly framed at any of these dimensions:

1. **Contract shape** — sync `(a,b)→boolean` was locked in by test-phase-3 before the mechanism
   was known. If mechanism is async, the contract needs to change. ← initial framing focused here
2. **Algorithm recall** — keyword overlap handles lexical overlap well but misses rephrasing.
   The roadmap risk note: "fires too rarely → user trust breaks." Confirmation guard only
   protects false positives, not false negatives.
3. **Detection timing** — "AI adds 300–600ms latency" assumes detection runs synchronously
   in the submit API response path. If detection runs in the dashboard SSR after the redirect,
   latency is absorbed by normal page load and becomes irrelevant.
4. **Upgrade cost** — research called the sync→async upgrade "trivial." Needs verification.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
|---|---|---|
| Sync contract is a hard constraint on mechanism choice | `plan.md:13` — contract is documentation-only, not TypeScript-enforced. Async conversion: 4 files, 6 `it()` blocks, mechanical `async`/`await` additions. `blocker.ts:8`, `blocker-detection.test.ts:43-44,50,56,62,68,74,80` | **WEAK** — contract is cheap to change |
| AI adds unacceptable latency to submission UX | `src/pages/api/standup/submit.ts:72` — submit API always redirects; never returns JSON. No confirmation page exists. Flow: submit → redirect → `/dashboard` re-renders via SSR. PRD (prd-v3.md:62–64) imposes no timing constraint on when suggestion surfaces relative to HTTP response. | **NONE** — latency argument rests on wrong architectural assumption |
| Detection runs synchronously in the submit API (Shape 1) | Submit API returns a redirect; detection output would need a query param (`?blocker_match=1`). For keyword overlap: adds ~0.1ms — fine. For Claude Haiku: adds 300–600ms — visible. | **PARTIAL** — viable for algorithm; poor for AI |
| Detection runs in dashboard SSR after redirect (Shape 2) | `src/pages/dashboard.astro:17-31` already fetches all recent entries during SSR. Detection would call `shouldSuggestBlockerMatch` there, using data already in scope. Any similarity mechanism (sync or async) works in an `async` frontmatter. Confirmation prompt slots naturally into the submitted-state card (line 87–121). | **STRONG** — natural architecture, zero additional data fetching, async-compatible |
| Keyword overlap has sufficient recall for blocker text | No verified test of recall on real blocker patterns. "CI failing" vs "CI broken": Jaccard ~0.5 (MATCH). "Build pipeline broken" vs "can't push to main": Jaccard ~0 (MISS). For MVP with low QPS and few users, misses are invisible UX — the feature just doesn't fire; users don't see it as broken. | **WEAK** — may be acceptable at MVP; unknown real-world recall |

## Narrowing Signals

- **Detection architecture resolves the latency objection.** The submission flow (submit → redirect → dashboard SSR) means detection ALWAYS runs server-side before the page renders. Any similarity mechanism — including a 500ms Claude Haiku call — costs no more than a normal SSR round-trip. The latency concern that drove "algorithm-first" was based on an incorrect assumption about where detection runs.
- **The sync contract is a documentation agreement, not a type constraint.** Changing it costs 4 files of mechanical `async`/`await` edits. It is not a meaningful barrier to choosing AI from day one.
- **The PRD imposes no timing constraint.** "Surfaces a match suggestion" does not mean "in the same HTTP response as the submit." The dashboard-render path already satisfies US-02 AC.

## Cross-System Convention

The existing standup submission flow follows the POST-redirect-GET pattern: submit API performs the write and redirects, dashboard re-renders via SSR. All error handling already uses query params (`/dashboard?error=...`). Adding `?blocker_match=1` to the success redirect is consistent with this pattern. Detection-in-dashboard-frontmatter is the idiomatic shape for this codebase.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: S-04 must decide upfront whether to ship keyword
> overlap (algorithm) or Claude Haiku (AI) — not because of latency or contract constraints
> (both are weak), but purely on the tradeoff of **scope vs recall quality**. Both are fully
> viable in the dashboard SSR architecture. The plan should make this choice explicitly and
> then build detection, confirmation UI, and alert storage accordingly.

The original framing treated the sync contract and AI latency as meaningful constraints on mechanism choice. They are not. Both constraints dissolve when detection runs in the dashboard frontmatter (Shape 2). The real question — which the research correctly identified but couldn't fully resolve — is whether keyword overlap's recall is good enough for an MVP with real users, or whether the risk note ("fires too rarely → user trust breaks before north star is demonstrated") warrants AI from day one.

## Confidence

**HIGH** — strong evidence for Shape 2 from the submission flow, confirmed by existing dashboard architecture. The contract analysis is unambiguous. The remaining uncertainty is the strategic call on mechanism (algorithm vs AI) — that is a value judgment, not an investigation question.

## What Changes for /10x-plan

**Architectural decision to lock before planning**: Choose Shape 2 (detection in dashboard
frontmatter) and decide the mechanism (keyword overlap OR Claude Haiku) now, because the
mechanism choice determines whether the `similarityFn` contract stays sync or goes async —
which affects `test-phase-3/plan.md`. The plan should start by locking both decisions, then
scope detection logic + confirmation UI + `blocker_alerts` schema (for S-05) as the three
deliverables.

## References

- `src/pages/api/standup/submit.ts:72` — submit always redirects; no response body
- `src/pages/dashboard.astro:17-31` — entries already fetched in SSR frontmatter
- `src/pages/dashboard.astro:87-121` — confirmation prompt slots here (submitted state card)
- `src/lib/blocker.ts:8` — stub; similarityFn injection point
- `src/__tests__/blocker-detection.test.ts:43-44,50,56,62,68,74,80` — sync contract sites
- `context/changes/test-phase-3/plan.md:13,72-86` — binding contract and deviation rule
- `context/foundation/prd-v3.md:62-64,127,150-154` — US-02 AC (no timing constraint)
- `context/foundation/roadmap.md:125` — "fires too rarely → user trust breaks" risk
- `context/foundation/tech-stack.md:24` — "external inference endpoint" architectural signal
- Investigation tasks: #16 (contract fitness), #17 (detection timing)
