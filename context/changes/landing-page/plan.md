# Landing Page Implementation Plan

## Overview

Replace the "10x Astro Starter" placeholder copy on the root page (`/`) with Daily
Standup Tracker product content, and add a middleware rule that redirects authenticated
users from `/` straight to `/dashboard`.

## Current State Analysis

- `src/pages/index.astro` renders `<Welcome />` inside `<Layout>` — no logic, just
  composition.
- `src/components/Welcome.astro` has the correct visual shell (cosmic background,
  `Topbar`, cosmic orbs, star field) but wrong copy: h1 "10x Astro Starter", subtitle
  about the starter kit, and three feature cards ("Authentication Ready", "Modern
  Stack", "Developer Experience") that describe the template, not the product.
- `src/middleware.ts:42–47` guards `/dashboard` and `/workspace` routes but has no
  rule for `/`. An authenticated user who navigates to `/` sees the landing page
  instead of being redirected to their workspace.
- `src/lib/routes.ts` exports `AUTH_REQUIRED_ROUTES`, `WORKSPACE_REQUIRED_ROUTES`,
  and `WORKSPACE_SETUP_REDIRECT` as the single source of truth for middleware guards.

### Key Discoveries

- `Topbar.astro` already renders auth-aware nav (Sign in / Sign up for guests;
  Dashboard + Sign out for authenticated users). It is already included in
  `Welcome.astro:3`. No Topbar changes needed.
- The cosmic orbs and star-field background in `Welcome.astro:6–25` are pure visual
  chrome — leave intact.
- The hero section (div at line 31) and CTA buttons (Sign In / Sign Up) at lines
  41–53 stay; only the h1 text and subtitle `<p>` change.
- The feature cards grid (`Welcome.astro:57–124`) is removed in its entirety.
- The middleware redirect must come before the existing `WORKSPACE_REQUIRED_ROUTES` /
  `AUTH_REQUIRED_ROUTES` checks so it fires for authenticated users regardless of
  workspace state, letting downstream guards handle the workspace-less case if they
  land on `/dashboard`.

## Desired End State

Unauthenticated guest visiting `/` sees:
- h1: "Daily Standup Tracker"
- Subtitle: "A dedicated home for your daily standup log — track your streak, surface
  recurring blockers, and keep your team in sync."
- Sign In / Sign Up CTAs (unchanged)
- No feature cards section

Authenticated user visiting `/` is immediately redirected to `/dashboard`.

Verify by: `npm run build` succeeds, lint passes, and manual walkthrough of both
guest and authenticated user flows.

## What We're NOT Doing

- Not building a product marketing page (feature deep-dives, pricing, testimonials)
- Not redesigning the visual layout, color scheme, or Topbar
- Not restructuring `src/pages/index.astro` (it will continue to render `<Welcome />` with a title prop added)
- Not touching `src/lib/routes.ts` (the redirect is inline in middleware, not a
  new named constant, because it is a one-off for the root path)
- Not adding product feature cards (sign-in gateway purpose confirmed in frame)

## Implementation Approach

Two independent edits, neither depending on the other:
1. Copy surgery on `Welcome.astro` — touch only the text nodes and remove the cards grid.
2. One guard in `middleware.ts` inserted before the existing route checks.

## Phase 1: Update Welcome.astro

### Overview

Replace the wrong heading and subtitle text. Remove the feature cards section
entirely. All visual chrome (background, orbs, star field, Topbar, hero layout,
CTA buttons) stays unchanged.

### Changes Required

#### 1. Page title prop

**File**: `src/pages/index.astro`

**Intent**: Pass the product name as the `title` prop to `<Layout>` so the
browser tab and `<title>` element match the visible h1. `src/layouts/Layout.astro:10`
defaults to `"10x Astro Starter"` when no prop is provided; `index.astro` currently
passes none — the only page in the project that doesn't.

**Contract**: Change `<Layout>` to `<Layout title="Daily Standup Tracker">`.

#### 2. Heading and subtitle copy

**File**: `src/components/Welcome.astro`

**Intent**: Replace "10x Astro Starter" (line 33) with "Daily Standup Tracker" and
replace the starter-kit subtitle paragraph (lines 37–39) with the product one-liner
condensed from PRD §Vision.

**Contract**: The `<h1>` text becomes "Daily Standup Tracker". The subtitle `<p>`
becomes: "A dedicated home for your daily standup log — track your streak, surface
recurring blockers, and keep your team in sync."

#### 2. Remove feature cards section

**File**: `src/components/Welcome.astro`

**Intent**: Delete the feature cards grid (lines 57–124) that describes the starter
template. A sign-in gateway does not need feature marketing.

**Contract**: The closing `</div>` of the hero section (currently line 55) becomes
the last content element before the outer closing `</div>`. The feature cards `<div>`
and all three `<div>` card children are removed completely.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification

- Visit `/` as a guest: see "Daily Standup Tracker" heading, correct subtitle, Sign In
  / Sign Up buttons, cosmic background — no feature cards below the buttons
- Browser tab shows "Daily Standup Tracker" (not "10x Astro Starter")
- Page renders correctly on mobile viewport (375 px wide)

**Implementation Note**: After all automated verification passes, pause for manual
confirmation before proceeding to Phase 2.

---

## Phase 2: Add Auth Redirect in Middleware

### Overview

Add a single guard in `src/middleware.ts` that redirects authenticated users away from
`/` to `/dashboard`. Fires before the existing `WORKSPACE_REQUIRED_ROUTES` /
`AUTH_REQUIRED_ROUTES` checks so the workspace-less redirect is handled downstream
by the existing dashboard guard.

### Changes Required

#### 1. Root redirect for authenticated users

**File**: `src/middleware.ts`

**Intent**: If the user is authenticated and the requested path is exactly `/`, redirect
to `/dashboard`. This mirrors the inverse of the existing unauthenticated-redirect
pattern and requires no new constants in `routes.ts`.

**Contract**: Insert before the `if (WORKSPACE_REQUIRED_ROUTES…)` block (currently
line 42):

```typescript
if (context.locals.user && pathname === "/") {
  return context.redirect("/dashboard");
}
```

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification

- Sign in, then navigate to `/` in the browser address bar → confirm redirect to
  `/dashboard`
- Sign out, navigate to `/` → landing page appears (no redirect)
- Sign in as a user with no workspace yet, navigate to `/` → redirects to `/dashboard`
  → existing middleware then redirects to `/workspace/setup` (end-to-end workspace
  guard still works)

---

## Testing Strategy

### Manual Testing Steps

1. Guest flow: open `/` while logged out → correct product copy, no feature cards
2. Authenticated + workspace flow: log in → navigate to `/` → lands on `/dashboard`
3. Authenticated + no workspace flow: register a new user without workspace → navigate
   to `/` → chain `/` → `/dashboard` → `/workspace/setup`
4. Mobile: open `/` on a narrow viewport → layout still correct with no cards

## References

- Frame brief: `context/changes/landing-page/frame.md`
- PRD vision: `context/foundation/prd-v3.md` §Vision & Problem Statement
- Source files:
  - `src/components/Welcome.astro:31–124`
  - `src/middleware.ts:42–47`
  - `src/lib/routes.ts:2–7`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Update Welcome.astro

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — d97bd74
- [x] 1.2 Production build succeeds: `npm run build` — d97bd74

#### Manual

- [x] 1.3 Visit `/` as guest: correct heading, subtitle, CTAs, no feature cards — d97bd74
- [x] 1.4 Browser tab shows "Daily Standup Tracker" (not "10x Astro Starter") — d97bd74
- [x] 1.5 Page renders correctly on mobile viewport (375 px) — d97bd74

### Phase 2: Add Auth Redirect in Middleware

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — a20dea5
- [x] 2.2 Production build succeeds: `npm run build` — a20dea5

#### Manual

- [x] 2.3 Authenticated user navigating to `/` is redirected to `/dashboard` — a20dea5
- [x] 2.4 Unauthenticated user stays on `/` — a20dea5
- [x] 2.5 Authenticated user with no workspace: `/` → `/dashboard` → `/workspace/setup` — a20dea5
