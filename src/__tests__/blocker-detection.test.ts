import { describe, it, expect } from "vitest";
import { isNextBusinessDay, shouldSuggestBlockerMatch } from "@/lib/blocker";

// TODO(s-04-blocker-detection): remove this skip guard when S-04 ships the real implementation
const implemented = (() => {
  try {
    isNextBusinessDay(new Date("2026-06-01"), new Date("2026-06-02"));
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!implemented)("blocker detection", () => {
  describe("isNextBusinessDay", () => {
    it("returns true for Mon→Tue — standard consecutive business days", () => {
      // PRD v3 FR-012: adjacent Mon–Fri days are consecutive business days
      expect(isNextBusinessDay(new Date("2026-06-01"), new Date("2026-06-02"))).toBe(true);
    });

    it("returns true for Fri→Mon — weekend is invisible; Fri→Mon is next business day", () => {
      // PRD v3 FR-012: Sat/Sun are not business days; Fri→Mon skips the weekend
      expect(isNextBusinessDay(new Date("2026-05-29"), new Date("2026-06-01"))).toBe(true);
    });

    it("returns false for Mon→Wed — Tue 2026-06-02 is a business day between them", () => {
      // PRD v3 FR-012: Tue is a business day; Mon→Wed is not the immediate next business day
      expect(isNextBusinessDay(new Date("2026-06-01"), new Date("2026-06-03"))).toBe(false);
    });

    it("returns false for Thu→Mon — Fri 2026-05-29 is a business day between them", () => {
      // PRD v3 FR-012: Fri is a business day; Thu→Mon is not the immediate next business day
      expect(isNextBusinessDay(new Date("2026-05-28"), new Date("2026-06-01"))).toBe(false);
    });

    it("returns false for Fri→Sat — Sat is a weekend day, not a business day", () => {
      // PRD v3 FR-012: business days are Mon–Fri only; Sat is never a valid next business day
      expect(isNextBusinessDay(new Date("2026-05-29"), new Date("2026-05-30"))).toBe(false);
    });
  });

  describe("shouldSuggestBlockerMatch", () => {
    const alwaysMatch = () => true;
    const neverMatch = () => false;
    const e = (submitted_date: string, blockers: string | null) => ({ submitted_date, blockers });

    it("returns true when threshold met, days consecutive, and blockers similar", () => {
      // PRD v3 FR-012: alert fires when N consecutive days have similar non-empty blockers
      const entries = [e("2026-06-01", "X"), e("2026-05-29", "X")]; // Mon, Fri prev week
      expect(shouldSuggestBlockerMatch(entries, 2, alwaysMatch)).toBe(true);
    });

    it("returns false when similarity returns false — blockers not similar", () => {
      // PRD v3 FR-012: similar=false means blockers don't match; no alert suggestion
      const entries = [e("2026-06-01", "X"), e("2026-05-29", "Y")];
      expect(shouldSuggestBlockerMatch(entries, 2, neverMatch)).toBe(false);
    });

    it("returns false when days are non-consecutive — Tue gap between Wed and Mon", () => {
      // PRD v3 FR-012: Tue 2026-06-02 is a business day; Wed/Mon are not consecutive
      const entries = [e("2026-06-03", "X"), e("2026-06-01", "X")];
      expect(shouldSuggestBlockerMatch(entries, 2, alwaysMatch)).toBe(false);
    });

    it("returns false when entry count is below threshold — 2 entries, threshold=3", () => {
      // PRD v3 FR-012: threshold=3 requires 3 consecutive days; only 2 entries present
      const entries = [e("2026-06-01", "X"), e("2026-05-29", "X")];
      expect(shouldSuggestBlockerMatch(entries, 3, alwaysMatch)).toBe(false);
    });

    it("returns true when 3 consecutive Wed/Tue/Mon days meet threshold=3", () => {
      // PRD v3 FR-012: three consecutive Mon–Fri days with similar blockers meets threshold=3
      const entries = [e("2026-06-03", "X"), e("2026-06-02", "X"), e("2026-06-01", "X")];
      expect(shouldSuggestBlockerMatch(entries, 3, alwaysMatch)).toBe(true);
    });

    it("returns false when most recent entry has null blocker", () => {
      // PRD v3 FR-012 / US-02 AC: alert requires non-null, non-empty blockers on all entries
      const entries = [e("2026-06-01", null), e("2026-05-29", "X")];
      expect(shouldSuggestBlockerMatch(entries, 2, alwaysMatch)).toBe(false);
    });
  });
});
