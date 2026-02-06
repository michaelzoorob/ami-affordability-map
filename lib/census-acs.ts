// ACS 5-Year Table B19001: Household Income in the Past 12 Months
// 16 income brackets from <$10k to $200k+

export interface IncomeBracket {
  min: number;
  max: number; // Infinity for the top bracket
  count: number;
}

// B19001_002E through B19001_017E bracket boundaries
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

const VARIABLE_NAMES = [
  "B19001_001E", // total
  "B19001_002E",
  "B19001_003E",
  "B19001_004E",
  "B19001_005E",
  "B19001_006E",
  "B19001_007E",
  "B19001_008E",
  "B19001_009E",
  "B19001_010E",
  "B19001_011E",
  "B19001_012E",
  "B19001_013E",
  "B19001_014E",
  "B19001_015E",
  "B19001_016E",
  "B19001_017E",
];

export interface IncomeDistribution {
  totalHouseholds: number;
  brackets: IncomeBracket[];
}

export async function fetchIncomeDistribution(
  stateFips: string,
  countyFips: string,
  tractFips: string
): Promise<IncomeDistribution> {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error("CENSUS_API_KEY environment variable is not set.");
  }

  const url =
    `https://api.census.gov/data/2023/acs/acs5` +
    `?get=${VARIABLE_NAMES.join(",")}` +
    `&for=tract:${tractFips}` +
    `&in=state:${stateFips}&in=county:${countyFips}` +
    `&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    // Fall back to 2022 data if 2023 isn't available yet
    if (res.status === 404 || text.includes("unknown/unsupported")) {
      return fetchIncomeDistributionFallback(stateFips, countyFips, tractFips, apiKey);
    }
    throw new Error(`Census ACS API returned ${res.status}: ${text}`);
  }

  const data = await res.json();
  // data is [[header...], [values...]]
  if (!data || data.length < 2) {
    throw new Error("No income data available for this tract.");
  }

  const values = data[1];
  const totalHouseholds = parseInt(values[0], 10);

  const brackets: IncomeBracket[] = BRACKET_BOUNDS.map((bounds, i) => ({
    min: bounds[0],
    max: bounds[1],
    count: parseInt(values[i + 1], 10),
  }));

  return { totalHouseholds, brackets };
}

// B19019: Median Household Income by Household Size
// B19019_001E = overall, B19019_002E = 1-person, ... B19019_008E = 7+-person
const B19019_VARIABLES = [
  "B19019_001E",
  "B19019_002E",
  "B19019_003E",
  "B19019_004E",
  "B19019_005E",
  "B19019_006E",
  "B19019_007E",
  "B19019_008E",
];

export interface MedianByHouseholdSize {
  medianBySize: (number | null)[]; // index 0 = overall, 1 = 1-person, ... 7 = 7+-person
}

export async function fetchMedianByHouseholdSize(
  stateFips: string,
  countyFips: string,
  tractFips: string
): Promise<MedianByHouseholdSize> {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error("CENSUS_API_KEY environment variable is not set.");
  }

  const url =
    `https://api.census.gov/data/2023/acs/acs5` +
    `?get=${B19019_VARIABLES.join(",")}` +
    `&for=tract:${tractFips}` +
    `&in=state:${stateFips}&in=county:${countyFips}` +
    `&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    // Try 2022 fallback
    return fetchMedianByHouseholdSizeFallback(stateFips, countyFips, tractFips, apiKey);
  }

  const data = await res.json();
  if (!data || data.length < 2) {
    throw new Error("No B19019 data available for this tract.");
  }

  const values = data[1];
  const medianBySize: (number | null)[] = B19019_VARIABLES.map((_, i) => {
    const v = parseInt(values[i], 10);
    return v === -666666666 || isNaN(v) ? null : v;
  });

  return { medianBySize };
}

async function fetchMedianByHouseholdSizeFallback(
  stateFips: string,
  countyFips: string,
  tractFips: string,
  apiKey: string
): Promise<MedianByHouseholdSize> {
  const url =
    `https://api.census.gov/data/2022/acs/acs5` +
    `?get=${B19019_VARIABLES.join(",")}` +
    `&for=tract:${tractFips}` +
    `&in=state:${stateFips}&in=county:${countyFips}` +
    `&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    // Return all nulls if data unavailable
    return { medianBySize: B19019_VARIABLES.map(() => null) };
  }

  const data = await res.json();
  if (!data || data.length < 2) {
    return { medianBySize: B19019_VARIABLES.map(() => null) };
  }

  const values = data[1];
  const medianBySize: (number | null)[] = B19019_VARIABLES.map((_, i) => {
    const v = parseInt(values[i], 10);
    return v === -666666666 || isNaN(v) ? null : v;
  });

  return { medianBySize };
}

async function fetchIncomeDistributionFallback(
  stateFips: string,
  countyFips: string,
  tractFips: string,
  apiKey: string
): Promise<IncomeDistribution> {
  const url =
    `https://api.census.gov/data/2022/acs/acs5` +
    `?get=${VARIABLE_NAMES.join(",")}` +
    `&for=tract:${tractFips}` +
    `&in=state:${stateFips}&in=county:${countyFips}` +
    `&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Census ACS API returned ${res.status}. Income data unavailable for this tract.`);
  }

  const data = await res.json();
  if (!data || data.length < 2) {
    throw new Error("No income data available for this tract.");
  }

  const values = data[1];
  const totalHouseholds = parseInt(values[0], 10);

  const brackets: IncomeBracket[] = BRACKET_BOUNDS.map((bounds, i) => ({
    min: bounds[0],
    max: bounds[1],
    count: parseInt(values[i + 1], 10),
  }));

  return { totalHouseholds, brackets };
}
