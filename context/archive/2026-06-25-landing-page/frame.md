# Frame Brief: Landing page as sign-in gateway with auth redirect

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

`src/pages/index.astro` renders `Welcome.astro`, which displays "10x Astro Starter"
generic starter-template copy — wrong product name, feature bullets about the starter
kit ("Authentication Ready", "Modern Stack", "Developer Experience"), and no product
context. Authenticated users who land on `/` are not redirected.

## Initial Framing (preserved)

- **User's stated cause or approach**: not specified — "we need to decide what should be there"
- **User's proposed direction**: replace the starter content with something appropriate
- **Pre-dispatch narrowing**: Page purpose → sign-in gateway (not a product marketing page);
  auth redirect → authenticated users should go straight to `/dashboard`

## Dimension Map

The question has two independent sub-problems:

1. **Content** — what text/copy the page shows for unauthenticated guests
2. **Auth routing** — what happens when an already-authenticated user hits `/`
3. **Page structure** — whether the visual layout / card sections are appropriate for the chosen purpose
4. **Scope** — whether a full marketing landing page is needed or just a minimal gateway

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Content is wrong (starter copy, not product copy) | `src/components/Welcome.astro:33` — h1 says "10x Astro Starter"; feature cards describe the starter kit, not Daily Standup Tracker | STRONG |
| Auth redirect is missing | `src/middleware.ts:42–47` — only `/dashboard` and `/workspace` routes are guarded; `/` has no redirect for authenticated users | STRONG |
| Visual layout needs an overhaul | `Welcome.astro` has cosmic background (matches dashboard `bg-cosmic`), Sign In / Sign Up CTAs — structure is right; only content is wrong | NONE |
| A full marketing landing page is needed | User answered "sign-in gateway" — a full marketing page is out of scope | NONE |

## Narrowing Signals

- User confirmed: page purpose is sign-in gateway, not product marketing → feature cards and extended copy are out of scope.
- User confirmed: authenticated users should be redirected to `/dashboard` → middleware needs a new guard.
- Welcome.astro already has the right structural shell (cosmic theme, CTA buttons) — no redesign needed.
- Feature cards ("Authentication Ready", "Modern Stack", "Developer Experience") describe the starter template, not the product; they should be removed or replaced with at most a one-liner value prop.

## Cross-System Convention

All other protected pages redirect unauthenticated users away via `middleware.ts`. The
inverse — redirecting authenticated users away from public pages to their destination —
is the natural complement and follows the same `AUTH_REQUIRED_ROUTES` / `WORKSPACE_REQUIRED_ROUTES`
pattern already in `src/lib/routes.ts:2–7`. The auth redirect pattern is already in use;
this change extends it to cover the `/` case.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: two concrete gaps — the page shows wrong
> content (starter template instead of Daily Standup Tracker sign-in gateway), and
> authenticated users are not redirected to `/dashboard` when they land on `/`.

The initial framing ("decide what should be there") was an open question that the
pre-dispatch narrowing resolved: a sign-in gateway with an auth redirect. The scope
is smaller than it sounded — no design decisions remain, just content replacement and
one middleware rule.

## Confidence

- **HIGH** — both gaps confirmed by direct file reads; narrowing answers were decisive;
  no competing hypotheses survived investigation.

## What Changes for /10x-plan

Plan covers two changes:
1. Update `Welcome.astro` copy: replace "10x Astro Starter" heading and feature cards
   with Daily Standup Tracker product name, a one-liner value prop, and Sign In / Sign Up CTAs.
2. Add a middleware redirect in `src/middleware.ts`: if the user is authenticated and
   the pathname is `/`, redirect to `/dashboard`.

## References

- Source files:
  - `src/pages/index.astro:1–8`
  - `src/components/Welcome.astro:33–124`
  - `src/middleware.ts:42–47`
  - `src/lib/routes.ts:2–7`
- Related: `context/foundation/prd-v3.md` §Vision & Problem Statement (product one-liner)
