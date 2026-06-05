// STUB — replace with real implementation in S-04 (blocker-detection-flow)
// Contract: context/changes/test-phase-3/plan.md § Binding Function Contracts

export function isNextBusinessDay(_prev: Date, _next: Date): boolean {
  throw new Error("not yet implemented — ships with S-04");
}

export function shouldSuggestBlockerMatch(
  _entries: readonly { submitted_date: string; blockers: string | null }[],
  _threshold: number,
  _similarityFn: (a: string, b: string) => boolean,
): boolean {
  throw new Error("not yet implemented — ships with S-04");
}
