# Entry Mutation Integrity Tests — Plan Brief

> Full plan: `context/changes/test-entry-mutation-integrity/plan.md`

## What & Why

S-06 shipped standup entry edit/delete. Three invariants from GitHub issue #11 (T-5) remain unproven by automated tests: that deleting an entry correctly reduces the streak-input array, that a confirmed blocker alert is not accidentally cascade-deleted with its entry, and that cross-user mutation is blocked at the Supabase RLS layer (not just the application layer).

## Starting Point

The HTTP-layer IDOR ownership guard (User B can't edit User A's entry via the API) was added as part of S-06's impl-review triage (F6) in `e2e/standup-edit-delete.spec.ts`. The `calculateStreak` math is unit-tested. No test covers the DB state after a delete, the `blocker_alerts` orphan contract, or direct-DB RLS enforcement.

## Desired End State

`npx playwright test entry-mutation-integrity` outputs 3 passed against a local Supabase + dev server, 3 skipped in CI. No new routes or UI changes. The three risks from #11 have automated regression coverage.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| IDOR scope | Reference existing HTTP test; add RLS-layer test only | HTTP IDOR already covered in standup-edit-delete.spec.ts (F6 triage) | Plan |
| RLS test location | Inside Playwright file (not Vitest) | One file, one test runner, shared fixture teardown | Plan |
| Streak verification | DB rows only (not HTML parsing) | `calculateStreak` unit tests cover the math; this spec covers the data layer | Plan |
| Alert fixture | Direct service client insert | Fast, deterministic, no S-04 confirmation flow dependency | Plan |
| Edit in streak test | Excluded | Editing never changes `submitted_date`; no streak effect is possible | Plan |

## Scope

**In scope:**
- `e2e/entry-mutation-integrity.spec.ts` — 3 serial Playwright tests
- Fixture: 2 users, 1 workspace, 3 standup entries (Mon/Tue/Wed), 1 confirmed blocker_alert

**Out of scope:**
- Dashboard HTML parsing for rendered streak number
- New API routes or UI changes
- Vitest integration tests
- UPDATE (edit) streak tests — edit cannot affect `submitted_date`
- Re-testing HTTP-layer IDOR (already in `standup-edit-delete.spec.ts`)

## Architecture / Approach

Single Playwright spec, `test.describe.serial`. Fixture creates member A (3 entries, 1 alert) and member B (for RLS test). Tests run in dependency order: test 1 deletes Wed entry, test 2 deletes Tue entry (verifying alert survives), test 3 uses `createUserClient(jwt)` to attempt direct-DB mutations as member B against member A's last remaining entry. `afterAll` deletes remaining entries and workspace (cascades alerts + member rows).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Playwright spec | 3-test serial spec proving streak, alert, and RLS invariants | `createUserClient` RLS test requires correct JWT acquisition via `createSignInClient().auth.signInWithPassword()` |

**Prerequisites:** S-06 shipped (done). Local Supabase for manual gate. CI uses skip pattern.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- `createSignInClient()` uses the anon key — confirming it supports `signInWithPassword` for test users (they're real auth users, so yes, but worth noting).
- The `UNIQUE (user_id, submitted_date)` constraint means re-running in the same local DB with the same user could collide — the timestamp-based email ensures a fresh user each run, so this is safe.

## Success Criteria (Summary)

- `npm run lint && npm run build` — clean.
- `npx playwright test entry-mutation-integrity` — 3 skipped (no Supabase) / 3 passed (with Supabase + dev server).
- No leftover fixture rows in the local DB after the run.
