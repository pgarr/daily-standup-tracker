<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Member Invite and Join

- **Plan**: context/changes/member-invite-and-join/plan.md
- **Scope**: Phase 2 of 4
- **Date**: 2026-06-05
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — workspaceName interpolated as raw HTML in email body

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/email.ts:19–21
- **Detail**: workspaceName is user-controlled and interpolated directly into the HTML email body without escaping. A crafted workspace name can inject arbitrary HTML into the email sent to invitees.
- **Fix A ⭐ Recommended**: Add `esc()` helper and apply to workspaceName in the HTML body.
  - Strength: Two-line fix, no dependency, idiomatic HTML-safe approach.
  - Tradeoff: None significant.
  - Confidence: HIGH — workspaceName is the only untrusted variable in the body.
  - Blind spot: None significant.
- **Fix B**: Switch email body to plain text (text: field instead of html:).
  - Strength: Eliminates the entire HTML injection surface class.
  - Tradeoff: No clickable link — user must copy-paste.
  - Confidence: MED — degrades UX.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

### F2 — decodeURIComponent on already-decoded query param crashes on bad input

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/workspace/members.astro:83
- **Detail**: Astro.url.searchParams.get() already returns a decoded string. Passing it to decodeURIComponent() is double-decoding. A malformed percent-sequence in the URL causes URIError, crashing the SSR render with a 500.
- **Fix**: Replace `{decodeURIComponent(error)}` with `{error}` — searchParams.get already decoded it.
- **Decision**: FIXED

### F3 — invite-cancel DELETE missing application-layer workspace_id guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/workspace/invite-cancel.ts:21–39
- **Detail**: The DELETE filtered only by invite id with no workspace_id filter, relying entirely on RLS for ownership enforcement. Compare with invite.ts which explicitly binds workspace_id on INSERT as defense-in-depth.
- **Fix**: Add workspace_id to member query (`select("id, role, workspace_id")`) and add `.eq("workspace_id", memberData.workspace_id)` to the DELETE.
- **Decision**: FIXED

### F4 — invite link built from context.url.origin after insert commits

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/workspace/invite.ts:59
- **Detail**: inviteLink was computed after the INSERT committed. A bad origin would produce a broken link with no email_warning path triggered. Low practical risk in Cloudflare Workers where origin is always set.
- **Fix**: Move inviteLink computation to before the INSERT.
- **Decision**: FIXED

### F5 — authz-failure redirect goes to /auth/signin instead of /dashboard

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/workspace/invite.ts:32 and invite-cancel.ts:28
- **Detail**: Both endpoints redirected to /auth/signin when the caller was authenticated but not a team_lead. The members.astro page redirects to /dashboard for the same condition — a pattern mismatch.
- **Fix**: Change redirect from /auth/signin to /dashboard in both files for the role !== 'team_lead' branch.
- **Decision**: FIXED

### F6 — missing export const prerender = false per CLAUDE.md convention

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/workspace/invite.ts and invite-cancel.ts (top of file)
- **Detail**: CLAUDE.md states "API routes must export const prerender = false." Neither new endpoint exported it. Safe at runtime with output:"server", but violates the stated convention.
- **Fix**: Add `export const prerender = false;` at the top of both files.
- **Decision**: FIXED
