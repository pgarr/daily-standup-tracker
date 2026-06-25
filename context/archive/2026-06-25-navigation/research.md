---
date: 2026-06-25T18:37:44+02:00
researcher: Piotr Garlej
git_commit: d7c068fba4e681a569a35639e7fdd717b486bafc
branch: master
repository: 10xdev-dst
topic: "Shared navbar across all app pages"
tags: [research, navigation, navbar, layout, topbar, astro-layouts]
status: complete
last_updated: 2026-06-25
last_updated_by: Piotr Garlej
---

# Research: Shared navbar across all app pages

**Date**: 2026-06-25T18:37:44+02:00
**Researcher**: Piotr Garlej
**Git Commit**: d7c068fba4e681a569a35639e7fdd717b486bafc
**Branch**: master
**Repository**: 10xdev-dst

## Research Question

The navigation bar is only on the landing page. When the user is on the dashboard or members page, they can't navigate to other pages via a GUI. Should the navbar become a shareable component available on every page?

## Summary

`Topbar.astro` already contains the complete, auth-aware navigation logic (Dashboard link, Members link gated by `team_lead` role, Sign out) but is buried inside `Welcome.astro` and only renders on the landing page. Dashboard and Members pages each have ad-hoc inline headers with overlapping but inconsistent nav elements (dashboard has Sign out + Members link; members page has no navigation back to dashboard at all). The fix is to create a thin `AppLayout.astro` that wraps `Layout.astro` and adds `Topbar` — then switch dashboard and members pages to use it, removing the redundant navigation from their inline headers.

## Detailed Findings

### Topbar component

**File**: `src/components/Topbar.astro:1-45`

Already contains all the navigation the app needs:
- Authenticated: user email (left) + Dashboard link + Members link (team_lead only) + Sign out button (right)
- Unauthenticated: "Not signed in" (left) + Sign in + Sign up links (right)
- Reads `user` and `workspaceMember` from `Astro.locals` (set by middleware, available in every Astro component)
- Glassmorphic styling (`border-white/10 bg-white/5`) consistent with the cosmic design system

Currently used in **one place only**: `src/components/Welcome.astro:2,28` — the landing page hero.

### Layout.astro — the common base

**File**: `src/layouts/Layout.astro:1-50`

The root HTML shell used by every page. Accepts only `title?: string`. Renders error banners for missing env config, then a `<slot />`. No nav, no header — completely neutral. All pages already import and use this layout.

### Dashboard page — redundant inline nav

**File**: `src/pages/dashboard.astro:34-71`

The `<header>` block (lines 37–71) renders:
- Workspace name (gradient heading) — context info, keep
- Role badge (`Team Lead` / `Member`) — context info, keep
- User email — duplicates what Topbar already shows
- Sign out button (`form[method=POST action=/api/auth/signout]`) — duplicates Topbar
- Members link (team_lead only, lines 61–68) — duplicates Topbar

If Topbar is added globally, Sign out and Members link become redundant in this header. User email could also be dropped (Topbar shows it), leaving only workspace name + role badge as page-specific context.

### Members page — navigation dead end

**File**: `src/pages/workspace/members.astro:46-55`

The header section only shows workspace name and a subtitle ("Manage your workspace members"). There is **no navigation back to Dashboard, no Sign out button, no link anywhere** outside the page. A user who arrives here is stuck unless they use the browser's back button or type a URL manually.

### Auth pages — no nav needed

Auth pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/auth/accept-invite`) and workspace setup (`/workspace/setup`) use centered card layouts. These are intentional one-task flows; adding a persistent navbar would create noise and off-ramps at the wrong moment. These pages should keep using plain `Layout.astro`.

### middleware — Astro.locals guarantees

**File**: `src/middleware.ts` (sets `context.locals.user`, `context.locals.workspace`, `context.locals.workspaceMember`)

Since `Topbar` reads `Astro.locals` directly (not props), it works correctly in any Astro component tree without prop-drilling. The middleware runs before every request, so locals are always populated when a component renders.

### Welcome.astro — keep as-is

**File**: `src/components/Welcome.astro:1-57`

The landing page hero embeds `Topbar` at line 28 inside its own cosmic layout. This is intentional — the Topbar here floats inside the hero's star-field background. The landing page should stay unchanged; it's not broken.

## Code References

- `src/components/Topbar.astro:1-45` — the complete nav component; auth-aware, role-gated
- `src/components/Welcome.astro:2,28` — only current import/use of Topbar
- `src/layouts/Layout.astro:1-50` — root HTML shell, all pages use it
- `src/pages/dashboard.astro:37-71` — inline header with redundant sign-out and members link
- `src/pages/dashboard.astro:52-58` — sign-out form (duplicates Topbar)
- `src/pages/dashboard.astro:61-68` — Members link (team_lead, duplicates Topbar)
- `src/pages/workspace/members.astro:46-55` — dead-end header with no outbound navigation

## Architecture Insights

### Recommended approach: `AppLayout.astro`

Create `src/layouts/AppLayout.astro` — a thin wrapper that adds `Topbar` above the slot:

```astro
---
import Layout from "@/layouts/Layout.astro";
import Topbar from "@/components/Topbar.astro";

interface Props {
  title?: string;
}
const { title } = Astro.props;
---

<Layout title={title}>
  <div class="bg-cosmic min-h-screen">
    <div class="p-4 sm:p-6">
      <Topbar />
    </div>
    <slot />
  </div>
</Layout>
```

Then in `dashboard.astro` and `workspace/members.astro`:
- Replace `import Layout from "@/layouts/Layout.astro"` with `import AppLayout from "@/layouts/AppLayout.astro"`
- Replace `<Layout title="...">` with `<AppLayout title="...">`
- Remove the `bg-cosmic min-h-screen` wrapper div (moved into AppLayout)
- Remove the Sign out `<form>` and Members `<a>` from the dashboard's inline header (Topbar handles both)
- Optionally remove the user email `<p>` from dashboard header (Topbar shows it on the left)

Dashboard's inline `<header>` shrinks to: workspace name + role badge — purely context, not navigation.

**Why AppLayout over modifying Layout.astro:**
- `Layout.astro` stays a neutral HTML shell (single responsibility)
- Auth pages and setup continue using plain `Layout` with zero change
- As new app pages are added, they naturally reach for `AppLayout`
- Clear naming convention: `Layout` = HTML frame, `AppLayout` = authenticated app shell

### Edge case: `workspace/setup` with Topbar

On the workspace setup page, the user is authenticated but has no workspace yet, so `workspaceMember` is null. If `AppLayout` is used there, Topbar would show the Dashboard link. Clicking it triggers middleware to redirect back to `/workspace/setup` (workspace is required for dashboard). This is a loop — so `workspace/setup` should keep using plain `Layout.astro`, not `AppLayout`.

### Topbar Dashboard link on setup page is not a risk for dashboard/members

For the target pages (dashboard, members), the Dashboard link in Topbar is correct and expected.

## Historical Context (from prior changes)

- `context/archive/2026-06-25-landing-page/plan.md` — The Topbar was part of the landing page overhaul; it was made auth-aware and had the Members link added for team leads. The decision was made to keep it inside `Welcome.astro` as the landing page's navigation element, not as a global shell component.
- `context/archive/2026-06-05-member-invite-and-join/plan.md:466-605` — "Phase 4: Dashboard navigation" added the Members link to Topbar (commit 4b25a2e), establishing the role-gated nav pattern that already exists in the component.
- `context/archive/2026-06-05-standup-submission-and-history/plan.md` — Established the dashboard's inline header structure (workspace name, role badge, email, sign-out, members link) — the current source of the redundancy.

## Open Questions

1. **Topbar padding/spacing inside AppLayout** — The current Topbar has `mb-4` (margin-bottom). In `Welcome.astro` it sits inside `p-4 sm:p-8`. The AppLayout wrapper will need consistent padding so Topbar doesn't flush against the edge on mobile.
2. **Dashboard header simplification scope** — After removing Sign out and Members from the dashboard header, should user email also be removed (since Topbar shows it)? This simplifies but reduces at-a-glance context on the main page. Lean toward removing it (Topbar is prominent enough).
3. **`workspace/setup` exclusion** — Confirmed above it should stay on plain `Layout`. No nav needed on a setup wizard.
4. **Future pages** (team-feed-and-alerts, blocker-detection-flow) — They should use `AppLayout` from the start.
