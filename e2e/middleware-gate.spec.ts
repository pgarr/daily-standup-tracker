import { test, expect } from "@playwright/test";

// Keep in sync with AUTH_REQUIRED_ROUTES + WORKSPACE_REQUIRED_ROUTES in src/lib/routes.ts.
// Route-coverage.test.ts is the canonical gate for ungated routes; this list covers
// specific HTTP-level behaviour only.
const PROTECTED_ROUTES = ["/dashboard", "/workspace/setup"];

const PUBLIC_ROUTES = ["/", "/auth/signin", "/auth/signup", "/auth/confirm-email"];

test.describe("protected routes", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects unauthenticated requests to /auth/signin`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe("/auth/signin");
    });
  }
});

test.describe("public routes", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} returns 200`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBe(201);
    });
  }
});
