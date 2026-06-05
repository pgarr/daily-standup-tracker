import { test, expect } from "vitest";

// Trivial smoke test — proves Vitest is installed, configured, and executing.
// If this fails, the problem is with the toolchain, not application logic.
test("vitest runner is operational", () => {
  expect(1 + 1).toBe(2);
});
