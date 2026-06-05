---
date: 2026-06-05T00:00:00+00:00
researcher: Piotr Garlej
git_commit: a349025c75ee5a1f423062f953ba6a88ac91465c
branch: master
repository: daily-standup-tracker
topic: "Risk #1 — middleware auth/routing protection mechanics (Phase 1 test bootstrap)"
tags: [research, middleware, auth, routing, test-plan, phase-1]
status: complete
last_updated: 2026-06-05
last_updated_by: Piotr Garlej
---

# Research: Risk #1 — Middleware Auth/Routing Protection Mechanics

**Date**: 2026-06-05
**Researcher**: Piotr Garlej
**Git Commit**: a349025c75ee5a1f423062f953ba6a88ac91465c
**Branch**: master
**Repository**: daily-standup-tracker

## Research Question

How does the current middleware gate unauthenticated requests? Specifically:
1. How is the route protection list maintained and how is matching performed?
2. How does the middleware resolve the current user?
3. What happens when `createClient()` returns `null`?

*Scope: Risk #1 from test-plan.md §2 — "Unauthenticated user reaches a protected route — middleware regression or new route added without updating the gate."*

---

## Summary

The middleware uses **two separate prefix-based protection lists** (not a single `PROTECTED_ROUTES`). Route matching uses `.startsWith()`. The user is resolved via Supabase's `getUser()` call on a server client constructed from request cookies. When `createClient()` returns `null` (env vars missing), the user is set to `null` and the request continues — protected routes will still redirect because the null-user check fires. The route catalog has no unguarded gaps for the current feature set.

The key structural constraint for Phase 1 integration tests: **new routes under `/dashboard/*` or `/workspace/*` are automatically gated**; new routes with any other prefix must be manually added to `AUTH_REQUIRED_ROUTES`.

---

## Detailed Findings

### 1. Route Protection Lists

Two constants are defined at the top of the middleware ([`src/middleware.ts:5–9`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L5)):

```typescript
const AUTH_REQUIRED_ROUTES = ["/dashboard", "/workspace"];
const WORKSPACE_REQUIRED_ROUTES = ["/dashboard"];
const WORKSPACE_SETUP_REDIRECT = "/workspace/setup";
```

- **Matching strategy**: prefix-based `.startsWith()` ([`src/middleware.ts:47,50`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L47)).
- **`/workspace` exclusion from WORKSPACE_REQUIRED_ROUTES** is intentional and documented in a comment ([`src/middleware.ts:6–7`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L6)): `/workspace/setup` is the redirect target for no-workspace users, so adding it to the workspace-required list would create an infinite redirect loop.
- **Two-tier logic** ([`src/middleware.ts:47–52`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L47)):
  - `/dashboard`: requires auth + workspace → two possible redirects (→ `/auth/signin`, → `/workspace/setup`)
  - `/workspace`: requires auth only → one redirect (→ `/auth/signin`)
  - `else if` coupling means tier-1 check takes precedence; no double-checking.

**Maintenance risk**: any new top-level route prefix (e.g. `/team`, `/invites`, `/settings`) must be manually added to `AUTH_REQUIRED_ROUTES`. Sub-paths of existing prefixes (e.g. `/dashboard/anything`) are automatically covered by prefix matching — no code change required.

### 2. User Resolution Flow

Full sequence from request to `context.locals.user` ([`src/middleware.ts:12–24`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L12)):

```
Request
  │
  ├─ createClient(headers, cookies)  [src/lib/supabase.ts:7–26]
  │    ├─ checks SUPABASE_URL + SUPABASE_KEY (astro:env/server)
  │    ├─ if missing → return null
  │    └─ else → return SupabaseServerClient (cookie-based sessions via @supabase/ssr)
  │
  ├─ if supabase is null → context.locals.user = null; continue
  │
  └─ supabase.auth.getUser()
       ├─ returns { data: { user } }
       └─ context.locals.user = user ?? null
```

Cookie refresh: `setAll()` in the cookie handler ([`src/lib/supabase.ts:21`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/lib/supabase.ts#L21)) transparently writes refreshed session tokens back to the response during `getUser()`. This is invisible to the middleware caller.

Secondary locals (workspace resolution) only run for authenticated, non-`/api` requests ([`src/middleware.ts:28`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L28)):

```typescript
context.locals.workspace = null;       // line 23
context.locals.workspaceMember = null; // line 24
// workspace_member SELECT runs only if: supabase && user && !pathname.startsWith("/api")
```

**Implication for integration tests**: API routes under `/api/` have `context.locals.user` available but `context.locals.workspace` and `context.locals.workspaceMember` are always null — API routes must fetch workspace membership themselves if needed.

### 3. `createClient()` Null Return Path

[`src/lib/supabase.ts:8–10`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/lib/supabase.ts#L8):

```typescript
if (!SUPABASE_URL || !SUPABASE_KEY) return null;
```

When null is returned, the middleware's `if (supabase)` guard ([`src/middleware.ts:14`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L14)) skips `getUser()` and falls through to set `context.locals.user = null`. Protected routes will still redirect correctly because `!context.locals.user` is truthy. **No regression risk here for test environments** — as long as env vars are set, null is never returned.

One uncaught edge case: `createServerClient()` itself (called inside `createClient`) can theoretically throw — no `try/catch` exists in either function. Not a regression path for the protection gate itself, but relevant to test harness stability.

---

## Code References

- [`src/middleware.ts:5`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L5) — `AUTH_REQUIRED_ROUTES` definition
- [`src/middleware.ts:8`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L8) — `WORKSPACE_REQUIRED_ROUTES` definition
- [`src/middleware.ts:12–21`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L12) — user resolution block
- [`src/middleware.ts:28–44`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L28) — workspace member resolution (non-API authenticated requests)
- [`src/middleware.ts:47–52`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/middleware.ts#L47) — two-tier redirect logic
- [`src/lib/supabase.ts:7–26`](https://github.com/pgarr/daily-standup-tracker/blob/a349025c75ee5a1f423062f953ba6a88ac91465c/src/lib/supabase.ts#L7) — `createClient()` full implementation

---

## Route Catalog (full)

All routes under `src/pages/` as of commit `a349025`:

| URL path | File | Middleware protected? | Inline guard? | Notes |
|---|---|---|---|---|
| `/` | `index.astro` | No | No | Public landing page |
| `/auth/signin` | `auth/signin.astro` | No | No | Public |
| `/auth/signup` | `auth/signup.astro` | No | No | Public |
| `/auth/confirm-email` | `auth/confirm-email.astro` | No | No | Public |
| `/dashboard` | `dashboard.astro` | **Yes** (auth + workspace) | Yes (reads locals) | Full protection |
| `/workspace/setup` | `workspace/setup.astro` | **Yes** (auth only) | Yes (redirects to `/dashboard` if workspace exists) | Intentionally no workspace requirement |
| `POST /api/auth/signin` | `api/auth/signin.ts` | No | No | Public endpoint |
| `POST /api/auth/signup` | `api/auth/signup.ts` | No | No | Public endpoint |
| `POST /api/auth/signout` | `api/auth/signout.ts` | No | No | Public endpoint |
| `POST /api/workspace/create` | `api/workspace/create.ts` | No (middleware skips /api) | **Yes** (checks `locals.user` + `locals.workspaceMember`) | Inline guard; no prerender declaration |

**Prerender**: no API route declares `export const prerender = false` explicitly — correct under `output: "server"` (all routes are SSR by default).

**No unguarded gaps** found in the current route set. All routes serving user-specific data are protected either by middleware prefix or explicit inline guard.

---

## Architecture Insights

1. **Prefix-gate maintenance model**: the protection list is a small hardcoded array in a single file. New routes under existing prefixes are automatically covered; new top-level prefixes must be manually added. This is the exact failure mode Risk #1 names — easy to miss when adding a new feature area (e.g. `/team`, `/invites`).

2. **Two-tier redirect**: the workspace-required tier is strictly narrower than the auth-required tier. The `else if` coupling ensures no double-processing. Redirect targets are constants (`/auth/signin` hardcoded in two places at lines 48 and 51; `WORKSPACE_SETUP_REDIRECT` at line 9 used at line 49).

3. **API routes are partially blind**: the middleware intentionally skips workspace member resolution for `/api/*`. API routes that need workspace context must perform their own lookup. This is by design (avoid N+1 on every API call) but is a pattern developers must know.

4. **Cookie session transparency**: token refresh happens inside `createClient`'s cookie handler during `getUser()`. Tests that don't process Set-Cookie response headers will silently drop refreshed tokens — relevant for multi-request integration test sequences.

---

## Historical Context (from prior changes)

- [`context/archive/auth-and-workspace/plan.md`](../../archive/auth-and-workspace/plan.md) — Implemented the middleware and workspace setup flow. The `SECURITY DEFINER`/`VOLATILE` guard pattern (lessons.md) was hardened here.
- `context/foundation/lessons.md` — "Use client-generated UUIDs when INSERT caller cannot SELECT the created row" and "SECURITY DEFINER guard functions checking current state should be VOLATILE" — both relevant to Phase 2 (RLS tests) but not Phase 1.

---

## Open Questions

1. **New-route-gap detection**: the test plan's Risk Response Guidance asks for a test that catches *new routes added after this phase*. The current list is static — an integration test checking only the hardcoded routes will not catch a new `/team` prefix added later. Phase 1 planning must address how the test enforces coverage of future routes (e.g. filesystem-crawl test that asserts every `.astro`/`.ts` under `src/pages/` is either in `AUTH_REQUIRED_ROUTES` or explicitly marked public).

2. **Uncaught `createServerClient()` throw**: no `try/catch` around `createServerClient()` in `supabase.ts`. Low probability in practice, but worth noting in the plan as a harness stability consideration for test setup.

3. **Redirect URL hardcoded twice**: `/auth/signin` appears at middleware lines 48 and 51 (not a constant). If the signin route ever changes, both must be updated. Not a Phase 1 test concern but worth a note in the plan.
