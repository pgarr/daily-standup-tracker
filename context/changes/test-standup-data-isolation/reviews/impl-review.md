<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Standup Data Isolation Tests

- **Plan**: context/changes/test-standup-data-isolation/plan.md
- **Scope**: Full (all 3 phases)
- **Date**: 2026-06-07
- **Verdict**: APPROVED (all findings fixed during triage)
- **Findings**: 0 critical / 1 warning / 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — workspace_member insert result unchecked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/__tests__/standup-data-isolation.test.ts (workspace_member bulk insert in beforeAll)
- **Detail**: The `svc.from("workspace_member").insert([...])` call in `beforeAll` discards its return value — neither `data` nor `error` is inspected. If the insert fails silently (e.g. FK constraint, schema mismatch), both users get no membership row and `auth_user_workspace_id()` returns null for them. Tests 1–3 and 5 would still pass for the right reasons, but Test 4 ("INSERT with foreign workspace_id rejected") would pass for the wrong reason: the insert is rejected because `workspace_id = null` fails, not because the workspace is foreign. That makes Test 4 vacuous — it would pass even if the cross-workspace membership policy were broken.
- **Fix**: Add error-checking after the bulk insert: `const { error: wmErr } = await svc.from("workspace_member").insert([...]); if (wmErr) throw new Error(\`workspace_member insert: \${wmErr.message}\`);`
- **Decision**: FIXED (F1 — added error check after workspace_member bulk insert in beforeAll)

### F2 — Test 4 foreign-workspace dependency undocumented

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/__tests__/standup-data-isolation.test.ts ("INSERT with foreign workspace_id rejected" test)
- **Detail**: The test's correctness silently depends on User B having no `workspace_member` row in `workspaceB`. The setup intentionally omits that row, but there is no comment explaining why. A future maintainer who refactors the setup (e.g. adds User B to workspaceB for a new test) would break the isolation without any warning.
- **Fix**: Add a one-line comment above the test: `// workspaceB is "foreign" because beforeAll never inserted a workspace_member row for User B there.`
- **Decision**: FIXED (F2 — added explanatory comment above test)

### F3 — Sign-in client created inline; safe-defaults pattern invisible

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/__tests__/standup-data-isolation.test.ts (signInClient in beforeAll) / src/__tests__/helpers/supabase-test.ts
- **Detail**: The sign-in client (`createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })`) is constructed inline in `beforeAll` rather than via the helper. The safe options (`persistSession: false, autoRefreshToken: false`) that prevent Vitest from hanging are embedded invisibly in the test file. A future contributor writing a new RLS test by copying the pattern might omit those options, causing their test run to hang after the suite exits.
- **Fix**: Export `createSignInClient()` from `src/__tests__/helpers/supabase-test.ts` that always includes `persistSession: false, autoRefreshToken: false`, and use it in the test file. Update §6.3 snippet to show `createSignInClient()` instead of the inline construction.
- **Decision**: FIXED (F3 — exported createSignInClient() from helper; updated test and §6.3 snippet)
