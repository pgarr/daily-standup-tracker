import { test, expect } from "@playwright/test";

const PROTECTED_ROUTES = ["/dashboard", "/workspace/setup"];

const PUBLIC_ROUTES = ["/", "/auth/signin", "/auth/signup", "/auth/confirm-email"];

for (const route of PROTECTED_ROUTES) {
  test(`protected route ${route} redirects unauthenticated requests to /auth/signin`, async ({ request }) => {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toContain("/auth/signin");
  });
}

for (const route of PUBLIC_ROUTES) {
  test(`public route ${route} does not redirect`, async ({ request }) => {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).not.toBe(302);
  });
}
