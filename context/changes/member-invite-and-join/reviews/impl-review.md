<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Member Invite and Join

- **Plan**: context/changes/member-invite-and-join/plan.md
- **Scope**: All phases (Phase 1–4)
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION (all findings fixed)
- **Findings**: 0 critical, 7 warnings, 0 observations

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

### F1 — No `accepted_at IS NULL` guard on cancel policy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605000000_workspace_invitation.sql + src/pages/api/workspace/invite-cancel.ts
- **Detail**: The RLS DELETE policy for "team lead can cancel invitation" had no guard preventing cancellation of already-accepted invitations. The API handler also lacked the `.is("accepted_at", null)` filter.
- **Fix**: New migration `20260606000000_guard_invitation_cancel.sql` adds `AND accepted_at IS NULL` to the policy; API handler got `.is("accepted_at", null)` filter.
- **Decision**: FIXED (Fix A)

### F2 — Stale INSERT policy on workspace_member superseded by SECURITY DEFINER function

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605000000_workspace_invitation.sql
- **Detail**: The original migration created an "invited user can join workspace as member" INSERT policy on workspace_member. Migration 20260605000001 replaced this with the `accept_invitation` SECURITY DEFINER function but didn't drop the old policy, leaving it as an unauthorized alternate join path.
- **Fix**: New migration `20260606000001_drop_stale_workspace_member_insert_policy.sql` drops the stale policy.
- **Decision**: FIXED (Fix A)

### F3 — Error redirects in accept-invite.ts dropped the token

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/workspace/accept-invite.ts
- **Detail**: The early-exit redirects for `!supabase` and invalid schema were built before `rawToken` was extracted from the form, so error redirects couldn't include the token for the user to retry.
- **Fix**: Extract `rawToken` before supabase check; include token in both early-exit redirect URLs.
- **Decision**: FIXED

### F4 — RPC error in signup.ts redirected to `invite_invalid` instead of `service_error`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signup.ts
- **Detail**: When `get_invitation_by_token` RPC returned an error, the code fell through to `inviteData?.email !== email` check which evaluated falsy, redirecting to `invite_invalid` — misleading for a server-side error.
- **Fix**: Destructure `error` from the RPC call; redirect to `service_error` when error is non-null.
- **Decision**: FIXED

### F5 — `lookupError` branch unreachable when `supabase` is null

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/accept-invite.astro
- **Detail**: The condition `!supabase || lookupError` was inside an `else if (!token)` branch that itself was inside `if (token && supabase)`. When `!supabase`, the outer condition was false, so lookupError was never set and the template's `!supabase || lookupError` condition was dead.
- **Fix**: Split `if (token && supabase)` into two independent template conditions: `!token` and `!supabase || lookupError`.
- **Decision**: FIXED

### F6 — Dead `serverError` prop and `ServerError` import in InviteForm.tsx

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/workspace/InviteForm.tsx
- **Detail**: InviteForm had a `serverError?: string` prop and `ServerError` import that were never used — the invite page passes no such prop.
- **Fix**: Removed the dead prop and import.
- **Decision**: FIXED

### F7 — confirm-email page silently dropped invite_token in prod email-confirmation flow

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/auth/confirm-email.astro
- **Detail**: When `signup.ts` redirects to `/auth/confirm-email?invite_token=X` (the prod path for new accounts), the confirm-email page showed generic content with no mention of the pending workspace invite, leaving users confused about what to do after email confirmation.
- **Fix**: Read `invite_token` from searchParams; show a contextual purple info box "After confirming your email, your invite to join the workspace will be waiting for you."
- **Decision**: FIXED
