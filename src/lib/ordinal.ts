/**
 * English ordinal for a count: 1st, 2nd, 3rd, 4th … 11th, 21st, 22nd, 23rd.
 *
 * Pure and server-only-free so it can be unit-tested directly. The old inline
 * `${n}th` produced "3th" for every count past two. The teens are the exception
 * the naive "1→st, 2→nd, 3→rd" rule gets wrong (11th, 12th, 13th), so they are
 * handled first.
 */
export function ordinalOf(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
