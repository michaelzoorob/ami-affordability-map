/**
 * Build script: precompute income distribution data for all US Census tracts,
 * grouped by MSA (CBSA). Output is used at runtime to compute percentile
 * rankings for the affordability tool.
 *
 * Usage: CENSUS_API_KEY=... node scripts/build-msa-data.mjs
 *
 * Data sources:
 * - Census ACS 5-Year B19001 (household income brackets) for all tracts
 * - OMB CBSA delineation file (county → MSA mapping)
 *
 * Output:
 * - data/county-to-cbsa.json  — county FIPS → {code, name}
 * - data/msa/{cbsaCode}.json  — array of [fips, total, ...16 bracket counts]
 */

import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const CENSUS_API_KEY = process.env.CENSUS_API_KEY;
if (!CENSUS_API_KEY) {
  console.error("Set CENSUS_API_KEY environment variable.");
  process.exit(1);
}

// 50 states + DC + PR
const STATE_FIPS = [
  "01","02","04","05","06","08","09","10","11","12",
  "13","15","16","17","18","19","20","21","22","23",
  "24","25","26","27","28","29","30","31","32","33",
  "34","35","36","37","38","39","40","41","42","44",
  "45","46","47","48","49","50","51","53","54","55","56","72",
];

const B19001_VARS = [
  "B19001_001E",
  "B19001_002E","B19001_003E","B19001_004E","B19001_005E",
  "B19001_006E","B19001_007E","B19001_008E","B19001_009E",
  "B19001_010E","B19001_011E","B19001_012E","B19001_013E",
  "B19001_014E","B19001_015E","B19001_016E","B19001_017E",
];

const MIN_HOUSEHOLDS = 50;

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 404 || res.status === 204) return null;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    } catch {
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  return null;
}

// ── Step 1: Download and parse CBSA delineation file ──────────────────────
async function buildCountyToCbsa() {
  console.log("Downloading CBSA delineation file...");
  const url =
    "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download delineation file: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Find header row
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i]?.some((c) => String(c).includes("CBSA Code"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error("Could not find header row in delineation file.");

  const headers = rows[headerIdx].map(String);
  const cbsaCodeIdx = headers.findIndex((h) => h.includes("CBSA Code"));
  const cbsaTitleIdx = headers.findIndex((h) => h.includes("CBSA Title"));
  const stateIdx = headers.findIndex((h) => h.includes("FIPS State Code"));
  const countyIdx = headers.findIndex((h) => h.includes("FIPS County Code"));

  const mapping = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const cbsaCode = String(row[cbsaCodeIdx] || "").trim();
    const cbsaTitle = String(row[cbsaTitleIdx] || "").trim();
    const st = String(row[stateIdx] || "").padStart(2, "0");
    const co = String(row[countyIdx] || "").padStart(3, "0");
    if (cbsaCode && st !== "00" && co !== "000") {
      mapping[`${st}${co}`] = { code: cbsaCode, name: cbsaTitle };
    }
  }

  console.log(`  Parsed ${Object.keys(mapping).length} county → CBSA mappings.`);
  return mapping;
}

// ── Step 2: Download B19001 for all tracts, state by state ────────────────
async function fetchAllTracts(countyToCbsa) {
  const msaTracts = {}; // cbsaCode → [[fips, total, ...brackets], ...]

  for (const state of STATE_FIPS) {
    process.stdout.write(`  State ${state}...`);

    const url =
      `https://api.census.gov/data/2023/acs/acs5` +
      `?get=${B19001_VARS.join(",")}` +
      `&for=tract:*&in=state:${state}` +
      `&key=${CENSUS_API_KEY}`;

    let res = await fetchWithRetry(url);
    if (!res) {
      // Try 2022 fallback
      const url2022 = url.replace("/2023/", "/2022/");
      res = await fetchWithRetry(url2022);
      if (!res) {
        console.log(" skipped (no data)");
        continue;
      }
    }

    const data = await res.json();
    if (!data || data.length < 2) {
      console.log(" skipped (empty)");
      continue;
    }

    let added = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const total = parseInt(row[0], 10);
      if (isNaN(total) || total < MIN_HOUSEHOLDS) continue;

      // Last 3 columns: state, county, tract
      const st = row[17];
      const co = row[18];
      const tr = row[19];
      const countyKey = `${st}${co}`;
      const cbsa = countyToCbsa[countyKey];
      if (!cbsa) continue; // not in any MSA

      const fips = `${st}${co}${tr}`;
      const brackets = [];
      for (let j = 1; j <= 16; j++) {
        brackets.push(parseInt(row[j], 10) || 0);
      }

      if (!msaTracts[cbsa.code]) msaTracts[cbsa.code] = [];
      msaTracts[cbsa.code].push([fips, total, ...brackets]);
      added++;
    }

    console.log(` ${added} tracts`);

    // Small delay to be polite to Census API
    await new Promise((r) => setTimeout(r, 300));
  }

  return msaTracts;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const dataDir = join(process.cwd(), "data");
  const msaDir = join(dataDir, "msa");
  if (!existsSync(dataDir)) mkdirSync(dataDir);
  if (!existsSync(msaDir)) mkdirSync(msaDir, { recursive: true });

  // Step 1
  const countyToCbsa = await buildCountyToCbsa();
  writeFileSync(
    join(dataDir, "county-to-cbsa.json"),
    JSON.stringify(countyToCbsa)
  );
  console.log("Saved data/county-to-cbsa.json\n");

  // Step 2
  console.log("Fetching tract-level B19001 data...");
  const msaTracts = await fetchAllTracts(countyToCbsa);

  // Step 3: Write MSA files
  let totalTracts = 0;
  let msaCount = 0;
  for (const [cbsaCode, tracts] of Object.entries(msaTracts)) {
    writeFileSync(join(msaDir, `${cbsaCode}.json`), JSON.stringify(tracts));
    totalTracts += tracts.length;
    msaCount++;
  }

  console.log(
    `\nDone! Wrote ${msaCount} MSA files with ${totalTracts} total tracts.`
  );
  console.log(`Data directory: ${dataDir}`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
