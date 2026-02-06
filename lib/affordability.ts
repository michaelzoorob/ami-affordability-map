import { IncomeBracket } from "./census-acs";

export interface AffordabilityResult {
  incomeThreshold: number;
  monthlyRent: number;
  percentCanAfford: number;
  householdsAboveThreshold: number;
  totalHouseholds: number;
  areaName: string;
}

/**
 * Calculate the percentage of households that can afford a given rent level.
 *
 * incomeThreshold: the annual income needed to afford monthlyRent at 30% of income.
 * If monthlyRent is not provided, it's derived as incomeThreshold * 0.30 / 12.
 *
 * For the bracket containing the threshold, we linearly interpolate.
 */
export function calculateAffordability(
  incomeThreshold: number,
  monthlyRent: number,
  totalHouseholds: number,
  brackets: IncomeBracket[],
  areaName: string
): AffordabilityResult {
  if (totalHouseholds === 0) {
    return {
      incomeThreshold,
      monthlyRent,
      percentCanAfford: 0,
      householdsAboveThreshold: 0,
      totalHouseholds: 0,
      areaName,
    };
  }

  let householdsAboveThreshold = 0;

  for (const bracket of brackets) {
    if (bracket.min >= incomeThreshold) {
      // Entire bracket is above threshold
      householdsAboveThreshold += bracket.count;
    } else if (bracket.max >= incomeThreshold && bracket.max !== Infinity) {
      // Threshold falls within this bracket — interpolate
      const bracketWidth = bracket.max - bracket.min + 1;
      const portionAbove = (bracket.max - incomeThreshold + 1) / bracketWidth;
      householdsAboveThreshold += bracket.count * portionAbove;
    } else if (bracket.max === Infinity && bracket.min < incomeThreshold) {
      // Top bracket ($200k+) — assume all are above
      householdsAboveThreshold += bracket.count;
    }
  }

  const percentCanAfford = (householdsAboveThreshold / totalHouseholds) * 100;

  return {
    incomeThreshold,
    monthlyRent,
    percentCanAfford: Math.round(percentCanAfford * 10) / 10,
    householdsAboveThreshold: Math.round(householdsAboveThreshold),
    totalHouseholds,
    areaName,
  };
}
