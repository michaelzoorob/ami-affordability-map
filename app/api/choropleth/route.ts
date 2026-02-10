import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

interface CbsaInfo {
  code: string;
  name: string;
}

// Cache loaded data in memory (within same serverless instance)
let countyToCbsa: Record<string, CbsaInfo> | null = null;
let tractToZip: Record<string, string> | null = null;
let safmrByZip: Record<string, number[]> | null = null;

// LRU-ish cache for MSA income data (limit to 5 to manage memory)
const msaDataCache = new Map<string, (string | number)[][]>();
const MSA_DATA_MAX = 5;

// LRU-ish cache for geo data (limit to 5)
const geoCache = new Map<string, object>();
const GEO_CACHE_MAX = 5;

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

function loadSafmrByZip(): Record<string, number[]> {
  if (safmrByZip) return safmrByZip;
  const filePath = join(process.cwd(), "data", "safmr-by-zip.json");
  safmrByZip = JSON.parse(readFileSync(filePath, "utf-8"));
  return safmrByZip!;
}

function loadMsaData(cbsaCode: string): (string | number)[][] | null {
  if (msaDataCache.has(cbsaCode)) return msaDataCache.get(cbsaCode)!;
  try {
    const filePath = join(process.cwd(), "data", "msa", `${cbsaCode}.json`);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (msaDataCache.size >= MSA_DATA_MAX) {
      const oldest = msaDataCache.keys().next().value!;
      msaDataCache.delete(oldest);
    }
    msaDataCache.set(cbsaCode, data);
    return data;
  } catch {
    return null;
  }
}

function loadGeoData(cbsaCode: string): object | null {
  if (geoCache.has(cbsaCode)) return geoCache.get(cbsaCode)!;
  try {
    const filePath = join(process.cwd(), "data", "msa-geo", `${cbsaCode}.json`);
    if (!existsSync(filePath)) return null;
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (geoCache.size >= GEO_CACHE_MAX) {
      const oldest = geoCache.keys().next().value!;
      geoCache.delete(oldest);
    }
    geoCache.set(cbsaCode, data);
    return data;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const stateFips = request.nextUrl.searchParams.get("stateFips");
  const countyFips = request.nextUrl.searchParams.get("countyFips");

  if (!stateFips || !countyFips) {
    return NextResponse.json(
      { error: "stateFips and countyFips are required." },
      { status: 400 }
    );
  }

  try {
    // Look up CBSA
    const mapping = loadCountyToCbsa();
    const countyKey = `${stateFips}${countyFips}`;
    const cbsa = mapping[countyKey];
    if (!cbsa) {
      return NextResponse.json(
        { error: "Location is not in a Metropolitan Statistical Area." },
        { status: 404 }
      );
    }

    // Load MSA income data
    const msaData = loadMsaData(cbsa.code);
    if (!msaData || msaData.length === 0) {
      return NextResponse.json(
        { error: "No income data available for this MSA." },
        { status: 404 }
      );
    }

    // Load SAFMR and tract-to-ZIP mapping
    const zipMapping = loadTractToZip();
    const safmr = loadSafmrByZip();

    // Build compact tract array:
    // [GEOID, totalHH, bracketCounts[16], safmrArray[5] | null]
    const tracts: [string, number, number[], number[] | null][] = [];
    for (const tract of msaData) {
      const fips = tract[0] as string;
      const total = tract[1] as number;
      const brackets = (tract as number[]).slice(2);

      // Look up SAFMR for this tract's ZIP
      const zip = zipMapping[fips];
      const fmrArray = zip && safmr[zip] ? safmr[zip] : null;

      tracts.push([fips, total, brackets, fmrArray]);
    }

    // Load pre-built TopoJSON
    const geo = loadGeoData(cbsa.code);

    const response = NextResponse.json({
      cbsaCode: cbsa.code,
      cbsaName: cbsa.name,
      tracts,
      geo,
    });

    response.headers.set("Cache-Control", "public, max-age=86400");
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
