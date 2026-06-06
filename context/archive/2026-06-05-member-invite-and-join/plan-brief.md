# Member Invite and Join — Plan Brief

> Full plan: `context/changes/member-invite-and-join/plan.md`

## What & Why

S-02 adds the email invite flow that allows a Team Lead to bring Members into their workspace. Without this slice, the product is single-user only — the team standup feed (north star S-05) cannot be demonstrated. A Team Lead sends an invite link via email (Resend API); the invitee clicks the link, registers or signs in, and joins the workspace as a Member.

## Starting Point

S-01 is complete: auth, workspace creation, middleware, and the three-tier routing funnel all work. The F-01 migration explicitly reserved space for "S-02 will add a separate policy for Team Lead inserting invited members." No invite table or invite UI exists yet. The codebase uses the anon key only — no service role key is configured.

## Desired End State

A Team Lead can open `/workspace/members`, invite any email address, and see a pending invite appear in the list. The invitee receives an email, clicks the link, and lands on `/auth/accept-invite?token=X` where they create an account or sign in. After clicking "Join Workspace," they land on `/dashboard` with the Member role. The Team Lead immediately sees them in the members list. Expired and already-used links show a clear error page with guidance to contact the Team Lead.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Invite mechanism | Custom `workspace_invitation` table + token | No service role key configured; anon-key-only design means Supabase `inviteUserByEmail()` is unavailable | Plan |
| Email sending | Resend API (RESEND_API_KEY, optional) | Production-grade, Cloudflare Workers compatible, free tier covers MVP; gracefully degrades to console.log in dev | Plan |
| Existing user handling | Detect at accept time, fork UX | Handles all real cases (new user, existing user without workspace, already-in-workspace) without confusing error messages | Plan |
| Invite UI placement | New `/workspace/members` page | Clean separation from dashboard; grows naturally as S-05 adds the team feed | Plan |
| Expired/used token | Clear error page with "contact Team Lead" hint | Silent failures are confusing; the error gives the user a concrete next step | Plan |
| Pending invite management | List + cancel (DELETE) | Team Lead needs visibility into outstanding invites and the ability to revoke them | Plan |
| Dashboard navigation | Members link in Topbar for Team Lead only | Makes the new page discoverable for manual testing and real use immediately after S-02 | Plan |

## Scope

**In scope:**
- `workspace_invitation` table, RLS policies, SECURITY DEFINER helpers
- New `workspace_member` INSERT policy for invited users
- `/workspace/members` page (Team Lead only): member list, invite list with cancel, invite form
- `/api/workspace/invite` (POST: create invite + send email)
- `/api/workspace/invite-cancel` (POST: delete invite)
- `/auth/accept-invite?token=X` page (all states: invalid, unauthenticated, fork UX, error)
- `/api/workspace/accept-invite` (POST: INSERT workspace_member + mark invite accepted)
- `signup.ts` and `signin.ts` threaded with invite_token for email confirmation flow
- Topbar Members nav link (Team Lead only)
- Resend SDK + env var + email helper

**Out of scope:**
- Resend sender domain verification (manual Resend dashboard step, not code)
- Resend invite resend / invite expiry auto-cleanup
- Role promotion (Member → Team Lead)
- Multi-workspace support

## Architecture / Approach

Custom invite token table (`workspace_invitation`) stores the invite lifecycle. Two new SECURITY DEFINER helpers: `get_invitation_by_token(token)` for pre-auth lookup (bypasses RLS safely via function) and `has_valid_invitation(ws_id, email)` as a VOLATILE RLS guard on the `workspace_member` INSERT policy. The accept flow is non-atomic (INSERT workspace_member → UPDATE accepted_at) with compensating DELETE on failure, mirroring the S-01 pattern. Email confirmation in prod is handled by threading `invite_token` through `signup.ts`'s `emailRedirectTo` option.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB migration | `workspace_invitation` table, all RLS policies, SECURITY DEFINER helpers, new workspace_member INSERT policy | `has_valid_invitation` must be VOLATILE per lessons.md — STABLE would allow PostgreSQL caching in multi-row INSERT contexts |
| 2. Invite management page | `/workspace/members` page, invite creation + cancel endpoints, Resend integration | Resend sender domain must be verified before production use; dev gracefully falls back to console log |
| 3. Accept-invite flow | `/auth/accept-invite` page + endpoint, signup/signin token threading | Non-atomic accept + dev-vs-prod signup path fork require careful testing of all UX branches |
| 4. Dashboard nav | Members link in Topbar for Team Leads | Topbar implementation details unknown until file is read — may need prop-passing adjustment |

**Prerequisites:** S-01 complete (workspace, middleware, auth in place); Resend account with verified sender domain for production email delivery.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- Resend sender domain (`noreply@standuptracker.app`) is a placeholder — must be verified in the Resend dashboard before production use; the code will build and run without it in dev.
- `auth.jwt() ->> 'email'` is used in two RLS policies (invite accept UPDATE and workspace_member INSERT guard) — assumes Supabase JWT always contains the `email` claim for authenticated users, which is standard but worth verifying in the Studio RLS simulator.
- The accept flow is non-atomic; a failed `accepted_at` UPDATE after a successful `workspace_member` INSERT leaves the invite in a "pending" state while the member row exists. The compensating DELETE handles this, but a failed cleanup would require manual Studio intervention.

## Success Criteria (Summary)

- Team Lead can send an invite, see it as pending, cancel it, and see a new member appear after acceptance
- Invitee can accept via either new-account or existing-account path and land on `/dashboard` as Member
- Expired, used, and invalid invite links render a clear error page
