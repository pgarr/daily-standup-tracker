<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Team Feed and Alerts

- **Plan**: `context/changes/team-feed-and-alerts/plan.md`
- **Scope**: Full (all 3 phases)
- **Date**: 2026-06-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — canGoNext navigation loop when server UTC date is a weekend

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/team-feed.astro:66`
- **Detail**: `canGoNext = selectedDate < today`. When the server's UTC date is Saturday or Sunday (2 days/week), `selectedDate` is snapped to the preceding Friday. `"friday" < "saturday"` is true, so the Next button renders and links to `nextDate = nextBusinessDay(Friday) = Monday`. But Monday > Saturday, so on the next page-load Monday gets clamped back to today (Saturday), snapped back to Friday — the exact same page. User is stuck in an infinite navigation loop on weekends.
- **Fix**: Change to `const canGoNext = nextDate <= today;` — when today is Saturday and nextDate is Monday, `"monday" <= "saturday"` is false, button disabled. On weekdays everything works correctly.
- **Decision**: FIXED — changed `canGoNext = selectedDate < today` to `canGoNext = nextDate <= today`

### F2 — CSRF check is fail-open when no Origin/Referer headers present

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/workspace/update-threshold.ts:17–26`
- **Detail**: The guard is structured as `if (requestOrigin) { ... compare ... }`. When both headers are absent (privacy browser extensions, server-to-server calls), the check is skipped entirely and the POST executes. Practical risk is mitigated by Supabase's SameSite=Lax cookie behavior but the defence-in-depth contract is broken. Same pattern exists across all sibling endpoints (invite, invite-cancel, blocker/confirm, blocker/dismiss) — this is a codebase-wide gap, not unique to this change.
- **Fix A ⭐ Recommended**: Fix only this endpoint (fail-closed: `if (!requestOrigin) return new Response("Forbidden", { status: 403 })`) and file a follow-up to apply consistently across all sibling endpoints.
  - Strength: Newest endpoint doesn't inherit the legacy gap; isolated, safe change.
  - Tradeoff: Creates a temporary inconsistency with sibling endpoints until follow-up lands.
  - Confidence: HIGH — the fix is mechanical and narrow.
  - Blind spot: Users with aggressive privacy extensions that strip both headers would get 403 on threshold save only (not on invite or blocker confirm). Unlikely but worth noting.
- **Fix B**: Skip for now; track as a codebase-wide hardening task.
  - Strength: Keeps all endpoints consistent; SameSite=Lax provides real mitigation.
  - Tradeoff: Leaves the gap in the newest code where it's easiest to fix.
  - Confidence: MED — depends on whether the team considers SameSite=Lax sufficient.
  - Blind spot: SameSite=Lax does not protect subdomains or cross-site navigations that trigger GET-then-POST flows.
- **Decision**: FIXED via Fix A — inverted to fail-closed; `if (!requestOrigin) return 403` before origin comparison

### F3 — Weekend snap applied after clamping; a weekend lowerClamp date exposes data before the 10-day boundary

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/team-feed.astro:54–61`
- **Detail**: `lowerClamp = today − 10 days` sometimes lands on a Saturday (today=Sunday) or Sunday (today=Monday). A user navigating to `?date=<lowerClamp>` passes clamping (it equals lowerClamp), then gets snapped to Friday, which is before lowerClamp. The page then shows standup data from up to 11 days ago. Risk is low: only a Team Lead, about their own workspace, requiring deliberate URL construction.
- **Fix**: Apply the weekend snap before the clamp, not after. Or compute lowerClamp as the nearest business day on-or-after `today − 10`.
- **Decision**: FIXED — snap moved before clamp; comment added explaining the ordering requirement

### F4 — No upper bound on alert threshold

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/workspace/update-threshold.ts:8`
- **Detail**: Schema is `z.coerce.number().int().min(1)`. A team lead can save `threshold=999999`, effectively disabling blocker alerts for their workspace. Not externally exploitable (only the team lead is affected), but a fat-finger could silently suppress alerts.
- **Fix**: Add `.max(365, "Threshold cannot exceed 365 days")` to the Zod chain.
- **Decision**: FIXED — added `.max(365, "Threshold cannot exceed 365 days")` to Zod schema
