<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Member Invite and Join

- **Plan**: context/changes/member-invite-and-join/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION (all findings fixed during triage)
- **Findings**: 0 critical  4 warnings  1 observation

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

### F1 — Unwhitelisted error param reflected as styled error message

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/accept-invite.astro:53, src/pages/api/workspace/accept-invite.ts:40
- **Detail**: resolveErrorMessage() fallback returned the raw ?error= query param verbatim. accept-invite.ts forwarded raw Supabase error.message into that param for unrecognised errors — both an information-disclosure risk and a social-engineering/phishing vector via crafted links.
- **Fix Applied**: Whitelisted three known sentinel codes in resolveErrorMessage (invite_invalid, already_in_workspace, service_error); changed fallback to "An unexpected error occurred."; replaced raw encodeURIComponent(error.message) in accept-invite.ts with the &error=service_error sentinel.
- **Decision**: FIXED via Fix A

### F2 — invite_token from FormData unguarded against File objects

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signup.ts:20, src/pages/api/auth/signin.ts:8
- **Detail**: form.get("invite_token") was cast directly to string | null. A File object would silently serialise to "[object%20File]" in redirect URLs.
- **Fix Applied**: Added runtime typeof guard — `const inviteToken = typeof rawToken === "string" ? rawToken : null` — in both signup.ts and signin.ts.
- **Decision**: FIXED

### F3 — Missing `prerender = false` in signup.ts and signin.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signup.ts:1, src/pages/api/auth/signin.ts:1
- **Detail**: Every other API route in this change exports prerender = false; signup.ts and signin.ts did not.
- **Fix Applied**: Added `export const prerender = false;` as the first line of both files.
- **Decision**: FIXED

### F4 — signin.ts email/password not Zod-validated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts:7-8
- **Detail**: Pre-existing issue surfaced because Phase 3 touched this file. signup.ts has a Zod schema; signin.ts read email/password as raw string casts.
- **Fix Applied**: Added Zod schema (email + min-1 password) with safeParse before the Supabase call, redirecting to /auth/signin?error=... on failure.
- **Decision**: FIXED

### F5 — Read-only email field submits and can be overridden via crafted POST

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/AcceptInviteForm.tsx:88-96
- **Detail**: The email FormField has readOnly=true but still submits with name="email". A crafted POST could submit a different email to /api/auth/signup.
- **Fix Applied**: Added server-side email verification in signup.ts — when invite_token is present, calls get_invitation_by_token RPC before signUp and redirects with invite_invalid if the submitted email doesn't match the invite's email.
- **Decision**: FIXED
