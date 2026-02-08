import { readFileSync } from "fs";
import { join } from "path";

export interface HudFmrData {
  fmrByBedroom: number[]; // index 0 = studio, 1 = 1BR, ... 4 = 4BR
  year: string;
  isSafmr: boolean;
  fmrZipCode?: string;
}

// New England states use town/county subdivision instead of county for HUD lookups
const NEW_ENGLAND_STATES = new Set(["09", "23", "25", "33", "44", "50"]);

// Cache the static SAFMR data in memory
let safmrData: Record<string, number[]> | null = null;

function loadSafmrData(): Record<string, number[]> {
  if (safmrData) return safmrData;
  const filePath = join(process.cwd(), "data", "safmr-by-zip.json");
  safmrData = JSON.parse(readFileSync(filePath, "utf-8"));
  return safmrData!;
}

export function getSafmrForZip(zipCode: string): number[] | null {
  const data = loadSafmrData();
  return data[zipCode] ?? null;
}

export function getSafmrData(): Record<string, number[]> {
  return loadSafmrData();
}

export async function fetchFairMarketRents(
  stateFips: string,
  countyFips: string,
  countySubFips?: string,
  zipCode?: string
): Promise<HudFmrData> {
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
  const url = `https://www.huduser.gov/hudapi/public/fmr/data/${entityId}`;

  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HUD FMR API returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data?.error === "Unauthenticated") {
    throw new Error("HUD API authentication failed. Check your HUD_API_TOKEN.");
  }

  if (!data?.data?.basicdata) {
    throw new Error("No FMR data returned from HUD for this location.");
  }

  // Get metro-level FMR from the API
  const basicdata = data.data.basicdata;
  const apiRecord = Array.isArray(basicdata) ? basicdata[0] : basicdata;
  const metroFmr = [
    apiRecord.Efficiency as number,
    apiRecord["One-Bedroom"] as number,
    apiRecord["Two-Bedroom"] as number,
    apiRecord["Three-Bedroom"] as number,
    apiRecord["Four-Bedroom"] as number,
  ];
  const year = (apiRecord.year as string)?.toString() || data.data.year?.toString() || "2025";

  // Check static SAFMR file for ZIP-level rent (available for all metro areas)
  if (zipCode) {
    const safmr = getSafmrForZip(zipCode);
    if (safmr) {
      return {
        fmrByBedroom: safmr,
        year,
        isSafmr: true,
        fmrZipCode: zipCode,
      };
    }
  }

  // Fall back to metro-level FMR
  if (metroFmr.some((v: number) => v == null || isNaN(v))) {
    throw new Error("Incomplete FMR data in HUD response.");
  }

  return {
    fmrByBedroom: metroFmr,
    year,
    isSafmr: false,
  };
}
