// Route protection constants — single source of truth for middleware and tests.
// Update these when adding new protected areas; the route-coverage Vitest test
// will enforce that every page is either covered here or explicitly listed as public.
export const AUTH_REQUIRED_ROUTES = ["/dashboard", "/workspace"];
// Never add "/workspace/setup" to this list — it is the redirect target for
// no-workspace users and would create an infinite redirect loop.
export const WORKSPACE_REQUIRED_ROUTES = ["/dashboard"];
export const WORKSPACE_SETUP_REDIRECT = "/workspace/setup";
