import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import { resolve, relative, join } from "path";
import { AUTH_REQUIRED_ROUTES, WORKSPACE_REQUIRED_ROUTES } from "@/lib/routes";

const PAGES_DIR = resolve(__dirname, "../pages");

// Every route not covered by a protection prefix must appear here.
// - To protect a new route area: add its prefix to AUTH_REQUIRED_ROUTES in src/lib/routes.ts.
// - To mark a route as intentionally public: add it to this set with a comment.
// API routes are listed here because middleware skips /api/* — they rely on inline guards.
const EXPLICIT_PUBLIC_ROUTES = new Set([
  "/",
  "/auth/signin",
  "/auth/signup",
  "/auth/confirm-email",
  "/api/auth/signin",
  "/api/auth/signup",
  "/api/auth/signout",
  "/api/workspace/create",
  "/api/workspace/invite", // inline auth + team_lead guard
  "/api/workspace/invite-cancel", // inline auth + team_lead guard
  "/api/workspace/accept-invite", // inline auth guard
  "/api/standup/submit", // inline auth guard
  "/auth/accept-invite", // intentionally public — pre-auth invite acceptance page
]);

function collectPageFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    // Skip _-prefixed entries — Astro ignores them (co-located helpers, not routes)
    if (entry.name.startsWith("_")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPageFiles(fullPath));
    } else if (entry.name.endsWith(".astro") || entry.name.endsWith(".ts")) {
      // All .ts files are treated as routes. Co-located helpers must use the
      // _ prefix (e.g., _utils.ts) or they will surface as ungated routes here.
      files.push(fullPath);
    }
  }
  return files;
}

function deriveUrlPath(filePath: string): string {
  const rel = relative(PAGES_DIR, filePath);
  // Remove .astro / .ts extension
  const withoutExt = rel.replace(/\.(astro|ts)$/, "");
  // Strip trailing /index or bare index
  const withoutIndex = withoutExt.replace(/\/index$|^index$/, "");
  // Strip dynamic segments — /blog/[slug] → /blog; preserves static prefix for protection check
  const normalized = withoutIndex.replace(/\/\[[^\]]+\].*$/, "");
  return "/" + (normalized || withoutIndex);
}

describe("Route coverage", () => {
  it("every page file is either protected by prefix or explicitly marked public", () => {
    const files = collectPageFiles(PAGES_DIR);
    const ungated: string[] = [];

    for (const file of files) {
      const route = deriveUrlPath(file);
      const isProtected =
        AUTH_REQUIRED_ROUTES.some((prefix) => route.startsWith(prefix)) ||
        WORKSPACE_REQUIRED_ROUTES.some((prefix) => route.startsWith(prefix));
      const isPublic = EXPLICIT_PUBLIC_ROUTES.has(route);

      if (!isProtected && !isPublic) {
        ungated.push(route);
      }
    }

    expect(
      ungated,
      `Ungated route(s) found: [${ungated.join(", ")}]. ` +
        "Add to AUTH_REQUIRED_ROUTES in src/lib/routes.ts if it should be protected, " +
        "or to EXPLICIT_PUBLIC_ROUTES in this test if it is intentionally public.",
    ).toHaveLength(0);
  });
});
