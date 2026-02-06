export interface HudIncomeData {
  medianIncome: number;
  incomeLimitsBySize: number[]; // index 0 = 1-person, ... index 7 = 8-person (100% AMI equivalents)
  areaName: string;
  year: string;
}

// New England states use town/county subdivision instead of county for HUD lookups
const NEW_ENGLAND_STATES = new Set(["09", "23", "25", "33", "44", "50"]);

export async function fetchAreaMedianIncome(
  stateFips: string,
  countyFips: string,
  countySubFips?: string
): Promise<HudIncomeData> {
  const token = process.env.HUD_API_TOKEN;
  if (!token) {
    throw new Error("HUD_API_TOKEN environment variable is not set.");
  }

  // New England states: {stateFIPS}{countyFIPS}{COUSUB} (10 digits)
  // Other states: {stateFIPS}{countyFIPS}99999 (10 digits)
  const suffix = NEW_ENGLAND_STATES.has(stateFips) && countySubFips
    ? countySubFips
    : "99999";
  const entityId = `${stateFips}${countyFips}${suffix}`;
  const url = `https://www.huduser.gov/hudapi/public/il/data/${entityId}`;

  const res = await fetch(url, {
    headers: {
      // HUD API requires lowercase 'authorization' header
      authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HUD API returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data?.error === "Unauthenticated") {
    throw new Error("HUD API authentication failed. Check your HUD_API_TOKEN.");
  }

  if (!data?.data) {
    throw new Error("No income limits data returned from HUD for this location.");
  }

  const record = data.data;
  const medianIncome = record.median_income;

  if (!medianIncome) {
    throw new Error("Median income not found in HUD response.");
  }

  // Extract size-adjusted income limits: il50_p1 through il50_p8
  // Multiply by 2 to get 100% AMI equivalents (HUD provides 50% limits)
  const veryLow = record.very_low;
  const incomeLimitsBySize: number[] = [];
  for (let i = 1; i <= 8; i++) {
    const val = veryLow?.[`il50_p${i}`];
    incomeLimitsBySize.push(val ? val * 2 : medianIncome);
  }

  return {
    medianIncome,
    incomeLimitsBySize,
    areaName: record.area_name || record.county_name || `${stateFips}-${countyFips}`,
    year: record.year || "2025",
  };
}
