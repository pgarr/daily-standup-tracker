<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Member Invite and Join Implementation Plan

- **Plan**: `context/changes/member-invite-and-join/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-05
- **Verdict**: REVISE → SOUND (all findings fixed)
- **Findings**: 2 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | FAIL → FIXED |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → FIXED |
| Plan Completeness | WARNING → FIXED |

## Grounding

9/9 paths ✓, auth_user_is_team_lead ✓, Topbar uses Astro.locals ✓, brief↔plan ✓

## Findings

### F1 — Workspace context guards broken in all three API endpoints

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 2 (invite.ts, invite-cancel.ts), Phase 3 (accept-invite.ts)
- **Detail**: Middleware.ts:23 gates workspace context loading behind `!pathname.startsWith("/api")`. All three endpoint contracts relied on `context.locals.workspaceMember` and `context.locals.workspace` — always null for API routes. invite.ts and invite-cancel.ts Team Lead guards always failed (feature unreachable). accept-invite.ts "no workspace" check always passed (already-in-workspace users got raw DB errors).
- **Fix Applied**: Fix A — per-endpoint DB query. All three endpoints now call `supabase.from("workspace_member").select(...).eq("user_id", user.id).maybeSingle()` directly.
- **Decision**: FIXED via Fix A

### F2 — FormField has no readOnly prop; email field is editable

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — AcceptInviteForm (Change 2)
- **Detail**: FormField.tsx:8–20 has no readOnly, disabled, or inputProps escape hatch. Plan specified email field as readOnly via FormField — impossible with the current component. Email field would be editable.
- **Fix Applied**: Fix A — added Change 0 in Phase 3 to extend FormField with `readOnly?: boolean`. AcceptInviteForm contract updated to reference `readOnly={true}`.
- **Decision**: FIXED via Fix A

### F3 — Email send failure silently drops the invite link

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — invite.ts (Change 8)
- **Detail**: invite.ts called sendInviteEmail() without checking the return value. If Resend fails, the invite row is inserted but the invitee never receives the link; Team Lead sees false "invite sent" feedback.
- **Fix Applied**: invite.ts contract updated to check `emailError`, keep the invite row on failure, and redirect with `?success=invite_created&email_warning=1`.
- **Decision**: FIXED

### F4 — signup.ts contract had two contradictory redirect snippets

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — signup.ts (Change 4)
- **Detail**: Contract showed redirect to `/api/workspace/accept-invite` (wrong, POST endpoint) immediately followed by inline correction. Both versions were visible to the implementer.
- **Fix Applied**: Removed the wrong snippet; kept only the corrected redirect to `/auth/accept-invite?token=X` with a clear explanation.
- **Decision**: FIXED
