# Auth and Workspace Creation Implementation Plan

## Overview

S-01 adds the workspace creation flow on top of the existing, fully-working auth implementation (sign-in, sign-up, sign-out, middleware, and auth UI are all complete from the starter). The remaining work is: loading workspace context in middleware, gating routes in three tiers, a `/workspace/setup` page with its API endpoint, and a dashboard that confirms the Team Lead role.

## Current State Analysis

Auth (FR-001, FR-002) is already implemented:
- `src/pages/auth/signin.astro`, `signup.astro`, `confirm-email.astro` — complete
- `src/components/auth/` — SignInForm, SignUpForm, FormField, SubmitButton, PasswordToggle, ServerError — complete
- `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts` — working; `signup.ts` lacks Zod validation
- `src/middleware.ts` — runs on every request, attaches `context.locals.user`, protects `/dashboard`
- `src/lib/supabase.ts` — SSR client factory using anon key (correct)
- `src/env.d.ts` — App.Locals declares `user: User | null` only

Workspace schema (FR-003 prerequisite) is ready from F-01:
- `supabase/migrations/20260604000000_workspace_member_schema.sql` — workspace + workspace_member tables, RLS policies, SECURITY DEFINER helpers
- `src/types.ts` — `Workspace`, `WorkspaceMember`, `UserRole` exported

Dashboard is a stub (`src/pages/dashboard.astro`) showing user email + sign-out button.

## Desired End State

A new user can register, confirm their email (prod) or proceed directly (dev), log in, fill in a workspace name on `/workspace/setup`, and land on `/dashboard` where their workspace name and Team Lead role are shown. The middleware enforces three-tier routing: unauthenticated → sign-in, authenticated-no-workspace → `/workspace/setup`, authenticated-with-workspace → dashboard. The S-01 GitHub issue (#2) is closed on impl-review completion.

### Key Discoveries

- Auth pages and components require zero changes — all FR-001/FR-002 work is done.
- `signin.ts` currently redirects to `/` on success; must change to `/dashboard` so the three-tier middleware funnel fires correctly after login.
- Workspace creation is non-atomic: if `workspace_member` INSERT fails after `workspace` INSERT, the orphaned workspace row must be deleted (compensating DELETE). This pattern is documented in the F-01 plan.
- Client-generated UUID is required (lesson from F-01): workspace SELECT RLS policy requires workspace_member to exist before the creator can read their own row, so `return=representation` on workspace INSERT would return RLS 42501. Pass the UUID as `id` on INSERT instead.
- `workspace_member` query in middleware must use `maybeSingle()` (not `single()`) to return `null` rather than an error when the user has no workspace row yet.
- `createClient()` returns `null` if env vars are not configured — middleware must guard against this.

## What We're NOT Doing

- No workspace editing or deletion — Team Lead settings (alert_threshold config) are S-05 scope.
- No member invitation flow — that is S-02.
- No multi-workspace support — one workspace per user in MVP.
- No social login or passwordless auth.
- No Zod validation on `signin.ts` — only `signup.ts` and the new `create.ts` endpoint.
- No changes to the email confirmation page or Supabase email templates.

## Implementation Approach

Three sequential phases. Phase 1 lays the foundation (context plumbing + routing gates) that Phase 2 and 3 depend on. Phase 2 adds the workspace setup flow (new page, form, API route). Phase 3 closes out with the dashboard update and signup.ts Zod validation.

## Critical Implementation Details

**Client-generated UUID**: `const workspaceId = crypto.randomUUID()` must be called server-side in `create.ts` before the INSERT, and the UUID passed as the `id` field. Do not use `select()` or `return=representation` on the workspace INSERT — the SELECT RLS policy would fail before the workspace_member row exists.

**Compensating DELETE**: after a failed `workspace_member` INSERT, `await supabase.from("workspace").delete().eq("id", workspaceId)` cleans up the orphaned row. Best-effort — log and continue even if the delete also fails.

**Middleware null guard**: `createClient()` returns `null` when env vars are absent. All supabase calls in middleware are conditional on `client` being non-null.

**maybeSingle()**: `supabase.from("workspace_member").select("*").eq("user_id", user.id).limit(1).maybeSingle()` returns `{ data: null, error: null }` when no row exists (correct). `.single()` would return an error — wrong.

---

## Phase 1: App.Locals extension and middleware workspace gating

### Overview

Extends `App.Locals` with `workspace` and `workspaceMember` fields and rewrites the middleware to load workspace context on every authenticated request and enforce three-tier routing.

### Changes Required

#### 1. Extend App.Locals type declarations

**File**: `src/env.d.ts`

**Intent**: Add `workspace` and `workspaceMember` to the Astro locals type so every page has typed access to the authenticated user's workspace context without extra fetches.

**Contract**: Extend the existing `App.Locals` interface with:
- `workspace: import("@/types").Workspace | null`
- `workspaceMember: import("@/types").WorkspaceMember | null`

#### 2. Rewrite middleware for workspace context and three-tier routing

**File**: `src/middleware.ts`

**Intent**: After resolving the current user (unchanged), query `workspace_member` for the authenticated user and load the linked `workspace` row. Attach both to `context.locals`. Then apply three-tier routing:
1. Route requires auth AND workspace (`WORKSPACE_REQUIRED_ROUTES`): unauthenticated → `/auth/signin`; authenticated but no workspace → `/workspace/setup`.
2. Route requires auth only (`AUTH_REQUIRED_ROUTES`): unauthenticated → `/auth/signin`.
3. All other routes: pass through.

**Contract**:
```typescript
const AUTH_REQUIRED_ROUTES = ["/dashboard", "/workspace"];
const WORKSPACE_REQUIRED_ROUTES = ["/dashboard"];
```
`/workspace` in `AUTH_REQUIRED_ROUTES` covers `/workspace/setup` (requires auth but not a workspace).
`/dashboard` in `WORKSPACE_REQUIRED_ROUTES` covers the workspace gate.

Workspace context loading runs only when `user` and `client` are both non-null. Use a single embedded select — `.select("*, workspace:workspace_id(*)")` with `maybeSingle()` — to fetch member and workspace in one round-trip. Then `context.locals.workspace = member?.workspace ?? null` and strip the nested field before assigning `context.locals.workspaceMember`. On error (network/RLS failure), defaults to `null` and lets routing gates handle the redirect naturally.

### Success Criteria

#### Automated Verification

- `npm run build` passes with no TypeScript errors
- `npm run lint` passes

#### Manual Verification

- Unauthenticated request to `/dashboard` redirects to `/auth/signin`
- Unauthenticated request to `/workspace/setup` redirects to `/auth/signin`
- Authenticated user with no workspace hitting `/dashboard` redirects to `/workspace/setup`
- Authenticated user with a workspace can access `/dashboard` without redirect

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Workspace setup page and API route

### Overview

Adds the `/workspace/setup` page with a React form component, the `POST /api/workspace/create` endpoint (with Zod, client-generated UUID, and compensating DELETE), and flips `signin.ts` redirect to `/dashboard` so the three-tier middleware funnel fires after login.

### Changes Required

#### 1. Workspace setup page

**File**: `src/pages/workspace/setup.astro`

**Intent**: Server-render the workspace setup screen for authenticated users who have no workspace yet. Redirect to `/dashboard` if `context.locals.workspaceMember` is already set (prevents re-setup). Pass an optional `?error=` query param to the form for server-side error display.

**Contract**: Reads `Astro.locals.workspaceMember` — if truthy, `return Astro.redirect("/dashboard")`. Otherwise renders `WorkspaceSetupForm` as a React island (`client:load`), passing the `error` query param.

#### 2. WorkspaceSetupForm React component

**File**: `src/components/workspace/WorkspaceSetupForm.tsx`

**Intent**: Client-side form component for the workspace setup screen. Follows the same patterns as `SignInForm.tsx` and `SignUpForm.tsx` in `src/components/auth/` — uses `FormField`, `SubmitButton`, `ServerError` from the same directory. POSTs to `/api/workspace/create`.

**Contract**: One field: `name` (text, required, max 100 chars). Client-side validation: empty name shows inline error before submit. Submits as `application/x-www-form-urlencoded` (FormData via `<form>`). Server errors surfaced via `ServerError` component. Pass a `<Building2 />` icon (lucide-react) to the name `FormField` — the `icon` prop is required, consistent with SignInForm and SignUpForm.

#### 3. Workspace creation API endpoint

**File**: `src/pages/api/workspace/create.ts`

**Intent**: Validates workspace name with Zod, generates a client-side UUID for the workspace row, inserts into `workspace` then `workspace_member` (team_lead), and applies a compensating DELETE on partial failure.

**Contract**: Exports `POST`. Accepts FormData with `name` field. Validates with Zod (`z.object({ name: z.string().min(1, "Name is required").max(100) })`). Requires authenticated user from `context.locals.user` (middleware guarantees this on `/workspace/*`). Non-atomic two-INSERT flow:

```typescript
const workspaceId = crypto.randomUUID();
// INSERT workspace with explicit id
// If error → redirect /workspace/setup?error=...
// INSERT workspace_member { workspace_id: workspaceId, user_id, role: "team_lead" }
// If error → DELETE workspace WHERE id = workspaceId, then redirect /workspace/setup?error=...
// Success → redirect /dashboard
```

#### 4. Fix signin.ts post-login redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Change the success redirect target from `/` to `/dashboard` so the three-tier middleware funnel (Phase 1) fires immediately after login and routes new users without a workspace to `/workspace/setup`.

**Contract**: Replace `return redirect("/")` on the success path with `return redirect("/dashboard")`. No other changes to this file.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Signing in with a valid account (no workspace) → redirects to `/workspace/setup`
- Signing in with a valid account (has workspace) → redirects to `/dashboard`
- `/workspace/setup` page renders the workspace name form
- Submitting empty name shows inline validation error (client-side, no round trip)
- Submitting a valid name creates `workspace` and `workspace_member` rows in Supabase (verify in Studio)
- `workspace_member.role` is `team_lead` for the new row
- After successful creation, user lands on `/dashboard`
- Refreshing `/workspace/setup` after workspace creation redirects to `/dashboard`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Dashboard update and signup.ts Zod validation

### Overview

Updates the dashboard stub to show workspace name and Team Lead role (confirming the full flow end-to-end) and adds Zod input validation to `signup.ts`.

### Changes Required

#### 1. Dashboard page — workspace confirmation view

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the current stub (email + sign-out only) with a view that surfaces the authenticated user's workspace name and role, confirming the full S-01 flow is working. Keeps the existing cosmic/glassmorphism styling.

**Contract**: Reads `Astro.locals.workspace` and `Astro.locals.workspaceMember` (both guaranteed non-null by middleware for authenticated+workspace users). Displays: workspace name, user role rendered as "Team Lead" (from `workspaceMember.role === "team_lead"`), user email, and sign-out button.

#### 2. Add Zod validation to signup.ts

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Validate `email` and `password` fields from FormData with Zod before calling `supabase.auth.signUp()`, consistent with the CLAUDE.md convention that API routes validate input with Zod.

**Contract**: `z.object({ email: z.string().email(), password: z.string().min(6, "Password must be at least 6 characters") })`. On parse failure, redirect to `/auth/signup?error=<first error message>`. On success, proceed to existing `supabase.auth.signUp()` call unchanged.

### Success Criteria

#### Automated Verification

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification

- Dashboard shows workspace name, "Team Lead" label, and user email for a fully set-up user
- Attempting signup with an invalid email address shows a validation error on the signup page
- Attempting signup with a password shorter than 6 characters shows a validation error
- Full E2E flow: register → (confirm email in prod / sign in in dev) → login → workspace setup → dashboard showing correct workspace name and Team Lead role

---

## Testing Strategy

### Manual Testing Steps

1. `npx supabase start` → `npx supabase db reset` (picks up the F-01 migration with Phase 1 index + VOLATILE fix)
2. Register a new user via `/auth/signup`
3. In dev: sign in immediately; in prod: click confirmation link then sign in
4. Verify redirect lands on `/workspace/setup` (no workspace yet)
5. Submit an empty workspace name — verify inline error
6. Submit a valid workspace name — verify redirect to `/dashboard`
7. Dashboard shows workspace name + Team Lead role
8. Sign out, sign in again — verify `/dashboard` is reached directly (no setup redirect)
9. Supabase Studio → confirm `workspace` and `workspace_member` rows exist with correct data
10. Attempt to navigate to `/workspace/setup` while logged in with workspace — verify redirect to `/dashboard`

## Migration Notes

No new Supabase migrations in this slice. All schema changes (workspace, workspace_member, RLS, SECURITY DEFINER helpers) landed in F-01.

## References

- F-01 plan (archived): `context/archive/2026-06-04-workspace-member-schema/plan.md`
- PRD: `context/foundation/prd-v2.md` — FR-001, FR-002, FR-003
- Roadmap: `context/foundation/roadmap.md` — S-01
- Lessons: `context/foundation/lessons.md` — client-generated UUID rule, VOLATILE guard rule, GitHub issue closure rule
- GitHub issue: #2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: App.Locals extension and middleware workspace gating

#### Automated

- [x] 1.1 npm run build passes with no TypeScript errors — 1ee08ac
- [x] 1.2 npm run lint passes — 1ee08ac

#### Manual

- [x] 1.3 Unauthenticated request to /dashboard redirects to /auth/signin — 1ee08ac
- [x] 1.4 Unauthenticated request to /workspace/setup redirects to /auth/signin — 1ee08ac
- [x] 1.5 Authenticated user with no workspace hitting /dashboard redirects to /workspace/setup — 1ee08ac
- [x] 1.6 Authenticated user with a workspace can access /dashboard without redirect — 1ee08ac

### Phase 2: Workspace setup page and API route

#### Automated

- [x] 2.1 npm run build passes — 8ee8a9f
- [x] 2.2 npm run lint passes — 8ee8a9f

#### Manual

- [x] 2.3 Signing in with no workspace redirects to /workspace/setup — 8ee8a9f
- [x] 2.4 Signing in with existing workspace redirects to /dashboard — 8ee8a9f
- [x] 2.5 /workspace/setup page renders the workspace name form — 8ee8a9f
- [x] 2.6 Submitting empty name shows inline validation error — 8ee8a9f
- [x] 2.7 Submitting valid name creates workspace and workspace_member rows in Supabase Studio — 8ee8a9f
- [x] 2.8 workspace_member.role is team_lead for the new row — 8ee8a9f
- [x] 2.9 After creation user lands on /dashboard — 8ee8a9f
- [x] 2.10 Navigating to /workspace/setup after workspace exists redirects to /dashboard — 8ee8a9f

### Phase 3: Dashboard update and signup.ts Zod validation

#### Automated

- [x] 3.1 npm run build passes — 9add356
- [x] 3.2 npm run lint passes — 9add356

#### Manual

- [x] 3.3 Dashboard shows workspace name, Team Lead label, and user email — 9add356
- [x] 3.4 Signup with invalid email shows validation error — 9add356
- [x] 3.5 Signup with short password shows validation error — 9add356
- [x] 3.6 Full E2E: register → login → workspace setup → dashboard with correct workspace name and Team Lead role — 9add356
