# Member Invite and Join Implementation Plan

## Overview

S-02 adds the full member invite-and-join flow. A Team Lead sends email invites from a new `/workspace/members` page; invitees receive an email, click the link, register or sign in, and auto-join the workspace as Members. Email delivery uses the Resend API. No service role key — the entire flow runs on the anon key with a custom `workspace_invitation` table and targeted RLS policies.

## Current State Analysis

S-01 is complete. In place:
- `workspace` and `workspace_member` tables with RLS; `auth_user_is_team_lead()` and `auth_user_workspace_id()` SECURITY DEFINER helpers exist.
- Middleware loads workspace context and enforces three-tier routing (`AUTH_REQUIRED_ROUTES`, `WORKSPACE_REQUIRED_ROUTES`).
- `signup.ts` and `signin.ts` follow form POST → Zod → Supabase → redirect pattern.
- Route constants live in `src/lib/routes.ts` as the single source of truth.
- The F-01 migration explicitly reserves "S-02 will add a separate policy for Team Lead inserting invited members."

Missing: `workspace_invitation` table, invite creation and cancellation endpoints, accept-invite page and endpoint, `/workspace/members` page, Resend integration, and dashboard navigation for Team Leads.

## Desired End State

A Team Lead opens `/workspace/members`, fills in an email, and sends an invite. The invitee receives an email with a secure link. Clicking it opens `/auth/accept-invite?token=X`: new users see a signup form (email pre-filled, locked); existing users without a workspace see a sign-in form; existing users already in a workspace see an error. After authentication, the user sees a "Join Workspace" button and lands on `/dashboard` as a Member once clicked. Expired and already-used links show a clear error page. The Team Lead can also cancel pending invites and see who has joined.

### Key Discoveries

- No service role key configured (`src/lib/supabase.ts:6` comment). Must use custom invite token table — Supabase `inviteUserByEmail()` is off the table.
- F-01 migration leaves a placeholder in the workspace_member INSERT policy block for S-02's invited-member INSERT policy.
- `auth_user_is_team_lead()` is already a shared SECURITY DEFINER helper — the new Team Lead invite policies can reuse it directly.
- `signup.ts` returns `data.session` which is non-null in dev (auto-confirm) and null in prod. This distinction drives whether to redirect to accept-invite directly or via email confirmation.
- Middleware skips workspace context loading for `/api/*` routes — all API endpoints must guard `context.locals.user` themselves.
- `UNIQUE (user_id)` on `workspace_member` prevents joining a second workspace — an invitee who is already a member will get a DB constraint error, which the accept-invite endpoint must surface clearly.
- Fetching member emails: `workspace_member` does not store email. Use `workspace_invitation.email` (accepted rows) for member emails on the members page rather than altering the workspace_member schema.

## What We're NOT Doing

- No role promotion (Member → Team Lead) — MVP non-goal from PRD.
- No resend-invite action — Team Lead cancels the expired invite and creates a new one.
- No invite for existing members of another workspace — surfaced as an error at accept time.
- No multi-workspace support — enforced by `UNIQUE (user_id)` on `workspace_member`.
- No custom Resend email template — plain HTML body for MVP.
- No invitation rate limiting.

## Implementation Approach

Four sequential phases. Phase 1 lays the DB foundation (table + RLS). Phase 2 adds the Team Lead invite management surface (members page, invite/cancel API, Resend). Phase 3 builds the invitee-facing accept flow (page, endpoint, auth integration). Phase 4 wires navigation so the members page is discoverable.

## Critical Implementation Details

**Token lookup is pre-auth**: The `/auth/accept-invite` page must look up the invite before the user signs in. A SECURITY DEFINER function `get_invitation_by_token(p_token)` handles this without exposing all invites to anonymous queries. No direct RLS SELECT policy on `workspace_invitation` for anon users.

**workspace_member INSERT policy uses a VOLATILE guard**: `has_valid_invitation(ws_id, user_email)` checks live invite state in an RLS WITH CHECK clause. Per the `workspace_has_no_members` lesson, this must be declared VOLATILE — not STABLE — to prevent PostgreSQL caching the result across hypothetical multi-row inserts.

**Non-atomic accept flow**: INSERT into `workspace_member` runs first; UPDATE of `workspace_invitation.accepted_at` runs second. If the UPDATE fails, the member row exists but the invite is still "pending". The endpoint compensates: attempt cleanup DELETE on the workspace_member row if the UPDATE fails, log on cleanup failure.

**Dev vs. prod signup**: `supabase.auth.signUp()` returns `data.session` non-null in local dev (auto-confirm). The updated `signup.ts` checks `data.session` to decide: if non-null + invite_token present → redirect to accept endpoint; if null + invite_token present → redirect to confirm-email page (user receives confirmation email with `emailRedirectTo` pointing back to the accept-invite page).

---

## Phase 1: Database migration

### Overview

Creates `workspace_invitation` with lifecycle columns, RLS policies for Team Lead management and invited-user acceptance, two new SECURITY DEFINER helpers, and a new `workspace_member` INSERT policy for invited users.

### Changes Required

#### 1. Migration SQL file

**File**: `supabase/migrations/20260605000000_workspace_invitation.sql`

**Intent**: Define the invite table, all its RLS policies, the two new SECURITY DEFINER helpers, and the new workspace_member INSERT policy for invited users in a single atomic migration.

**Contract**: Full file — definitions in this order (helpers before policies that reference them):

```sql
-- workspace_invitation: invite token for a new member to join a workspace.
-- UNIQUE (workspace_id, email): one active invite per email per workspace.
-- Cancelling (DELETE) clears the constraint, allowing a fresh invite to the same email.
CREATE TABLE workspace_invitation (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  token        text        NOT NULL UNIQUE,
  role         text        NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at  timestamptz,
  UNIQUE (workspace_id, email)
);

ALTER TABLE workspace_invitation ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helpers --

-- Returns limited invite info by token; used by the pre-auth accept-invite page.
-- STABLE: read-only query; safe to cache within a transaction.
CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token text)
  RETURNS TABLE(
    invitation_id  uuid,
    workspace_id   uuid,
    workspace_name text,
    email          text,
    expires_at     timestamptz
  )
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT i.id, i.workspace_id, w.name, i.email, i.expires_at
  FROM workspace_invitation i
  JOIN workspace w ON w.id = i.workspace_id
  WHERE i.token = p_token
    AND i.accepted_at IS NULL
    AND i.expires_at > now();
$$;

-- Returns true if a valid pending invite exists for user_email in workspace ws_id.
-- Used as an RLS guard in the workspace_member INSERT policy for invited users.
-- VOLATILE: checks live row state (accepted_at, expires_at) — must not be cached.
CREATE OR REPLACE FUNCTION has_valid_invitation(ws_id uuid, user_email text)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path = public AS
$$
  SELECT EXISTS (
    SELECT 1 FROM workspace_invitation
    WHERE workspace_id = ws_id
      AND email = user_email
      AND accepted_at IS NULL
      AND expires_at > now()
  );
$$;

-- workspace_invitation RLS --

-- Team Lead can create invites for their workspace
CREATE POLICY "team lead can create invitation"
  ON workspace_invitation FOR INSERT TO authenticated
  WITH CHECK (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Team Lead can view all invitations for their workspace
CREATE POLICY "team lead can view invitations"
  ON workspace_invitation FOR SELECT TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Team Lead can cancel (delete) invitations for their workspace
CREATE POLICY "team lead can cancel invitation"
  ON workspace_invitation FOR DELETE TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Invited user (authenticated, email matches) can mark their invitation as accepted
CREATE POLICY "invited user can accept invitation"
  ON workspace_invitation FOR UPDATE TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    AND accepted_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (email = (auth.jwt() ->> 'email'));

-- workspace_member INSERT policy for invited users --

-- Invited authenticated user can join the workspace they were invited to.
-- Reuses has_valid_invitation() to check pending invite for their email.
CREATE POLICY "invited user can join workspace as member"
  ON workspace_member FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'member'
    AND has_valid_invitation(workspace_member.workspace_id, auth.jwt() ->> 'email')
  );
```

#### 2. TypeScript type for WorkspaceInvitation

**File**: `src/types.ts`

**Intent**: Add `WorkspaceInvitation` interface so Phase 2 and 3 code have typed invite rows without a DB types generation step.

**Contract**: Append to existing exports:
```typescript
export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  email: string;
  token: string;
  role: UserRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}
```

### Success Criteria

#### Automated Verification

- `npx supabase db reset` applies the new migration without errors
- `npm run build` passes (no TypeScript errors from new type)
- `npm run lint` passes

#### Manual Verification

- Supabase Studio → Table Editor shows `workspace_invitation` with correct columns, UNIQUE constraints, and DEFAULT values
- Studio → Auth → Policies shows 4 new policies on `workspace_invitation` and 1 new policy on `workspace_member`
- Team Lead authenticated user can INSERT into `workspace_invitation`; non-team-lead authenticated user cannot
- `get_invitation_by_token('nonexistent')` returns 0 rows; inserting a real token returns 1 row with workspace name
- `has_valid_invitation(ws_id, email)` returns true for a valid pending invite, false for expired or accepted

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Resend integration and invite management page

### Overview

Installs Resend, wires the env var, creates the `/workspace/members` page (Team Lead only), and adds the invite creation and cancellation API endpoints.

### Changes Required

#### 1. Install resend package

**File**: `package.json` (updated by `npm install resend`)

**Intent**: Add the Resend SDK as a dependency for transactional email. Run `npm install resend` before implementing Phase 2.

**Contract**: `resend` appears in `dependencies` with the installed version.

#### 2. Resend env var in Astro config

**File**: `astro.config.mjs`

**Intent**: Declare `RESEND_API_KEY` as an optional server secret in the Astro env schema so the app builds without it in dev and the type-safe `astro:env/server` import works in `src/lib/email.ts`.

**Contract**: Add to the existing `env.schema` object alongside `SUPABASE_URL` and `SUPABASE_KEY`:
```typescript
RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
```

#### 3. .env.example update

**File**: `.env.example`

**Intent**: Document the new Resend env var so future developers know to populate it.

**Contract**: Append `RESEND_API_KEY=` (empty value) to the existing entries.

#### 4. Email helper

**File**: `src/lib/email.ts` (new file)

**Intent**: Encapsulate Resend email sending behind a thin helper. If `RESEND_API_KEY` is absent (dev without Resend), logs the invite link to the console so the flow is testable without a real email account.

**Contract**: Export one function:
```typescript
async function sendInviteEmail(
  to: string,
  inviteLink: string,
  workspaceName: string
): Promise<{ error: string | null }>
```
- If `RESEND_API_KEY` is falsy: `console.info("[email] invite link for", to, ":", inviteLink)` and return `{ error: null }`.
- Otherwise instantiate `new Resend(RESEND_API_KEY)` and call `resend.emails.send({ from: "noreply@standuptracker.app", to, subject, html })`. Return `{ error: e.message }` on failure, `{ error: null }` on success.
- The `from` address must be a Resend-verified sender domain. For MVP, `noreply@standuptracker.app` is a placeholder — verify the domain in the Resend dashboard before production use.

#### 5. Route constants update

**File**: `src/lib/routes.ts`

**Intent**: Add `/workspace/members` to `WORKSPACE_REQUIRED_ROUTES` so the middleware enforces both auth and workspace presence before serving the page.

**Contract**: Extend the existing array:
```typescript
export const WORKSPACE_REQUIRED_ROUTES = ["/dashboard", "/workspace/members"];
```

#### 6. Workspace members page

**File**: `src/pages/workspace/members.astro`

**Intent**: Server-rendered page for the Team Lead to view workspace members, see pending/expired invites with cancel buttons, and send new invites. Redirects non-Team-Lead authenticated users to `/dashboard`.

**Contract**:
- Frontmatter: check `Astro.locals.workspaceMember?.role !== 'team_lead'` → `return Astro.redirect("/dashboard")`.
- Fetch accepted invitations: `supabase.from("workspace_invitation").select("*").eq("workspace_id", workspace.id).not("accepted_at", "is", null)` — these are the members (excluding the team_lead themselves).
- Fetch pending/expired invitations: `supabase.from("workspace_invitation").select("*").eq("workspace_id", workspace.id).is("accepted_at", null)` — split in the template: show "Pending" badge if `expires_at > now()`, "Expired" badge otherwise.
- Read `?success=` and `?error=` query params and display status feedback.
- Renders: team lead section (current user email + "Team Lead" badge), members section (accepted invite emails), invites section (pending/expired with cancel form per row), `<InviteForm />` React island (`client:load`).
- Cancel form per invite: `<form method="POST" action="/api/workspace/invite-cancel"><input type="hidden" name="id" value={invite.id} /><button>Cancel</button></form>`.

#### 7. InviteForm React component

**File**: `src/components/workspace/InviteForm.tsx`

**Intent**: Client-side form for creating a new invite. Follows the same conventions as `WorkspaceSetupForm.tsx` — uses `FormField`, `SubmitButton`, and `ServerError` from `src/components/auth/`.

**Contract**: One field: `email` (type `email`, required). POSTs to `/api/workspace/invite` as `application/x-www-form-urlencoded`. Displays `serverError` prop via `ServerError` component. Uses `<Mail />` from lucide-react as the icon prop on `FormField`. Client-side validation: empty or invalid email shows inline error before submit.

#### 8. Invite creation endpoint

**File**: `src/pages/api/workspace/invite.ts`

**Intent**: Validates the invite email, writes the `workspace_invitation` row, and dispatches the email via Resend (or logs in dev). Guards that the caller is a Team Lead.

**Contract**: Exports `POST`.
- Guard: `context.locals.user` required; redirect to `/auth/signin` otherwise.
- Workspace context: API routes skip middleware workspace loading — create the Supabase client, then query `supabase.from("workspace_member").select("*, workspace:workspace_id(*)").eq("user_id", user.id).maybeSingle()`. If `memberRow === null` or `memberRow.role !== 'team_lead'`, redirect to `/auth/signin`. Destructure `workspace` from `memberRow.workspace`.
- Zod: `z.object({ email: z.email("Enter a valid email address") })`.
- Token: `crypto.randomUUID()`.
- INSERT into `workspace_invitation`: `{ workspace_id: workspace.id, email, token, role: 'member' }` (expires_at defaults to 7 days in DB).
- On constraint violation ("already invited"): redirect `/workspace/members?error=<message>`.
- Send email: `const { error: emailError } = await sendInviteEmail(email, inviteLink, workspace.name)` where `inviteLink = \`${context.url.origin}/auth/accept-invite?token=${token}\``.
- On email failure: keep the invite row (do NOT delete it — the Team Lead may share the link manually) and redirect `/workspace/members?success=invite_created&email_warning=1`. The members page must surface this warning state with a message like "Invite created but email delivery failed — copy the link from the console or ask the invitee to request a re-invite."
- On email success: redirect `/workspace/members?success=invite_sent`.

#### 9. Invite cancellation endpoint

**File**: `src/pages/api/workspace/invite-cancel.ts`

**Intent**: Deletes a workspace_invitation row. RLS enforces the caller is the Team Lead of the invite's workspace; the endpoint adds a server-side Team Lead role check before hitting the DB.

**Contract**: Exports `POST`.
- Guard: `context.locals.user` required; redirect to `/auth/signin` otherwise.
- Workspace context: API routes skip middleware workspace loading — query `supabase.from("workspace_member").select("id, role").eq("user_id", user.id).maybeSingle()`. If null or `role !== 'team_lead'`, redirect to `/auth/signin`.
- Zod: `z.object({ id: z.string().uuid("Invalid invite ID") })`.
- DELETE from `workspace_invitation` where `id = result.data.id`. RLS silently filters non-owned rows; check `count === 0` to detect no-op and surface an error if needed.
- Success: redirect `/workspace/members?success=invite_cancelled`.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- `/workspace/members` redirects unauthenticated users to `/auth/signin`
- `/workspace/members` redirects authenticated Members (non-Team-Lead) to `/dashboard`
- Team Lead sees the members page with their own email in the Team Lead section
- Submitting an empty or invalid email shows a client-side validation error
- Submitting a valid email inserts a row in `workspace_invitation` (verify in Studio) and shows "invite sent" feedback
- In dev (no Resend key): invite link is printed to the server console
- With Resend key: invited user receives email with the correct link
- Cancel button deletes the invitation row from `workspace_invitation` (verify in Studio)
- Cancelling a non-owned invite (via direct form POST) silently does nothing (RLS blocks it)
- Attempting to invite the same email twice shows a duplicate error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Accept-invite flow

### Overview

Builds the invitee-facing side: the `/auth/accept-invite` page that handles all states (invalid token, unauthenticated, authenticated+match, wrong account, already in workspace), the `POST /api/workspace/accept-invite` endpoint that executes the join, and updates to `signup.ts` and `signin.ts` to thread the invite token through the auth flow.

### Changes Required

#### 0. Extend FormField with readOnly prop

**File**: `src/components/auth/FormField.tsx`

**Intent**: Enable read-only input fields for the accept-invite email display. `FormField` currently has no `readOnly` or `disabled` prop — without this change `AcceptInviteForm` cannot lock the pre-filled email field.

**Contract**: Add `readOnly?: boolean` to `FormFieldProps` and forward it to the `<input>` element: `<input ... readOnly={readOnly} />`. No caller (SignInForm, SignUpForm) passes `readOnly`, so existing behaviour is unchanged.

#### 1. Accept-invite page

**File**: `src/pages/auth/accept-invite.astro`

**Intent**: Server-rendered public page that validates the invite token and presents the appropriate UI for each state. No route protection needed (unauthenticated users must be able to reach it).

**Contract**: Frontmatter:
1. Read `token` query param. If missing: render "Invalid invite link" error (no token to look up).
2. Call `supabase.rpc('get_invitation_by_token', { p_token: token }).maybeSingle()`. If `data === null`: render "This invite link has expired or has already been used" error with "Contact your Team Lead to request a new invite" copy.
3. If user is authenticated (`Astro.locals.user`):
   - Email matches invite AND user has no workspace: redirect to `POST /api/workspace/accept-invite` via a form auto-submit, or render a page with a "Join [workspaceName]" form button that POSTs to `/api/workspace/accept-invite` with hidden `token` field.
   - Email matches AND user already has workspace: render "You are already a member of a workspace" error.
   - Email does not match: render "This invite was sent to [inviteEmail]. Sign out first if you want to accept it with a different account" with a sign-out link.
4. If user is not authenticated: render `<AcceptInviteForm />` React island (`client:load`), passing `workspaceName`, `inviteEmail`, and `token` as props.

#### 2. AcceptInviteForm React component

**File**: `src/components/auth/AcceptInviteForm.tsx`

**Intent**: Two-tab form (Create account / Sign in) for the invite acceptance page. Email field is pre-filled from the invite and read-only in both tabs. Follows the auth form conventions (`FormField`, `SubmitButton`, `ServerError`).

**Contract**: Props: `workspaceName: string`, `inviteEmail: string`, `token: string`, `serverError?: string`.
- "Create account" tab: fields `email` (pre-filled from `inviteEmail`, `readOnly={true}` via Change 0's new prop), `password`; hidden `invite_token` field; POSTs to `/api/auth/signup`.
- "Sign in" tab: fields `email` (pre-filled, `readOnly={true}`), `password`; hidden `invite_token` field; POSTs to `/api/auth/signin`.
- Default tab: "Create account". Tab switching is local React state.
- `serverError` prop renders via `ServerError` component (shared with auth forms).

#### 3. Accept-invite API endpoint

**File**: `src/pages/api/workspace/accept-invite.ts`

**Intent**: Authenticated endpoint that validates the token against the calling user's email, inserts the user into `workspace_member`, and marks the invite as accepted. Non-atomic — compensates by attempting a cleanup DELETE on `workspace_member` if the UPDATE fails.

**Contract**: Exports `POST`.
- Guard: `context.locals.user` required; redirect to `/auth/signin` otherwise.
- Existing workspace check: API routes skip middleware workspace loading — query `supabase.from("workspace_member").select("id").eq("user_id", user.id).maybeSingle()`. If non-null (user already in a workspace), redirect to `/auth/accept-invite?token=${token}&error=already_in_workspace`.
- Zod: `z.object({ token: z.string().min(1) })` on FormData.
- Look up invite: `supabase.rpc('get_invitation_by_token', { p_token: token }).maybeSingle()`. If null: redirect `/auth/accept-invite?token=${token}&error=invite_invalid`.
- Email check: `invite.email !== context.locals.user.email` → redirect `/auth/accept-invite?token=${token}&error=email_mismatch`.
- INSERT into `workspace_member`: `{ workspace_id: invite.workspace_id, user_id: user.id, role: 'member' }`. RLS (`has_valid_invitation`) gates this insert. On error: redirect `/auth/accept-invite?token=${token}&error=${encodeURIComponent(error.message)}`.
- UPDATE `workspace_invitation` SET `accepted_at = new Date().toISOString()` WHERE `token = token`. On error: compensating DELETE on workspace_member row (best-effort; log on failure). Redirect `/auth/accept-invite?token=${token}&error=accept_failed`.
- Success: redirect `/dashboard`.

#### 4. Update signup.ts for invite flow

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Thread the invite token through the signup flow so that (a) in dev with auto-confirm, the user is redirected directly to the accept endpoint, and (b) in prod, the Supabase confirmation email brings the user back to the accept-invite page after confirming.

**Contract**: Read optional `invite_token` from FormData (unchecked raw read after the existing Zod parse — it's optional and used only for redirect routing). Capture `data` from `signUp()`:
```typescript
const inviteToken = form.get("invite_token") as string | null;
const { data, error } = await supabase.auth.signUp({
  email, password,
  options: inviteToken
    ? { emailRedirectTo: `${context.url.origin}/auth/accept-invite?token=${encodeURIComponent(inviteToken)}` }
    : undefined,
});
if (error) { /* existing redirect */ }
// data.session is non-null in dev (auto-confirm); null in prod (email confirmation pending).
// In both paths, redirect to the accept-invite PAGE (not the API endpoint) — the page
// detects authenticated state and shows the "Join Workspace" button for the final POST.
if (data.session && inviteToken) {
  return context.redirect(`/auth/accept-invite?token=${encodeURIComponent(inviteToken)}`);
}
if (inviteToken) {
  return context.redirect(`/auth/confirm-email?invite_token=${encodeURIComponent(inviteToken)}`);
}
return context.redirect("/auth/confirm-email");
```

#### 5. Update signin.ts for invite flow

**File**: `src/pages/api/auth/signin.ts`

**Intent**: If an `invite_token` is present in the signin form, redirect to the accept-invite page after successful sign-in instead of to the dashboard.

**Contract**: Read optional `invite_token` from FormData (raw read, after existing form parse). On successful sign-in: `if (inviteToken) return context.redirect(\`/auth/accept-invite?token=${encodeURIComponent(inviteToken)}\`); return context.redirect("/dashboard");`.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Navigating to `/auth/accept-invite?token=invalid` renders the "expired or already used" error page
- Navigating to `/auth/accept-invite` (no token) renders the "Invalid invite link" error
- Navigating to the correct invite link while unauthenticated renders the AcceptInviteForm with email pre-filled and the workspace name shown
- New user flow: fill in password on "Create account" tab → signup → (dev) redirected to accept-invite page → "Join Workspace" button visible → click → redirected to `/dashboard` with Member role (verify in Studio: `workspace_member` row exists with `role = 'member'`, `workspace_invitation.accepted_at` is non-null)
- Existing user flow (no workspace): "Sign in" tab → sign in with existing account matching invite email → redirected to accept-invite page → "Join Workspace" button → `/dashboard` as Member
- Wrong account: sign in with an email that does NOT match the invite → "This invite was sent to [email]" error
- Already in workspace: accept invite while authenticated with an account already in a workspace → "already a member" error
- Expired token (simulate by updating `expires_at` to past in Studio): renders expired error page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 4.

---

## Phase 4: Dashboard navigation

### Overview

Adds a Members navigation link visible only to Team Leads so the `/workspace/members` page is discoverable without typing the URL.

### Changes Required

#### 1. Topbar navigation update

**File**: `src/components/Topbar.astro`

**Intent**: Add a "Members" link to the Topbar that renders only when the current user is a Team Lead. Keeps the navigation consistent with the dashboard and avoids exposing the members page link to regular Members.

**Contract**: Read `workspaceMember?.role` from `Astro.props` or from `Astro.locals` (depending on how Topbar currently receives context). Add a conditional anchor:
```astro
{Astro.locals.workspaceMember?.role === 'team_lead' && (
  <a href="/workspace/members">Members</a>
)}
```
Style consistently with existing nav items in the Topbar. If Topbar does not currently accept or read `Astro.locals` directly, pass `workspaceMember` as a prop from the parent page that renders Topbar (read the current Topbar implementation first).

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Team Lead sees a "Members" link in the Topbar that navigates to `/workspace/members`
- Member (non-Team-Lead) does NOT see the "Members" link in the Topbar
- Navigating to `/workspace/members` as Team Lead from the Topbar link works correctly

---

## Testing Strategy

### Manual Testing Steps

1. `npx supabase start` → `npx supabase db reset` — confirm new migration applies cleanly
2. Register a Team Lead via `/auth/signup` → workspace setup → dashboard
3. Open `/workspace/members` — confirm page loads, Team Lead section shows correct email
4. Invite a new email address — verify Studio shows `workspace_invitation` row, invite link logged to console (dev)
5. Open the invite link in a new incognito window — confirm AcceptInviteForm renders with pre-filled email and workspace name
6. Complete signup with a new password → "Join Workspace" button appears → click → `/dashboard` with correct Member role
7. Verify in Studio: `workspace_member` row for new user, `workspace_invitation.accepted_at` is non-null
8. Back in Team Lead window: refresh `/workspace/members` — new member appears in the accepted list, pending invite is gone
9. Cancel a pending invite → row deleted from Studio, page shows updated invite list
10. Attempt to invite the same email again after cancellation — should succeed (unique constraint lifted by DELETE)
11. Try to invite the same email twice without cancelling — expect duplicate error
12. Click an already-accepted invite link — expect "expired or already used" error page
13. Click the invite link while signed in as the wrong account — expect "wrong account" error

### Performance Considerations

No new hot-path queries. The `workspace_invitation` table will have at most a handful of rows per workspace in MVP. No indexing changes required beyond the schema's default PK and UNIQUE constraints.

### Migration Notes

Second migration for this project: `supabase/migrations/20260605000000_workspace_invitation.sql`. The `auth_user_is_team_lead()` helper defined in F-01 is reused directly in the new policies — no redefinition needed.

## References

- F-01 plan (archived): `context/archive/2026-06-04-workspace-member-schema/plan.md`
- S-01 plan (archived): `context/archive/2026-06-04-auth-and-workspace/plan.md`
- PRD: `context/foundation/prd-v3.md` — FR-004, FR-005
- Roadmap: `context/foundation/roadmap.md` — S-02
- Lessons: `context/foundation/lessons.md` — client-generated UUID rule, VOLATILE guard rule

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database migration

#### Automated

- [x] 1.1 npx supabase db reset applies migration without errors
- [x] 1.2 npm run build passes
- [x] 1.3 npm run lint passes

#### Manual

- [ ] 1.4 workspace_invitation table exists in Studio with correct columns, constraints, and defaults
- [ ] 1.5 4 new RLS policies on workspace_invitation and 1 new policy on workspace_member visible in Studio
- [ ] 1.6 Team Lead can INSERT into workspace_invitation; non-team-lead cannot
- [ ] 1.7 get_invitation_by_token returns correct row for valid token; empty for invalid or expired
- [ ] 1.8 has_valid_invitation returns true for valid pending invite; false for expired or accepted

### Phase 2: Resend integration and invite management page

#### Automated

- [ ] 2.1 npm run build passes
- [ ] 2.2 npm run lint passes

#### Manual

- [ ] 2.3 /workspace/members redirects unauthenticated users to /auth/signin
- [ ] 2.4 /workspace/members redirects Members to /dashboard
- [ ] 2.5 Team Lead sees members page with correct Team Lead section
- [ ] 2.6 Submitting invalid email shows client-side validation error
- [ ] 2.7 Submitting valid email inserts workspace_invitation row and shows invite_sent feedback
- [ ] 2.8 Without RESEND_API_KEY invite link is logged to console
- [ ] 2.9 Cancel button deletes invitation row from Studio
- [ ] 2.10 Inviting the same email twice (without cancel) shows duplicate error

### Phase 3: Accept-invite flow

#### Automated

- [ ] 3.0 FormField readOnly prop added, npm run build passes with no TypeScript errors
- [ ] 3.1 npm run build passes
- [ ] 3.2 npm run lint passes

#### Manual

- [ ] 3.3 Invalid token renders expired/used error page
- [ ] 3.4 Missing token renders invalid invite link error
- [ ] 3.5 Valid token unauthenticated renders AcceptInviteForm with pre-filled email and workspace name
- [ ] 3.6 New user signup flow: signup → accept-invite page → Join Workspace → /dashboard as Member
- [ ] 3.7 workspace_member row and workspace_invitation.accepted_at verified in Studio after join
- [ ] 3.8 Existing user signin flow: signin → accept-invite page → Join Workspace → /dashboard as Member
- [ ] 3.9 Wrong account renders mismatch error
- [ ] 3.10 User already in workspace renders already-member error
- [ ] 3.11 Already-accepted invite link renders expired/used error

### Phase 4: Dashboard navigation

#### Automated

- [ ] 4.1 npm run build passes
- [ ] 4.2 npm run lint passes

#### Manual

- [ ] 4.3 Team Lead sees Members link in Topbar navigating to /workspace/members
- [ ] 4.4 Member does not see Members link in Topbar
