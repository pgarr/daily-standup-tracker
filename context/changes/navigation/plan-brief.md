# Shared App Navigation — Plan Brief

> Full plan: `context/changes/navigation/plan.md`
> Research: `context/changes/navigation/research.md`

## What & Why

Authenticated app pages (dashboard, members) have no shared navigation bar — the members page is a complete dead end, and the dashboard duplicates sign-out and nav links in its own inline header. `Topbar.astro` already implements the correct auth-aware, role-gated navigation; it just needs to be wired into a proper app shell layout.

## Starting Point

Every page uses `Layout.astro` — a neutral HTML shell with no nav. `Topbar.astro` exists and is complete but only renders inside `Welcome.astro` (the landing page hero). Dashboard has an ad-hoc inline header with redundant sign-out and Members link; members page has no outbound navigation at all.

## Desired End State

A signed-in user can navigate between dashboard and members, and sign out, from any app page via a persistent Topbar. The dashboard's inline header shows only workspace context (name, role badge, email — no nav elements). Auth pages and the workspace setup wizard remain clean one-task flows with no nav.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-----------------|--------|
| Approach | New `AppLayout.astro` wrapping `Layout` + `Topbar` | Keeps `Layout.astro` neutral; app pages opt into the shell explicitly | Research |
| AppLayout scope | Owns `bg-cosmic min-h-screen` shell | Removes bg repetition across pages; app pages are always cosmic | Plan |
| Dashboard header cleanup | Remove Sign out + Members link; keep workspace name, role badge, email | Topbar owns navigation; header retains workspace context | Plan |
| workspace/setup exclusion | Stays on plain `Layout` | Topbar's Dashboard link would loop back to setup (no workspace yet) | Research |
| Auth pages | Unchanged | One-task flows; nav would create off-ramps at wrong moment | Research |
| Landing page | Unchanged | `Welcome.astro` already embeds its own Topbar in the hero design | Research |

## Scope

**In scope:**
- Create `src/layouts/AppLayout.astro`
- Migrate `src/pages/dashboard.astro` to AppLayout
- Migrate `src/pages/workspace/members.astro` to AppLayout

**Out of scope:**
- Modifying `Topbar.astro` (already complete)
- Modifying `Layout.astro` (stays neutral)
- Auth pages, workspace setup, landing page
- E2E test coverage for nav flows

## Architecture / Approach

```
AppLayout.astro
└─ Layout.astro (HTML shell, error banners)
   └─ div.bg-cosmic.min-h-screen
      ├─ div.px-4.pt-4 → Topbar.astro (auth-aware nav)
      └─ slot (page content with its own padding)
```

`Topbar.astro` reads `Astro.locals` directly (set by middleware on every request) — no prop drilling needed. Pages switch from `Layout` to `AppLayout` and drop their outer `bg-cosmic min-h-screen` wrapper div.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Create AppLayout.astro | New app shell layout file (no pages use it yet) | None — isolated new file |
| 2. Migrate dashboard.astro | Topbar on dashboard, inline header simplified | Visual regression if padding/spacing looks off |
| 3. Migrate workspace/members.astro | Topbar on members, dead end resolved | Same spacing risk; members header must stay intact |

**Prerequisites:** None — all components exist, no DB or API changes.
**Estimated effort:** ~1 session; 3 small files touched.

## Open Risks & Assumptions

- Topbar's `mb-4` bottom margin + AppLayout's top padding need visual tuning — implementer should check spacing on mobile after Phase 2.
- Future app pages (team-feed, blocker-detection) should adopt `AppLayout` by default; this plan only covers existing pages.

## Success Criteria (Summary)

- A team lead can navigate dashboard ↔ members ↔ sign-out using only the Topbar
- The dashboard inline header shows no sign-out or Members link (redundancy eliminated)
- Auth pages and workspace setup show no Topbar (unchanged flows)
