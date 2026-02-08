/**
 * Build script: create a tract FIPS → primary ZIP code mapping.
 *
 * Downloads the Census 2020 ZCTA-to-Tract relationship file and, for each
 * tract, picks the ZCTA with the largest land-area overlap as the primary ZIP.
 *
 * Usage: node scripts/build-tract-zip.mjs
 *
 * Output: data/tract-to-zip.json — { tractFips: zipCode, ... }
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const RELATIONSHIP_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt";

async function main() {
  const dataDir = join(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir);

  console.log("Downloading Census ZCTA-to-Tract relationship file...");
  const res = await fetch(RELATIONSHIP_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const text = await res.text();

  const lines = text.split("\n");
  console.log(`  ${lines.length} lines`);

  // Header: OID_ZCTA5_20|GEOID_ZCTA5_20|...|GEOID_TRACT_20|...|AREALAND_PART|...
  // Col 1 (index 1) = GEOID_ZCTA5_20 (5-digit ZIP/ZCTA)
  // Col 9 (index 9) = GEOID_TRACT_20 (11-digit tract FIPS)
  // Col 15 (index 15) = AREALAND_PART (land area of overlap in sq meters)

  // For each tract, find the ZCTA with the largest overlap
  const tractBest = new Map(); // tractFips -> { zip, area }

  let parsed = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split("|");
    const zcta = cols[1]?.trim();
    const tract = cols[9]?.trim();
    const areaStr = cols[15]?.trim();

    if (!zcta || !tract || zcta.length !== 5 || tract.length !== 11) continue;

    const area = parseInt(areaStr, 10) || 0;
    parsed++;

    const existing = tractBest.get(tract);
    if (!existing || area > existing.area) {
      tractBest.set(tract, { zip: zcta, area });
    }
  }

  console.log(`  Parsed ${parsed} ZCTA-tract pairs`);
  console.log(`  ${tractBest.size} unique tracts mapped to ZIPs`);

  // Convert to plain object
  const mapping = {};
  for (const [tract, { zip }] of tractBest) {
    mapping[tract] = zip;
  }

  const outPath = join(dataDir, "tract-to-zip.json");
  writeFileSync(outPath, JSON.stringify(mapping));
  console.log(`Saved ${outPath} (${(JSON.stringify(mapping).length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
