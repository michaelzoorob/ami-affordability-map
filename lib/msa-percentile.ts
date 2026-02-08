import { readFileSync } from "fs";
import { join } from "path";

interface CbsaInfo {
  code: string;
  name: string;
}

// Cache loaded data in memory across requests (within same serverless instance)
let countyToCbsa: Record<string, CbsaInfo> | null = null;
const msaCache = new Map<string, (string | number)[][]>();

const BRACKET_BOUNDS: [number, number][] = [
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

function loadCountyToCbsa(): Record<string, CbsaInfo> {
  if (countyToCbsa) return countyToCbsa;
  const filePath = join(process.cwd(), "data", "county-to-cbsa.json");
  countyToCbsa = JSON.parse(readFileSync(filePath, "utf-8"));
  return countyToCbsa!;
}

function loadMsaData(cbsaCode: string): (string | number)[][] | null {
  if (msaCache.has(cbsaCode)) return msaCache.get(cbsaCode)!;
  try {
    const filePath = join(process.cwd(), "data", "msa", `${cbsaCode}.json`);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    msaCache.set(cbsaCode, data);
    return data;
  } catch {
    return null;
  }
}

function computeAffordabilityPct(
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

export interface PercentileResult {
  percentile: number;
  msaTractCount: number;
  cbsaName: string;
}

export function computeMsaPercentile(
  stateFips: string,
  countyFips: string,
  tractFips: string,
  incomeThreshold: number
): PercentileResult | null {
  const mapping = loadCountyToCbsa();
  const countyKey = `${stateFips}${countyFips}`;
  const cbsa = mapping[countyKey];
  if (!cbsa) return null;

  const msaData = loadMsaData(cbsa.code);
  if (!msaData || msaData.length === 0) return null;

  const targetFips = `${stateFips}${countyFips}${tractFips}`;

  // Compute affordability % for every tract in the MSA
  const tractPcts: number[] = [];
  let targetPct: number | null = null;

  for (const tract of msaData) {
    const fips = tract[0] as string;
    const total = tract[1] as number;
    const brackets = (tract as number[]).slice(2);

    const pct = computeAffordabilityPct(incomeThreshold, total, brackets);
    tractPcts.push(pct);

    if (fips === targetFips) {
      targetPct = pct;
    }
  }

  if (targetPct === null) return null;

  // Percentile: % of tracts with a lower affordability %
  const belowCount = tractPcts.filter((p) => p < targetPct!).length;
  const percentile = Math.round((belowCount / tractPcts.length) * 1000) / 10;

  return {
    percentile,
    msaTractCount: tractPcts.length,
    cbsaName: cbsa.name,
  };
}
