export function calculateStreak(entries: readonly { submitted_date: string }[]): number {
  if (entries.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < entries.length - 1; i++) {
    const newer = new Date(entries[i].submitted_date + "T00:00:00Z");
    const older = new Date(entries[i + 1].submitted_date + "T00:00:00Z");
    const olderDay = older.getUTCDay(); // 0=Sun, 6=Sat
    if (olderDay === 0 || olderDay === 6) break;
    if (!isImmediateNextBizDay(older, newer)) break;
    count++;
  }
  return count;
}

function isImmediateNextBizDay(prev: Date, next: Date): boolean {
  const d = new Date(prev);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return (
    d.getUTCFullYear() === next.getUTCFullYear() &&
    d.getUTCMonth() === next.getUTCMonth() &&
    d.getUTCDate() === next.getUTCDate()
  );
}
