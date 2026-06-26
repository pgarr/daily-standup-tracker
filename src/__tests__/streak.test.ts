import { describe, it, expect } from "vitest";
import { calculateStreak } from "@/lib/streak";

describe("calculateStreak", () => {
  it("returns 0 for an empty array", () => {
    // PRD v3 FR-011: streak of zero when no entries exist
    expect(calculateStreak([])).toBe(0);
  });

  it("returns 3 for three consecutive business days (Mon/Tue/Wed)", () => {
    // PRD v3 FR-011: standard consecutive Mon–Fri run
    const entries = [
      { submitted_date: "2026-06-03" }, // Wednesday
      { submitted_date: "2026-06-02" }, // Tuesday
      { submitted_date: "2026-06-01" }, // Monday
    ];
    expect(calculateStreak(entries)).toBe(3);
  });

  it("returns 2 for Fri+Mon entries — Fri→Mon is consecutive; weekend is invisible", () => {
    // PRD v3 FR-011: Sat/Sun gaps do not break the streak; Fri→Mon counts as consecutive
    const entries = [
      { submitted_date: "2026-06-01" }, // Monday
      { submitted_date: "2026-05-29" }, // Friday (previous week)
    ];
    expect(calculateStreak(entries)).toBe(2);
  });

  it("returns 1 for a single lone entry", () => {
    // PRD v3 FR-011: a single entry has a streak of 1
    const entries = [{ submitted_date: "2026-06-01" }]; // Monday
    expect(calculateStreak(entries)).toBe(1);
  });

  it("returns 1 for Wed+Mon entries — Tue gap breaks the streak", () => {
    // PRD v3 FR-011: Tue is a business day; skipping it breaks the streak
    const entries = [
      { submitted_date: "2026-06-03" }, // Wednesday
      { submitted_date: "2026-06-01" }, // Monday (Tue 2026-06-02 missing)
    ];
    expect(calculateStreak(entries)).toBe(1);
  });

  it("returns 1 for Mon+Thu entries — Fri gap breaks the streak", () => {
    // PRD v3 FR-011: Fri 2026-05-29 is a business day; skipping it breaks the streak
    const entries = [
      { submitted_date: "2026-06-01" }, // Monday
      { submitted_date: "2026-05-28" }, // Thursday prev week (Fri 2026-05-29 missing)
    ];
    expect(calculateStreak(entries)).toBe(1);
  });

  describe("timezone boundary", () => {
    // Tests 6a and 6b document the storage contract for S-03:
    // submitted_date MUST be the user's local business date, not the UTC date.
    // If a user submits on Fri at 23:59 UTC+2 (= 21:59 UTC), submitted_date
    // must be '2026-06-05' (Fri local) for streak continuity.
    // calculateStreak trusts submitted_date; the conversion is S-03's responsibility.

    it("returns 2 when Fri submitted_date is stored as '2026-06-05' — correct local date", () => {
      // PRD v3 FR-011: correct Fri storage ('2026-06-05') preserves Fri→Mon streak continuity
      const entries = [
        { submitted_date: "2026-06-08" }, // Monday
        { submitted_date: "2026-06-05" }, // Friday (correct — local date, not UTC)
      ];
      expect(calculateStreak(entries)).toBe(2);
    });

    it("returns 1 when Fri submitted_date is stored as '2026-06-06' — wrong UTC date (Sat)", () => {
      // PRD v3 FR-011: if S-03 stores UTC date instead of local, a Fri 23:59 UTC+2 submission
      // lands as '2026-06-06' (Sat) — Sat is not a business day; streak breaks to 1
      const entries = [
        { submitted_date: "2026-06-08" }, // Monday
        { submitted_date: "2026-06-06" }, // Saturday (WRONG — UTC date for Fri 23:59 local)
      ];
      expect(calculateStreak(entries)).toBe(1);
    });
  });
});
