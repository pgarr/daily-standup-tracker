// Contract: context/changes/test-phase-3/plan.md § Binding Function Contracts

export function isNextBusinessDay(prev: Date, next: Date): boolean {
  const prevDay = prev.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const daysUntilNextBusiness = prevDay === 5 ? 3 : 1; // Fri→Mon skips weekend

  const expected = new Date(prev);
  expected.setUTCDate(prev.getUTCDate() + daysUntilNextBusiness);

  return expected.toISOString().slice(0, 10) === next.toISOString().slice(0, 10);
}

export async function shouldSuggestBlockerMatch(
  entries: readonly { submitted_date: string; blockers: string | null }[],
  threshold: number,
  similarityFn: (a: string, b: string) => Promise<boolean>,
): Promise<boolean> {
  if (entries.length < threshold) return false;

  const window = entries.slice(0, threshold);

  for (const entry of window) {
    if (!entry.blockers || entry.blockers.trim() === "") return false;
  }

  for (let i = 0; i < window.length - 1; i++) {
    const newer = new Date(window[i].submitted_date + "T00:00:00Z");
    const older = new Date(window[i + 1].submitted_date + "T00:00:00Z");
    if (!isNextBusinessDay(older, newer)) return false;
    if (!(await similarityFn(window[i].blockers ?? "", window[i + 1].blockers ?? ""))) return false;
  }

  return true;
}
