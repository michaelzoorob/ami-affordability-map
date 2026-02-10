// Pure-JS shared module for income bracket math.
// No Node.js imports (fs, path) so it works in both server and "use client" contexts.

export const BRACKET_BOUNDS: [number, number][] = [
  [0, 9999],
  [10000, 14999],
  [15000, 19999],
  [20000, 24999],
  [25000, 29999],
  [30000, 34999],
  [35000, 39999],
  [40000, 44999],
  [45000, 49999],
  [50000, 59999],
  [60000, 74999],
  [75000, 99999],
  [100000, 124999],
  [125000, 149999],
  [150000, 199999],
  [200000, Infinity],
];

export function computeAffordabilityPct(
  incomeThreshold: number,
  totalHouseholds: number,
  bracketCounts: number[]
): number {
  if (totalHouseholds === 0) return 0;

  let householdsAbove = 0;
  for (let i = 0; i < bracketCounts.length; i++) {
    const [min, max] = BRACKET_BOUNDS[i];
    const count = bracketCounts[i];
    const isTopBracket = max === Infinity;

    if (min >= incomeThreshold) {
      householdsAbove += count;
    } else if (!isTopBracket && max >= incomeThreshold) {
      const bracketWidth = max - min + 1;
      const portionAbove = (max - incomeThreshold + 1) / bracketWidth;
      householdsAbove += count * portionAbove;
    } else if (isTopBracket && min < incomeThreshold) {
      householdsAbove += count;
    }
  }

  return Math.round((householdsAbove / totalHouseholds) * 1000) / 10;
}
