import { readFileSync } from "fs";
import { join } from "path";
import { computeAffordabilityPct } from "./bracket-math";

interface CbsaInfo {
  code: string;
  name: string;
}

// Cache loaded data in memory across requests (within same serverless instance)
let countyToCbsa: Record<string, CbsaInfo> | null = null;
let tractToZip: Record<string, string> | null = null;
const msaCache = new Map<string, (string | number)[][]>();

function loadCountyToCbsa(): Record<string, CbsaInfo> {
  if (countyToCbsa) return countyToCbsa;
  const filePath = join(process.cwd(), "data", "county-to-cbsa.json");
  countyToCbsa = JSON.parse(readFileSync(filePath, "utf-8"));
  return countyToCbsa!;
}

function loadTractToZip(): Record<string, string> {
  if (tractToZip) return tractToZip;
  const filePath = join(process.cwd(), "data", "tract-to-zip.json");
  tractToZip = JSON.parse(readFileSync(filePath, "utf-8"));
  return tractToZip!;
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

export interface PercentileResult {
  percentile: number;
  msaTractCount: number;
  cbsaName: string;
}

/**
 * Compute how this tract's affordability % ranks among all tracts in its MSA.
 *
 * @param safmrByZip - When provided (SAFMR area), each tract is evaluated
 *   against its own ZIP's rent rather than a uniform threshold. Keys are
 *   5-digit ZIP codes, values are FMR arrays [studio, 1BR, 2BR, 3BR, 4BR].
 * @param bedroomIndex - Which bedroom count to use for SAFMR lookup (default 2 = 2BR).
 */
export function computeMsaPercentile(
  stateFips: string,
  countyFips: string,
  tractFips: string,
  incomeThreshold: number,
  safmrByZip?: Record<string, number[]>,
  bedroomIndex: number = 2
): PercentileResult | null {
  const mapping = loadCountyToCbsa();
  const countyKey = `${stateFips}${countyFips}`;
  const cbsa = mapping[countyKey];
  if (!cbsa) return null;

  const msaData = loadMsaData(cbsa.code);
  if (!msaData || msaData.length === 0) return null;

  const targetFips = `${stateFips}${countyFips}${tractFips}`;

  // Load tract-to-ZIP mapping if we have SAFMR data
  const zipMapping = safmrByZip ? loadTractToZip() : null;

  // Compute affordability % for every tract in the MSA
  const tractPcts: number[] = [];
  let targetPct: number | null = null;

  for (const tract of msaData) {
    const fips = tract[0] as string;
    const total = tract[1] as number;
    const brackets = (tract as number[]).slice(2);

    let threshold = incomeThreshold;

    if (safmrByZip && zipMapping) {
      // Use this tract's own ZIP's SAFMR to compute a local threshold
      const zip = zipMapping[fips];
      if (zip && safmrByZip[zip]) {
        const localFmr = safmrByZip[zip][bedroomIndex];
        if (localFmr) {
          threshold = (localFmr * 12) / 0.3;
        }
      }
      // If no ZIP match, fall back to the uniform incomeThreshold (MSA-level FMR)
    }

    const pct = computeAffordabilityPct(threshold, total, brackets);
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
