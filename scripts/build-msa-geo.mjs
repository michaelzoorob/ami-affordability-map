/**
 * Build script: download Census 2020 tract boundary shapefiles and build
 * simplified TopoJSON files, one per MSA (CBSA).
 *
 * Usage: node scripts/build-msa-geo.mjs
 *
 * Data source:
 * - Census 2020 cartographic boundaries (500k simplification)
 *   https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_tract_500k.zip
 *
 * Output:
 * - data/msa-geo/{cbsaCode}.json — TopoJSON topology per MSA
 *
 * Dependencies (devDependencies): shapefile, topojson-server, adm-zip
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import AdmZip from "adm-zip";
import * as shapefile from "shapefile";
import * as topojson from "topojson-server";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const OUT_DIR = join(DATA_DIR, "msa-geo");
const TMP_DIR = join(ROOT, ".tmp-shp");

const SHP_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_tract_500k.zip";
const ZIP_PATH = join(TMP_DIR, "cb_2020_us_tract_500k.zip");

// NYC DCP shoreline-clipped census tracts (covers 5 NYC boroughs only)
const NYC_DCP_TRACTS_URL = "https://data.cityofnewyork.us/resource/63ge-mke6.geojson?$limit=50000";
const NYC_DCP_TRACTS_PATH = join(TMP_DIR, "nyc-dcp-tracts-2020.geojson");
const NYC_COUNTY_FIPS = new Set(["36061", "36047", "36081", "36005", "36085"]);

// Load county-to-CBSA mapping
const countyToCbsa = JSON.parse(readFileSync(join(DATA_DIR, "county-to-cbsa.json"), "utf-8"));

async function downloadFile(url, destPath) {
  if (existsSync(destPath)) {
    console.log(`Using cached download: ${destPath}`);
    return;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const fileStream = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body), fileStream);
  console.log(`Downloaded to ${destPath}`);
}

/**
 * Download NYC DCP shoreline-clipped census tracts and return a Map of
 * GEOID → GeoJSON geometry. These replace Census Bureau geometries for
 * the 5 NYC counties to eliminate water-crossing slivers.
 */
async function loadNycDcpTracts() {
  if (!existsSync(NYC_DCP_TRACTS_PATH)) {
    console.log("Downloading NYC DCP shoreline-clipped census tracts...");
    const res = await fetch(NYC_DCP_TRACTS_URL);
    if (!res.ok) throw new Error(`NYC DCP download failed: ${res.status}`);
    const text = await res.text();
    writeFileSync(NYC_DCP_TRACTS_PATH, text);
    console.log(`Saved NYC DCP tracts to ${NYC_DCP_TRACTS_PATH}`);
  } else {
    console.log(`Using cached NYC DCP tracts: ${NYC_DCP_TRACTS_PATH}`);
  }

  const geojson = JSON.parse(readFileSync(NYC_DCP_TRACTS_PATH, "utf-8"));
  const geoidToGeometry = new Map();
  for (const feature of geojson.features) {
    const geoid = feature.properties.geoid || feature.properties.GEOID;
    if (geoid && feature.geometry) {
      geoidToGeometry.set(geoid, feature.geometry);
    }
  }
  console.log(`Loaded ${geoidToGeometry.size} NYC DCP shoreline-clipped tracts`);
  return geoidToGeometry;
}

async function main() {
  // Step 1: Download shapefile ZIP
  await downloadFile(SHP_URL, ZIP_PATH);

  // Step 2: Extract .shp and .dbf from ZIP
  console.log("Extracting shapefile from ZIP...");
  const zip = new AdmZip(ZIP_PATH);
  const extractDir = join(TMP_DIR, "extracted");
  mkdirSync(extractDir, { recursive: true });

  // Extract only needed files
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (name.endsWith(".shp") || name.endsWith(".dbf") || name.endsWith(".prj") || name.endsWith(".shx")) {
      zip.extractEntryTo(entry, extractDir, false, true);
    }
  }

  const shpPath = join(extractDir, "cb_2020_us_tract_500k.shp");
  const dbfPath = join(extractDir, "cb_2020_us_tract_500k.dbf");

  // Step 3: Read shapefile and group features by CBSA
  console.log("Reading shapefile and grouping by MSA...");
  const msaFeatures = new Map(); // cbsaCode -> GeoJSON feature[]

  const source = await shapefile.open(shpPath, dbfPath);
  let count = 0;
  while (true) {
    const result = await source.read();
    if (result.done) break;
    count++;

    const feature = result.value;
    const geoid = feature.properties.GEOID; // e.g. "36061000100"
    if (!geoid || geoid.length < 5) continue;

    // Extract 5-digit county FIPS (state 2 + county 3)
    const countyFips = geoid.substring(0, 5);
    const cbsa = countyToCbsa[countyFips];
    if (!cbsa) continue; // Not in an MSA (rural)

    const cbsaCode = cbsa.code;
    if (!msaFeatures.has(cbsaCode)) {
      msaFeatures.set(cbsaCode, []);
    }

    // Keep only GEOID property to minimize output size
    msaFeatures.get(cbsaCode).push({
      type: "Feature",
      properties: { GEOID: geoid },
      geometry: feature.geometry,
    });

    if (count % 10000 === 0) {
      console.log(`  Processed ${count} tracts...`);
    }
  }

  console.log(`Total tracts processed: ${count}`);
  console.log(`MSAs found: ${msaFeatures.size}`);

  // Step 4: Replace NYC tract geometries with DCP shoreline-clipped versions
  const nycDcpTracts = await loadNycDcpTracts();
  let nycReplaced = 0;
  let nycMissing = 0;
  for (const [, features] of msaFeatures) {
    for (const feature of features) {
      const geoid = feature.properties.GEOID;
      const countyFips = geoid.substring(0, 5);
      if (!NYC_COUNTY_FIPS.has(countyFips)) continue;

      const dcpGeom = nycDcpTracts.get(geoid);
      if (dcpGeom) {
        feature.geometry = dcpGeom;
        nycReplaced++;
      } else {
        nycMissing++;
      }
    }
  }
  console.log(`Replaced ${nycReplaced} NYC tract geometries with DCP shoreline-clipped versions`);
  if (nycMissing > 0) {
    console.log(`  (${nycMissing} NYC tracts not found in DCP data — kept Census geometry)`);
  }

  // Step 5: Convert each group to TopoJSON and save
  mkdirSync(OUT_DIR, { recursive: true });

  let saved = 0;
  for (const [cbsaCode, features] of msaFeatures) {
    const fc = {
      type: "FeatureCollection",
      features,
    };

    const topo = topojson.topology({ tracts: fc }, 1e5);

    writeFileSync(join(OUT_DIR, `${cbsaCode}.json`), JSON.stringify(topo));
    saved++;
    if (saved % 100 === 0) {
      console.log(`  Saved ${saved}/${msaFeatures.size} MSA files...`);
    }
  }

  console.log(`Done! Saved ${saved} TopoJSON files to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
