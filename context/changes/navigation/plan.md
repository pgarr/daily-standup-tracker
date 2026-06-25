# Shared App Navigation Implementation Plan

## Overview

Create `AppLayout.astro` as the authenticated app shell (Layout + bg-cosmic + Topbar), then migrate `dashboard.astro` and `workspace/members.astro` to use it. `Topbar.astro` already has all the navigation logic — this change is purely structural wiring.

## Current State Analysis

`Topbar.astro` (`src/components/Topbar.astro:1-45`) provides auth-aware navigation: Dashboard link, role-gated Members link (team_lead only), and Sign out button. It currently only renders inside `Welcome.astro` (landing page hero).

All pages use `Layout.astro` (`src/layouts/Layout.astro:1-50`) — a neutral HTML shell with error banners and a `<slot />`. No navigation is present.

Dashboard (`src/pages/dashboard.astro:34-71`) has an inline header card with workspace name, role badge, user email, Sign out form, and Members link — the latter two duplicate Topbar.

Members (`src/pages/workspace/members.astro:46-55`) has only workspace name + subtitle header — no navigation out at all (dead end).

Auth pages and `workspace/setup.astro` stay on plain `Layout` (one-task flows; setup has an edge case where Topbar's Dashboard link would loop back to setup).

## Desired End State

A signed-in user can navigate between dashboard and members using the Topbar that appears on every app page. Sign out is reachable from any app page. The dashboard header no longer duplicates navigation. The members page is no longer a dead end.

### Key Discoveries:

- `Topbar.astro` reads `Astro.locals` directly — no prop drilling; works in any Astro component tree (`src/components/Topbar.astro:2`)
- Dashboard has a `<div class="mt-4 flex items-center justify-center gap-4">` container wrapping both the sign-out form and the Members link — this entire container is removed along with its two children (`src/pages/dashboard.astro:51-70`)
- Both target pages use `bg-cosmic min-h-screen` on their outer div — AppLayout takes this over; pages drop it

## What We're NOT Doing

- Not changing `src/pages/index.astro` or `src/components/Welcome.astro` (landing page keeps its embedded Topbar in the hero)
- Not changing auth pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/auth/accept-invite`)
- Not changing `src/pages/workspace/setup.astro` (no nav on setup wizard)
- Not modifying `Topbar.astro` itself (already complete)
- Not modifying `Layout.astro` (stays a neutral HTML shell)

## Implementation Approach

Three sequential phases: create the new AppLayout shell, then migrate each page. Each phase is independently lint/build verifiable with a manual check before proceeding. No DB, API, or auth changes.

---

## Phase 1: Create AppLayout.astro

### Overview

New Astro layout composing `Layout.astro` + `Topbar.astro` inside a `bg-cosmic min-h-screen` shell. All authenticated app pages will use this layout going forward.

### Changes Required:

#### 1. New layout file

**File**: `src/layouts/AppLayout.astro`

**Intent**: Establish the authenticated app shell. Owns the cosmic background, renders Topbar at the top, and exposes a slot for page content below.

**Contract**: Accepts `title?: string` (forwarded to `Layout`). Root element inside `<Layout>` is `div.bg-cosmic.min-h-screen`. Topbar renders inside a padded sub-div above the `<slot />`. Pages that use `AppLayout` must NOT carry their own `bg-cosmic min-h-screen` wrapper — that is now AppLayout's responsibility.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes with no errors on the new file
- `npm run build` succeeds (no TypeScript errors, no import resolution errors)

#### Manual Verification:

- No visible change on any page yet — AppLayout is created but not used by any page after Phase 1

---

## Phase 2: Migrate dashboard.astro to AppLayout

### Overview

Switch `dashboard.astro` to `AppLayout`, remove the outer cosmic wrapper (AppLayout owns it), and strip the redundant Sign out form and Members link from the inline header card. The header retains workspace name, role badge, and user email.

### Changes Required:

#### 1. Layout import and usage

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the `Layout` import with `AppLayout` and update the root element tags.

**Contract**: Line 2 — replace `import Layout from "@/layouts/Layout.astro"` with `import AppLayout from "@/layouts/AppLayout.astro"`. Lines 34 and end-of-file — replace `<Layout title="Dashboard">` / `</Layout>` with `<AppLayout title="Dashboard">` / `</AppLayout>`.

#### 2. Remove outer bg-cosmic wrapper

**File**: `src/pages/dashboard.astro`

**Intent**: The `bg-cosmic min-h-screen` part of the outer div (line 35) is now owned by AppLayout. Drop those classes, keeping only the content padding.

**Contract**: Change `<div class="bg-cosmic min-h-screen p-6">` → `<div class="p-6">`. Closing tag unchanged.

#### 3. Remove Sign out form from inline header

**File**: `src/pages/dashboard.astro`

**Intent**: The sign-out `<form>` (lines 52–58) duplicates the Sign out button now in Topbar. Remove it.

**Contract**: Delete the `<form method="POST" action="/api/auth/signout">` block (lines 52–59).

#### 4. Remove Members link from inline header

**File**: `src/pages/dashboard.astro`

**Intent**: The role-gated Members `<a>` (lines 60–68) duplicates the Members link now in Topbar. Remove it.

**Contract**: Delete the `{workspaceMember?.role === "team_lead" && (<a href="/workspace/members">...)}` block (lines 60–69).

#### 5. Remove now-empty flex container

**File**: `src/pages/dashboard.astro`

**Intent**: The `<div class="mt-4 flex items-center justify-center gap-4">` (line 51) only existed to house the sign-out form and Members link. Both are gone — delete the container too.

**Contract**: Delete line 51 (opening tag) and line 70 (closing `</div>` of that container).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Topbar appears at the top of `/dashboard` with cosmic styling
- Topbar shows user email (left) + Dashboard link + Members link (team_lead only) + Sign out (right)
- Dashboard inline header shows only: workspace name, role badge, "Signed in as [email]" — no sign-out button, no Members link
- Clicking Dashboard in Topbar navigates to `/dashboard`
- Clicking Members in Topbar (team_lead) navigates to `/workspace/members`
- Clicking Sign out in Topbar signs out and redirects to `/auth/signin`
- Auth pages (`/auth/signin`, `/auth/signup`) show no Topbar
- Landing page (`/`) is visually unchanged
- Topbar spacing looks correct at mobile viewport — no flush edge, consistent gap between Topbar and content below

---

## Phase 3: Migrate workspace/members.astro to AppLayout

### Overview

Switch `workspace/members.astro` to `AppLayout` and remove its outer cosmic wrapper. The members page header (workspace name + subtitle) stays unchanged — Topbar handles all navigation.

### Changes Required:

#### 1. Layout import and usage

**File**: `src/pages/workspace/members.astro`

**Intent**: Replace the `Layout` import with `AppLayout` and update the root element tags.

**Contract**: Line 2 — replace `import Layout from "@/layouts/Layout.astro"` with `import AppLayout from "@/layouts/AppLayout.astro"`. Line 46 and end-of-file — replace `<Layout title="Members">` / `</Layout>` with `<AppLayout title="Members">` / `</AppLayout>`.

#### 2. Remove outer bg-cosmic wrapper

**File**: `src/pages/workspace/members.astro`

**Intent**: The `bg-cosmic min-h-screen` on line 47 is now owned by AppLayout. Drop those classes.

**Contract**: Change `<div class="bg-cosmic min-h-screen p-4 md:p-8">` → `<div class="p-4 md:p-8">`. Closing tag unchanged.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Topbar appears on `/workspace/members` (consistent with dashboard)
- Clicking Dashboard in Topbar from members page navigates back to `/dashboard` (dead end resolved)
- Clicking Sign out from members page Topbar signs the user out
- Members page header still shows workspace name + "Manage your workspace members" subtitle (unchanged)
- `/workspace/setup` shows no Topbar (still uses plain `Layout`)

---

## Testing Strategy

### Unit Tests:

- No unit tests required — no new logic, only layout composition.

### Integration Tests:

- No existing E2E tests cover navigation flows; not in scope for this change.

### Manual Testing Steps:

1. Sign in as a team lead → verify Topbar on `/dashboard` shows Dashboard + Members + Sign out
2. Click Members in Topbar → verify `/workspace/members` loads with Topbar present
3. Click Dashboard in Topbar from members → verify `/dashboard` loads
4. Click Sign out from members page → verify redirect to `/auth/signin`
5. Sign in as a regular member → verify Members link absent from Topbar
6. Visit `/auth/signin`, `/auth/signup`, `/workspace/setup` → verify no Topbar on these pages
7. Visit `/` → verify landing page visually unchanged

## References

- Research: `context/changes/navigation/research.md`
- Topbar component: `src/components/Topbar.astro:1-45`
- Layout base: `src/layouts/Layout.astro:1-50`
- Dashboard inline header (pre-change): `src/pages/dashboard.astro:37-71`
- Members header: `src/pages/workspace/members.astro:46-55`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Create AppLayout.astro

#### Automated

- [x] 1.1 `npm run lint` passes with no errors on the new file
- [x] 1.2 `npm run build` succeeds (no TypeScript errors, no import resolution errors)

#### Manual

- [x] 1.3 No visible change on any page — AppLayout created but not yet used

### Phase 2: Migrate dashboard.astro to AppLayout

#### Automated

- [ ] 2.1 `npm run lint` passes
- [ ] 2.2 `npm run build` succeeds

#### Manual

- [ ] 2.3 Topbar appears at the top of `/dashboard` with cosmic styling
- [ ] 2.4 Topbar shows user email + Dashboard + Members (team_lead) + Sign out
- [ ] 2.5 Dashboard inline header shows workspace name, role badge, user email — no sign-out, no Members link
- [ ] 2.6 Clicking Dashboard in Topbar navigates to `/dashboard`
- [ ] 2.7 Clicking Members in Topbar (team_lead) navigates to `/workspace/members`
- [ ] 2.8 Clicking Sign out in Topbar signs out and redirects to `/auth/signin`
- [ ] 2.9 Auth pages (`/auth/signin`, `/auth/signup`) show no Topbar
- [ ] 2.10 Landing page (`/`) is visually unchanged
- [ ] 2.11 Topbar spacing correct at mobile viewport — no flush edge, consistent gap between Topbar and content

### Phase 3: Migrate workspace/members.astro to AppLayout

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 `npm run build` succeeds

#### Manual

- [ ] 3.3 Topbar appears on `/workspace/members`
- [ ] 3.4 Clicking Dashboard in Topbar from members page navigates to `/dashboard`
- [ ] 3.5 Sign out from members page works
- [ ] 3.6 Members page header unchanged (workspace name + subtitle)
- [ ] 3.7 `/workspace/setup` shows no Topbar
