# Landing Page — Plan Brief

> Full plan: `context/changes/landing-page/plan.md`
> Frame brief: `context/changes/landing-page/frame.md`

## What & Why

The root page (`/`) shows "10x Astro Starter" starter-template copy, and authenticated
users are not redirected to their workspace. The actual problem (from the frame):
two concrete gaps — wrong content on a gateway page, and a missing middleware rule.

## Starting Point

`Welcome.astro` has the correct visual shell (cosmic background, Topbar, CTA buttons)
but wrong copy and three irrelevant feature cards. `middleware.ts` guards `/dashboard`
and `/workspace` but has no rule for `/`.

## Desired End State

Guest visiting `/` sees "Daily Standup Tracker" as the heading, a one-line product
description, and Sign In / Sign Up CTAs — no feature cards. Authenticated user
navigating to `/` is immediately redirected to `/dashboard`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Page purpose | Sign-in gateway | Confirmed in frame — not a marketing page | Frame |
| Authenticated user on `/` | Redirect to `/dashboard` | Confirmed in frame — logged-in users go to their workspace | Frame |
| Feature cards | Remove entirely | Frame confirmed out of scope for a gateway | Frame |
| Value prop copy | Condense from PRD §Vision | Accurate, no extra input needed | Plan |
| New `routes.ts` constant | None | One-off root redirect doesn't warrant a named export | Plan |

## Scope

**In scope:**
- Update `Welcome.astro` heading and subtitle
- Remove feature cards grid from `Welcome.astro`
- Add one redirect guard in `middleware.ts`

**Out of scope:**
- Product marketing page (feature deep-dives, pricing)
- Visual redesign of any kind
- Changes to `src/pages/index.astro` or `src/lib/routes.ts`
- Feature cards (even product-relevant ones)

## Architecture / Approach

Two independent edits: copy surgery on `Welcome.astro` (text nodes + removing one
`<div>` subtree), and one guard inserted in `middleware.ts` before the existing
route-protection blocks. No new components, no DB changes, no API changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Update Welcome.astro | Correct product copy, no feature cards | None — purely cosmetic |
| 2. Add auth redirect | Authenticated users go to `/dashboard` | Middleware ordering — must fire before workspace guard |

**Prerequisites:** None — fully standalone.
**Estimated effort:** ~30 minutes, single session.

## Open Risks & Assumptions

- None. Frame was HIGH confidence; both changes are isolated and follow existing patterns.

## Success Criteria (Summary)

- Guest sees "Daily Standup Tracker" heading and correct tagline at `/`
- Authenticated user navigating to `/` lands on `/dashboard`
- Authenticated user with no workspace follows chain: `/` → `/dashboard` → `/workspace/setup`
