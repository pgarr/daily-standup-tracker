---
date: 2026-06-07T18:35:42Z
researcher: Claude Sonnet 4.6
git_commit: 2a43b7c6556d114591d5ca309e030d2bf09cc7ec
branch: master
repository: pgarr/daily-standup-tracker
topic: "What AI platform to use for detecting similar blockers?"
tags: [research, blocker-detection, ai, similarity, cloudflare-workers, s-04]
status: complete
last_updated: 2026-06-07
last_updated_by: Claude Sonnet 4.6
---

# Research: What AI platform to use for detecting similar blockers?

**Date**: 2026-06-07T18:35:42Z
**Researcher**: Claude Sonnet 4.6
**Git Commit**: 2a43b7c6556d114591d5ca309e030d2bf09cc7ec
**Branch**: master
**Repository**: pgarr/daily-standup-tracker

## Research Question

What platform (AI service, algorithm, or other mechanism) should power the blocker
similarity detection in the `blocker-detection-flow` (S-04) slice?

## Summary

**The decision is deliberately open.** Every project document — PRD, roadmap, plans, tech-stack
— defers the choice to S-04's `/10x-plan` session. Three candidate mechanisms are named
consistently: (1) keyword/overlap algorithm, (2) Levenshtein distance, (3) external AI inference
call. The codebase has no AI infrastructure today.

**Recommendation: ship MVP with a keyword overlap algorithm; upgrade to Claude Haiku
(Anthropic API) if quality proves insufficient.** The reasoning and all tradeoffs are in
"Architecture Insights" below.

The binding contract for the implementation is already locked in (from `test-phase-3`):

```typescript
// Injected into shouldSuggestBlockerMatch as the third parameter
similarityFn: (a: string, b: string) => boolean
```

Whatever platform S-04 picks slots in here without touching detection logic or existing tests.

---

## Detailed Findings

### 1. Current infrastructure state — nothing AI-related exists

| Artifact | AI content |
|---|---|
| `package.json` | No AI/ML SDK packages (no openai, @anthropic-ai/sdk, @cloudflare/ai, cohere) |
| `wrangler.jsonc` | No `[ai]` binding; only name, main, compatibility settings, assets |
| `.dev.vars` | Only `SUPABASE_URL` and `SUPABASE_KEY` |
| `.env.example` | Only Supabase + `RESEND_API_KEY` |
| `astro.config.mjs` | env schema has no AI API key fields |
| `src/env.d.ts` | No `AI` binding declared; only Supabase user/workspace locals |
| `src/lib/blocker.ts` | STUB — throws "not yet implemented — ships with S-04" |

The similarity injection point (`similarityFn`) in `src/lib/blocker.ts:8` is the only
foothold. Everything else is a blank slate.

### 2. What the spec says — deliberately deferred

**`context/foundation/prd-v3.md:154`** (Business Logic section):
> "The similarity evaluation mechanism — how the system determines whether two blocker entries
> describe the same issue — is a downstream implementation decision."

**`context/foundation/roadmap.md` S-04 open question**:
> "How will blocker similarity be evaluated — keyword overlap, Levenshtein distance, or an
> external AI inference call? — Owner: user. Block: no. PRD Business Logic explicitly defers
> this to a downstream implementation decision; any mechanism satisfying US-02 acceptance
> criteria is valid."

**`context/foundation/roadmap.md` S-04 risk**:
> "similarity evaluation is the product's core differentiating mechanic; if it fires too
> eagerly (false positives) or too rarely, user trust breaks before the north star is
> demonstrated — getting the similarity heuristic right in this slice matters even if the
> exact mechanism is an implementation call"

No vendor, service, or algorithm is mandated anywhere. The decision is explicitly the owner's.

### 3. What the tech stack doc already decided about AI integration shape

**`context/foundation/tech-stack.md:24`** (binding architectural signal):
> "The AI/LLM blocker-similarity integration is not bundled — it will be wired in as an
> **Astro API route or Cloudflare Worker calling an external inference endpoint**."

Key consequence: if AI is chosen, the pattern is **external HTTP call**, not Cloudflare Workers
AI's native binding. The similarity computation happens on the inference provider's servers,
not inside the Worker process. This matters for CPU cost (see §4).

### 4. Cloudflare Workers runtime constraints for each option

**`context/foundation/infrastructure.md:48`** warns:
> "The Workers Paid plan ($5/mo) is practically required once the AI blocker-similarity feature
> is active, because the free tier's 10ms CPU-per-request budget is too tight for JWT
> verification + **embedding comparison** in the same request."

The "embedding comparison" phrase is the key signal: the infrastructure doc was written with
**Cloudflare Workers AI** (local embedding computation) in mind as the CPU-heavy path. An
outbound HTTP call to an external API adds negligible CPU in the Worker.

| Option | CPU cost in Worker | Workers Paid required? | New infra |
|---|---|---|---|
| Keyword overlap (pure algorithm) | ~0.1ms | No | None |
| Levenshtein distance | ~0.5ms | No | None |
| **Cloudflare Workers AI** (embedding) | ~8–15ms | **Yes — $5/mo** | `[ai]` binding in wrangler.jsonc, `AI` type in env.d.ts |
| **External AI API** (Claude/OpenAI) | ~0.5ms (HTTP overhead) | No | API key secret, SDK package, env schema entry |

### 5. The US-02 acceptance criteria as the quality bar

**`context/foundation/prd-v3.md:64–69`** (US-02 AC):
- Match suggestion fires "when the system evaluates consecutive blocker entries as **likely similar**"
- "does not fire when blockers are evaluated as **clearly different**"
- Member confirmation step guards against false positives

The confirmation step is load-bearing: any mechanism can fire a suggestion, and the member
decides. This means **algorithmic imprecision is acceptable at MVP** — a false suggestion
that the member dismisses is a UX cost, not a bug. Getting to zero missed true-matches
(recall) matters more than avoiding false suggestions (precision) at this stage.

### 6. The binding function contract (locked, cannot change without plan update)

**`context/changes/test-phase-3/plan.md:71–86`**:

```typescript
export function shouldSuggestBlockerMatch(
  entries: readonly { submitted_date: string; blockers: string | null }[],
  threshold: number,
  similarityFn: (a: string, b: string) => boolean,  // ← AI/algorithm slots here
): boolean
```

The `similarityFn` injection means **zero test changes** regardless of which mechanism is
chosen. The 11 blocker-detection tests in `src/__tests__/blocker-detection.test.ts` use
`alwaysMatch`/`neverMatch` stubs and will pass with any implementation.

---

## Architecture Insights

### Option A — Keyword overlap / Jaccard similarity (recommended for MVP)

**How**: normalize both strings to lowercase tokens, compute Jaccard index
(`|intersection| / |union|`), return `true` if ≥ threshold (e.g., 0.25).

**Implementation**: ~25 lines in `src/lib/blocker.ts`, no packages, no secrets, no config.

```typescript
function keywordSimilarity(a: string, b: string): boolean {
  const tokens = (s: string) => new Set(s.toLowerCase().match(/\w+/g) ?? []);
  const setA = tokens(a);
  const setB = tokens(b);
  const intersection = [...setA].filter(t => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 && intersection / union >= 0.25;
}
```

**Strength**: Ships immediately with S-04, zero cost, deterministic, fully testable,
no external dependency. The confirmation step handles false positives.

**Weakness**: Misses rephrasing ("can't push to main" vs "CI keeps failing on my branch").
The PRD acknowledges this: the similarity mechanism can be upgraded post-MVP without changing
the detection logic or tests.

**CPU**: ~0.1ms. No Workers Paid upgrade needed.

### Option B — Cloudflare Workers AI (embeddings + cosine similarity)

**How**: generate embeddings for both strings using `@cf/baai/bge-base-en-v1.5`, compute
cosine distance, return `true` if distance ≤ threshold. Binding: add `[ai]` to `wrangler.jsonc`.

**Strength**: No external API key, runs at the edge, good semantic coverage.

**Weakness**: Adds ~8–15ms CPU per request (embedding computation is the bottleneck).
**Workers Paid plan upgrade required before deploying** (free tier: 10ms CPU/request).
The `tech-stack.md` architectural signal points toward external endpoint, not this pattern.

**Infrastructure changes needed**:
1. `wrangler.jsonc`: add `[ai]` binding
2. `src/env.d.ts`: add `AI: Ai` to `Locals` or `Env`
3. No package needed — Workers AI is a runtime binding

### Option C — External AI API: Claude Haiku (Anthropic) — recommended AI option

**How**: call Anthropic's Claude Haiku (`claude-haiku-4-5-20251001`) from a server-side
Astro API route with a prompt: "These are two blocker entries from a standup tracker. Are
they describing the same blocking issue? Answer YES or NO.\n\nEntry 1: {a}\nEntry 2: {b}".
The route returns `{ similar: boolean }`. The `similarityFn` calls this endpoint.

**Strength**: Matches the `tech-stack.md` "external inference endpoint" pattern exactly.
Natural fit — this project is already built using the Anthropic/Claude toolkit. Claude Haiku
is the cheapest capable model (~$0.25/M input tokens); at low QPS, costs stay below $1/month.
No Workers Paid upgrade needed (outbound HTTP adds ~0.5ms CPU to the Worker).

**Weakness**: External dependency, latency (~300–600ms added to standup submission UX),
requires `ANTHROPIC_API_KEY` secret management. For blocker similarity on short text,
Haiku is likely overkill — a good algorithm may be sufficient.

**Infrastructure changes needed**:
1. `package.json`: add `@anthropic-ai/sdk`
2. `astro.config.mjs` env schema: add `ANTHROPIC_API_KEY`
3. `.dev.vars` + Cloudflare Workers Secret: set the key
4. New file: `src/pages/api/check-blocker-similarity.ts`

### Option D — External AI API: OpenAI embeddings

Similar to Option C but using OpenAI's `text-embedding-3-small`. Slightly better benchmarks
than Claude for embedding-only tasks, but adds an OpenAI dependency when the project already
uses Anthropic's tooling. Not recommended unless there's a specific reason to prefer OpenAI.

---

## Recommended Approach

**Ship MVP with Option A (keyword overlap)**; wire Option C (Claude Haiku) if quality
proves insufficient in real use.

Rationale:

1. **Timeline**: The MVP deadline is 2026-07-31, after-hours only. Option A ships S-04
   immediately with no new infrastructure. Options B and C add setup steps (bindings, secrets,
   SDK, API routes) that consume after-hours budget.

2. **Confirmation guard**: The member confirmation step (FR-012 / US-02) is the primary
   false-positive guard. A suggestion the member dismisses in 2 clicks is not a product failure.
   Algorithmic imprecision is acceptable at MVP.

3. **Upgrade path is trivial**: `similarityFn` is injected. Replacing the keyword function
   with an async Claude Haiku call requires changing one function and adding one API route.
   No tests break. This is the right time to upgrade: after real user feedback on match quality.

4. **External endpoint pattern is pre-decided**: when AI is added, `tech-stack.md` already
   specifies the shape (Astro API route → external endpoint). Claude Haiku fits this directly.
   Cloudflare Workers AI (Option B) requires Workers Paid and contradicts the external-endpoint
   architecture signal.

---

## Code References

- [`src/lib/blocker.ts:1–14`](https://github.com/pgarr/daily-standup-tracker/blob/2a43b7c6556d114591d5ca309e030d2bf09cc7ec/src/lib/blocker.ts#L1-L14) — stub file; S-04 replaces this
- [`src/__tests__/blocker-detection.test.ts`](https://github.com/pgarr/daily-standup-tracker/blob/2a43b7c6556d114591d5ca309e030d2bf09cc7ec/src/__tests__/blocker-detection.test.ts) — 11 tests that pass with any `similarityFn`
- [`context/foundation/tech-stack.md:24`](https://github.com/pgarr/daily-standup-tracker/blob/2a43b7c6556d114591d5ca309e030d2bf09cc7ec/context/foundation/tech-stack.md#L24) — "external inference endpoint" architectural signal
- [`context/foundation/infrastructure.md:48`](https://github.com/pgarr/daily-standup-tracker/blob/2a43b7c6556d114591d5ca309e030d2bf09cc7ec/context/foundation/infrastructure.md#L48) — Workers Paid required for embedding comparison
- [`context/foundation/prd-v3.md:154`](https://github.com/pgarr/daily-standup-tracker/blob/2a43b7c6556d114591d5ca309e030d2bf09cc7ec/context/foundation/prd-v3.md#L154) — "downstream implementation decision"
- [`context/changes/test-phase-3/plan.md:71`](https://github.com/pgarr/daily-standup-tracker/blob/2a43b7c6556d114591d5ca309e030d2bf09cc7ec/context/changes/test-phase-3/plan.md#L71) — binding function contract

## Historical Context (from prior changes)

- `context/archive/2026-06-05-testing-runner-auth-routing/` — no AI mentions; pure routing tests
- `context/archive/2026-06-05-standup-submission-and-history/` — no similarity logic; submission and streak only
- No archived change has tackled blocker similarity. This is the first time it's being scoped.

## Related Research

- `context/foundation/infrastructure.md` — CPU cost modeling for Workers AI vs external API
- `context/foundation/tech-stack.md` — `has_ai: true`, external inference endpoint decision
- `context/changes/test-phase-3/plan.md` — binding `shouldSuggestBlockerMatch` contract
- `context/changes/test-phase-3/research.md` — similarity mechanism noted as "keyword overlap, Levenshtein, AI call — deferred to S-04"

## Open Questions

1. **Quality bar**: Is the keyword overlap threshold (Jaccard ≥ 0.25) right for blocker text?
   Short phrases with high-overlap words ("CI failing" / "CI is broken") score well; longer
   paraphrases may not. The S-04 `/10x-plan` should decide the threshold and whether to
   dog-food the algorithm on real blocker examples before committing.

2. **Async `similarityFn`**: The current binding contract is synchronous:
   `(a: string, b: string) => boolean`. If Claude Haiku is chosen, the function needs to be
   async: `(a: string, b: string) => Promise<boolean>`. This requires updating the
   `shouldSuggestBlockerMatch` signature (and the test-phase-3 plan) before implementing.
   Worth flagging in the S-04 `/10x-plan` session.

3. **Where is similarity evaluated?** On submission (before the form returns), or lazily
   (background job after submission)? For MVP with Option A (algorithm), on-submission is fine.
   For Claude Haiku with its 300–600ms latency, lazy evaluation is preferable to avoid
   degrading standup submission UX.
