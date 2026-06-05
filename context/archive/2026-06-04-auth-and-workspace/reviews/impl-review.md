<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Auth and Workspace Creation

- **Plan**: context/changes/auth-and-workspace/plan.md
- **Scope**: Full (Phases 1–3)
- **Date**: 2026-06-05
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 0 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — create.ts lacks pre-flight guard for existing workspace

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/workspace/create.ts:10
- **Detail**: No check for existing workspaceMember before starting the two-INSERT flow. Double-POST causes unnecessary DB writes (orphaned INSERT, UNIQUE failure, compensating DELETE) and surfaces a raw constraint error instead of a clean redirect.
- **Fix**: Added `if (context.locals.workspaceMember) return context.redirect("/dashboard");` after user null check.
- **Decision**: FIXED

### F2 — AUTH_REQUIRED_ROUTES does not cover /api/workspace — comment needed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/workspace/create.ts:11
- **Detail**: `/api/workspace/create` starts with `/api`, not `/workspace`, so middleware AUTH_REQUIRED_ROUTES does not gate it. The in-route `if (!user)` check is the only auth gate, but it looked redundant without explanation.
- **Fix**: Added comment explaining why the guard is required (middleware matches /workspace, not /api).
- **Decision**: FIXED

### F3 — eslint.config.js change not in plan (EXTRA)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:69–71
- **Detail**: `@typescript-eslint/no-misused-promises: off` for .astro files was not in the plan, but is mechanically required to satisfy "npm run lint passes" on setup.astro (astro-eslint-parser crashes on return Astro.redirect() otherwise). Well-documented in a comment.
- **Decision**: SKIPPED

### F4 — WorkspaceSetupForm missing React default import

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/workspace/WorkspaceSetupForm.tsx:1
- **Detail**: SignInForm.tsx and SignUpForm.tsx both use `import React, { useState }`. WorkspaceSetupForm only imported `{ useState }`.
- **Fix**: Added `React,` to the import line.
- **Decision**: FIXED

### F5 — workspace query fires on all authenticated API requests

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:26
- **Detail**: The workspace_member maybeSingle() query ran on all authenticated requests including API routes that never use workspace context.
- **Fix**: Added `!pathname.startsWith("/api")` guard to skip the workspace query on API paths.
- **Decision**: FIXED
