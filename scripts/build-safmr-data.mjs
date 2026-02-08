/**
 * Build script: parse the HUD FY2026 SAFMR Excel file into a compact JSON
 * lookup keyed by ZIP code.
 *
 * Usage: node scripts/build-safmr-data.mjs
 *
 * Input:  Downloads fy2026_safmrs.xlsx from HUD
 * Output: data/safmr-by-zip.json — { zip: [studio, 1BR, 2BR, 3BR, 4BR], ... }
 */

import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const SAFMR_URL =
  "https://www.huduser.gov/portal/datasets/fmr/fmr2026/fy2026_safmrs.xlsx";

async function main() {
  const dataDir = join(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir);

  console.log("Downloading FY2026 SAFMR data from HUD...");
  const res = await fetch(SAFMR_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = await res.arrayBuffer();

  console.log("Parsing Excel file...");
  const wb = XLSX.read(new Uint8Array(buffer));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  console.log(`  ${data.length - 1} rows`);

  // Columns (0-indexed):
  // 0 = ZIP Code
  // 3 = SAFMR 0BR (studio)
  // 6 = SAFMR 1BR
  // 9 = SAFMR 2BR
  // 12 = SAFMR 3BR
  // 15 = SAFMR 4BR

  const safmrByZip = {};
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const zip = String(row[0] || "").padStart(5, "0");
    if (!/^\d{5}$/.test(zip)) continue;

    const studio = row[3];
    const oneBr = row[6];
    const twoBr = row[9];
    const threeBr = row[12];
    const fourBr = row[15];

    if (studio == null || twoBr == null) continue;

    safmrByZip[zip] = [studio, oneBr, twoBr, threeBr, fourBr];
    count++;
  }

  const outPath = join(dataDir, "safmr-by-zip.json");
  const jsonStr = JSON.stringify(safmrByZip);
  writeFileSync(outPath, jsonStr);

  console.log(`Saved ${count} ZIP codes to ${outPath}`);
  console.log(`File size: ${(jsonStr.length / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
