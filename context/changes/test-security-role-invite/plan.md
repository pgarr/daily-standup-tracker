# Test Security: Role Gate + Invite Token Plan

## Overview

T-4 adds integration tests that prove two security guarantees delivered across S-02 and S-05:

1. **Role gating** — a Member-role authenticated session requesting `/team-feed` is redirected to `/dashboard`; a Team Lead session reaches `/team-feed` with HTTP 200.
2. **Invite token security** — a consumed token (replay attack), a token accepted by the wrong user (email-binding attack), and an expired token are all rejected by `accept_invitation()` with a deterministic error message.

The tests exercise two layers: the Astro SSR role check at `team-feed.astro:13-14` (Playwright HTTP-level) and the `accept_invitation()` SECURITY DEFINER function (Vitest + Supabase RPC).

## Current State Analysis

**Role gating**: enforced at `src/pages/team-feed.astro:13-14` — `if (workspaceMember?.role !== "team_lead") return Astro.redirect("/dashboard")`. Middleware populates `context.locals.workspaceMember` from a DB query. No integration test verifies that a member-role authenticated session is actually redirected.

**Invite token security**: enforced in `supabase/migrations/20260605000001_accept_invitation_function.sql`. The function uses a single atomic SELECT WITH FOR UPDATE that filters on `email = (auth.jwt() ->> 'email') AND accepted_at IS NULL AND expires_at > now()`. Any gate failure → `RAISE EXCEPTION 'invalid or expired invitation'`. The error text is intentionally identical for all three failure modes (no information leakage). No test currently exercises this gate.

**Test infrastructure already in place**:
- `src/__tests__/helpers/supabase-test.ts`: `isSupabaseRunning()`, `createServiceClient()`, `createUserClient(token)`, `createSignInClient()`
- `src/__tests__/standup-data-isolation.test.ts`: established pattern — one `describe.skipIf(!supabaseAvailable)`, `beforeAll` sets up users + workspace via service client, `afterAll` deletes them, tests use `createUserClient(token)` for assertions
- `e2e/middleware-gate.spec.ts`: Playwright API-only project, `maxRedirects: 0`, asserts HTTP 302 + Location header for unauthenticated routes
- `playwright.config.ts`: `webServer` starts `npm run dev`; `reuseExistingServer: !process.env.CI`; no SUPABASE_* vars (intentional for existing redirect tests). In local dev `reuseExistingServer: true` picks up the developer's already-running `npm run dev` (which has Supabase vars via `.env`).

**Key constraint**: `workspace_invitation` has `UNIQUE(workspace_id, email)` — one active invite per email per workspace. Each test user that receives an invite must use a unique email. The service client bypasses RLS for fixture setup.

## Desired End State

- `npm test` includes passing invite-token security tests (or prints one skip line if local Supabase isn't running)
- `npx playwright test` includes passing role-gating tests (or prints one skip line if fixtures file is absent or Supabase isn't running)
- Both test files follow the established patterns exactly — no new abstractions or test helpers

## What We're NOT Doing

- No testing of the Team Lead's ability to **view** member standup entries via `/team-feed` (UI/data test, not a security gate test; out of T-4 scope)
- No testing of invite email delivery (untested by design; Supabase handles SMTP)
- No testing of the workspace creation flow (`/workspace/setup`) — separate concern
- No CI integration of Playwright role-gating tests — these require local Supabase; CI runs lint + build only (per `.github/workflows/ci.yml`)
- No changes to existing `middleware-gate.spec.ts` or `standup-data-isolation.test.ts`

## Implementation Approach

Two sequential phases. Phase 1 adds the Vitest invite-token tests (self-contained, no config changes). Phase 2 adds the Playwright globalSetup, globalTeardown, and role-gating spec (requires `playwright.config.ts` update and `.gitignore` entry for `.auth/`).

## Critical Implementation Details

**UNIQUE(workspace_id, email) constraint**: one workspace, three distinct test users = three distinct email addresses = no conflicts. User-a (replay user) gets their token consumed in `beforeAll`; the replay test then proves the second call is rejected. User-b-target holds an invite that user-c-attacker tries to steal (wrong-email test). User-c also holds an expired invite (separate token, separate invite row).

**RPC error shape**: `supabase.rpc('accept_invitation', {p_token})` returns `{ data, error }`. A RAISE EXCEPTION in the function produces `error.message = "invalid or expired invitation"` (PostgreSQL error code P0001). Assertions use `expect(error?.message).toContain('invalid or expired invitation')`.

**Playwright authentication flow**: `request.newContext()` creates an isolated cookie jar per role. Posting to `/api/auth/signin` with `form: { email, password }` causes the server to call Supabase `signInWithPassword`, set session cookies on the response, and redirect to `/dashboard`. Playwright follows the redirect, retaining the cookies. Subsequent requests from that context carry the session. This requires the dev server to have Supabase configured — satisfied in local dev by `reuseExistingServer: true` picking up the developer's running `npm run dev`.

**globalSetup skip**: when `isSupabaseRunning()` returns false, `global-setup.ts` returns early without writing `.auth/test-fixtures.json`. The spec checks `existsSync('.auth/test-fixtures.json')` and skips via `test.describe.configure({ mode: 'skip' })` if missing, mirroring the `describe.skipIf` pattern from Vitest.

**`.auth/` gitignore**: the fixtures file contains user IDs and plaintext test passwords. It must be gitignored.

---

## Phase 1: Vitest invite-token security tests

### Overview

Creates `src/__tests__/invite-token-security.test.ts`. One `describe.skipIf(!supabaseAvailable)` block, one `beforeAll`/`afterAll` pair, and four `it` tests. Follows `standup-data-isolation.test.ts` exactly. Tests: positive acceptance (proves the happy path works and validates the anchor for the failure tests), token replay rejection, wrong-email binding rejection, expired token rejection.

### Changes Required

#### 1. Invite token security test file

**File**: `src/__tests__/invite-token-security.test.ts`

**Intent**: Prove all three failure modes of `accept_invitation()` in isolation. One `beforeAll` creates the workspace, three users, three invite rows, and runs one successful acceptance (user-a accepts the replay token). Tests then assert the three security rejections. One `afterAll` deletes all fixtures.

**Fixture layout**:

| Variable | Role | Invite token | Notes |
|---|---|---|---|
| `userA` | replay victim (accepts first, then replays) | `REPLAY_TOKEN` | accepted in `beforeAll` |
| `userBTarget` | intended invite recipient | `WRONG_EMAIL_TOKEN` | never accepts |
| `userC` | attacker + expired test | `EXPIRED_TOKEN` | tries to steal userB's token, then tries expired |

`EXPIRED_TOKEN` invite row is inserted with `expires_at = new Date(Date.now() - 3_600_000).toISOString()` (one hour in the past). All other invites have `expires_at = new Date(Date.now() + 7 * 86_400_000).toISOString()` (7 days future).

**Contract**:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isSupabaseRunning, createServiceClient, createUserClient, createSignInClient } from "./helpers/supabase-test";

const supabaseAvailable = await isSupabaseRunning();

describe.skipIf(!supabaseAvailable)(
  "accept_invitation() security — token replay, wrong-email, expiry (local Supabase not running — run npx supabase start)",
  () => {
    const svc = createServiceClient();
    const ts = Date.now();

    // Unique token strings per run to avoid collisions
    const REPLAY_TOKEN = `replay-${ts}`;
    const WRONG_EMAIL_TOKEN = `wrong-email-${ts}`;
    const EXPIRED_TOKEN = `expired-${ts}`;

    let workspaceId = "";
    let userAId = ""; let userAToken = "";
    let userBTargetId = "";
    let userCId = ""; let userCToken = "";

    beforeAll(async () => {
      // 1. Create workspace (service client bypasses RLS)
      // 2. Create 3 users with email_confirm: true
      // 3. Insert 3 workspace_invitation rows (replay, wrong-email, expired)
      // 4. Sign in user-a and user-c to get access tokens
      // 5. User-a accepts REPLAY_TOKEN (positive case — establishes accepted_at)
    });

    afterAll(async () => {
      if (workspaceId) await svc.from("workspace").delete().eq("id", workspaceId);
      for (const uid of [userAId, userBTargetId, userCId].filter(Boolean)) {
        await svc.auth.admin.deleteUser(uid);
      }
    });

    it("positive: user-a workspace_member row exists after first acceptance", async () => {
      // Verifies beforeAll's acceptance actually worked
      const { data } = await createUserClient(userAToken)
        .from("workspace_member").select("role").maybeSingle();
      expect(data?.role).toBe("member");
    });

    it("replay: second acceptance of same token is rejected", async () => {
      const { error } = await createUserClient(userAToken)
        .rpc("accept_invitation", { p_token: REPLAY_TOKEN });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("invalid or expired invitation");
    });

    it("wrong-email binding: user-c cannot accept user-b-target's token", async () => {
      const { error } = await createUserClient(userCToken)
        .rpc("accept_invitation", { p_token: WRONG_EMAIL_TOKEN });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("invalid or expired invitation");
    });

    it("expiry: user-c cannot accept an expired token", async () => {
      const { error } = await createUserClient(userCToken)
        .rpc("accept_invitation", { p_token: EXPIRED_TOKEN });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("invalid or expired invitation");
    });
  },
);
```

### Success Criteria

#### Automated Verification

- `npm test` exits 0 with 4 tests passing (or 1 skip message if local Supabase is not running)
- `npm run lint` exits 0
- `npm run build` exits 0

#### Manual Verification

- When local Supabase IS running: all 4 tests appear in `npm test` output as passing green checkmarks
- When local Supabase is NOT running: one skip line appears (no failures)
- Positive test output confirms "user-a workspace_member row exists after first acceptance"

---

## Phase 2: Playwright globalSetup + role-gating spec

### Overview

Adds Playwright globalSetup/globalTeardown for DB fixture management and `e2e/role-gating.spec.ts` for HTTP-level role gate assertion. Updates `playwright.config.ts` to wire the setup/teardown files and adds `.auth/` to `.gitignore`.

### Changes Required

#### 1. `.gitignore` entry

**File**: `.gitignore`

**Intent**: Prevent `.auth/test-fixtures.json` (which contains plaintext test passwords) from being committed.

Add under the `# playwright` section:
```
.auth/
```

#### 2. `global-setup.ts`

**File**: `e2e/global-setup.ts`

**Intent**: Creates the Playwright auth fixtures. Runs before tests. Exits early (no-op) when local Supabase is not reachable. When Supabase IS reachable: creates one team_lead user, one member user, one workspace, two `workspace_member` rows, then writes `.auth/test-fixtures.json` with credentials for the spec.

**Contract**:

```typescript
import { mkdirSync, writeFileSync } from "fs";
import { createServiceClient, isSupabaseRunning } from "../src/__tests__/helpers/supabase-test";

export const FIXTURES_PATH = ".auth/test-fixtures.json";

export default async function globalSetup(): Promise<void> {
  if (!(await isSupabaseRunning())) return; // graceful skip
  const svc = createServiceClient();
  const ts = Date.now();

  const email = (role: string) => `role-gate-${role}-${ts}@example.com`;
  const PASSWORD = "test-password-123";

  // Create team_lead + member users
  // Create workspace
  // Insert workspace_member rows for both users
  // Write FIXTURES_PATH with { teamLead, member, workspaceId }
  // No HTTP calls — all via Supabase service client
}
```

**Fixtures file shape**:
```json
{
  "teamLead": { "id": "...", "email": "...", "password": "test-password-123" },
  "member":   { "id": "...", "email": "...", "password": "test-password-123" },
  "workspaceId": "..."
}
```

#### 3. `global-teardown.ts`

**File**: `e2e/global-teardown.ts`

**Intent**: Reads the fixtures file (if it exists) and deletes the test workspace and both users via the service client. No-op if the file doesn't exist (globalSetup skipped).

**Contract**:

```typescript
import { existsSync, readFileSync } from "fs";
import { createServiceClient, isSupabaseRunning } from "../src/__tests__/helpers/supabase-test";
import { FIXTURES_PATH } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(FIXTURES_PATH)) return;
  if (!(await isSupabaseRunning())) return;
  const { teamLead, member, workspaceId } = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));
  const svc = createServiceClient();
  await svc.from("workspace").delete().eq("id", workspaceId); // cascade deletes workspace_member
  await svc.auth.admin.deleteUser(teamLead.id);
  await svc.auth.admin.deleteUser(member.id);
}
```

#### 4. `e2e/role-gating.spec.ts`

**File**: `e2e/role-gating.spec.ts`

**Intent**: Signs in as member and team_lead using isolated Playwright request contexts (separate cookie jars), then asserts:
- Member context → GET `/team-feed` → 302 redirect to `/dashboard`
- Team Lead context → GET `/team-feed` → 200

Both tests use `maxRedirects: 0` to intercept the raw response, consistent with `middleware-gate.spec.ts`.

**Skip condition**: `!existsSync('.auth/test-fixtures.json')` (globalSetup exited early) OR `!supabaseAvailable` (Supabase not reachable at test time). Uses `test.describe.configure({ mode: 'skip' })` behind the condition.

**Authentication**: each context calls `POST /api/auth/signin` with `form: { email, password }`. Playwright follows the redirect to `/dashboard`, storing the Supabase session cookies in the context. All subsequent requests from that context carry the session. The dev server must have Supabase configured — satisfied in local dev by `reuseExistingServer: true` (developer's existing `npm run dev` has `.env` loaded).

**Contract**:

```typescript
import { test, expect, request } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { isSupabaseRunning } from "../src/__tests__/helpers/supabase-test";
import { FIXTURES_PATH } from "./global-setup";

const supabaseAvailable = await isSupabaseRunning();
const fixturesExist = existsSync(FIXTURES_PATH);

test.describe(
  "team-feed role gating (requires local Supabase + npm run dev with Supabase vars)",
  () => {
    if (!supabaseAvailable || !fixturesExist) {
      test.describe.configure({ mode: "skip" });
    }

    let teamLeadCtx: Awaited<ReturnType<typeof request.newContext>>;
    let memberCtx: Awaited<ReturnType<typeof request.newContext>>;

    test.beforeAll(async () => {
      const { teamLead, member } = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));

      teamLeadCtx = await request.newContext({ baseURL: "http://localhost:4321" });
      await teamLeadCtx.post("/api/auth/signin", {
        form: { email: teamLead.email, password: teamLead.password },
      });

      memberCtx = await request.newContext({ baseURL: "http://localhost:4321" });
      await memberCtx.post("/api/auth/signin", {
        form: { email: member.email, password: member.password },
      });
    });

    test.afterAll(async () => {
      await teamLeadCtx?.dispose();
      await memberCtx?.dispose();
    });

    test("member session is redirected to /dashboard", async () => {
      const resp = await memberCtx.get("/team-feed", { maxRedirects: 0 });
      expect(resp.status()).toBe(302);
      expect(resp.headers().location).toBe("/dashboard");
    });

    test("team_lead session reaches /team-feed (200)", async () => {
      const resp = await teamLeadCtx.get("/team-feed", { maxRedirects: 0 });
      expect(resp.status()).toBe(200);
    });
  },
);
```

#### 5. `playwright.config.ts` update

**File**: `playwright.config.ts`

**Intent**: Wire `globalSetup` and `globalTeardown` so fixtures are created and destroyed around the full test run.

**Change**:

```typescript
// Add to the defineConfig call:
globalSetup: "./e2e/global-setup.ts",
globalTeardown: "./e2e/global-teardown.ts",
```

### Success Criteria

#### Automated Verification

- `npx playwright test` exits 0 with all tests passing (or role-gating tests skipped, existing middleware-gate tests always passing)
- `npm run lint` exits 0
- `npm run build` exits 0

#### Manual Verification

- When local Supabase is running AND `npm run dev` is running with Supabase vars:
  - `npx playwright test` shows 2 role-gating tests as passed
  - "member session is redirected to /dashboard" passes (302 Location: /dashboard confirmed)
  - "team_lead session reaches /team-feed (200)" passes
- When local Supabase is NOT running:
  - `npx playwright test` shows role-gating tests as skipped, middleware-gate tests still pass
- After teardown, the test workspace and users are gone from Supabase Studio

---

## Progress

### Phase 1: Vitest invite-token security tests

#### Automated
- [ ] 1.1 Write `src/__tests__/invite-token-security.test.ts` with `beforeAll`, `afterAll`, and 4 tests
- [ ] 1.2 `npm test` exits 0 (4 tests pass or 1 skip line if Supabase not running)
- [ ] 1.3 `npm run lint` exits 0
- [ ] 1.4 `npm run build` exits 0

#### Manual
- [ ] 1.5 Confirm all 4 tests show as green when `npx supabase start` is running
- [ ] 1.6 Confirm 1 skip line (not a failure) when Supabase is stopped

### Phase 2: Playwright globalSetup + role-gating spec

#### Automated
- [ ] 2.1 Add `.auth/` to `.gitignore`
- [ ] 2.2 Write `e2e/global-setup.ts`
- [ ] 2.3 Write `e2e/global-teardown.ts`
- [ ] 2.4 Write `e2e/role-gating.spec.ts`
- [ ] 2.5 Update `playwright.config.ts` with `globalSetup`/`globalTeardown`
- [ ] 2.6 `npx playwright test` exits 0 (middleware-gate tests always pass; role-gating tests pass or skip)
- [ ] 2.7 `npm run lint` exits 0
- [ ] 2.8 `npm run build` exits 0

#### Manual
- [ ] 2.9 Confirm role-gating tests pass with local Supabase + dev server running
- [ ] 2.10 Confirm member session is rejected (302 /dashboard confirmed in output)
- [ ] 2.11 Confirm team_lead session is accepted (200 confirmed in output)
- [ ] 2.12 Confirm role-gating tests skip (not fail) when Supabase is stopped
