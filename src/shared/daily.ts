// The game has the same three lines in src/core/daily.ts. A test in each repo pins the vectors.
export const EPOCH_UTC = Date.UTC(2026, 9, 31);

export function dayNumber(nowMs: number): number {
  return Math.floor((nowMs - EPOCH_UTC) / 86_400_000) + 1;
}

export function dailySeed(day: number): number {
  return (Math.imul(day, 2654435761 | 0) ^ 0x1f123bb5) & 0x7fffffff;
}
