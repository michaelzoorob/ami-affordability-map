export interface GeocodeResult {
  lat: number;
  lng: number;
  stateFips: string;
  countyFips: string;
  tractFips: string;
  countySubFips?: string;
  matchedAddress: string;
}

export async function reverseGeocodeCoordinates(
  lat: number,
  lng: number
): Promise<GeocodeResult> {
  // Step 1: Get FIPS codes from Census coordinate geocoder
  const censusUrl = new URL(
    "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
  );
  censusUrl.searchParams.set("x", String(lng));
  censusUrl.searchParams.set("y", String(lat));
  censusUrl.searchParams.set("benchmark", "Public_AR_Current");
  censusUrl.searchParams.set("vintage", "Current_Current");
  censusUrl.searchParams.set("format", "json");

  const censusRes = await fetch(censusUrl.toString());
  if (!censusRes.ok) {
    throw new Error(`Census coordinate geocoder returned ${censusRes.status}`);
  }

  const censusData = await censusRes.json();
  const geos = censusData?.result?.geographies?.["Census Tracts"]?.[0];

  if (!geos) {
    throw new Error("No Census tract found at this location. Try clicking on a populated area.");
  }

  const countySubGeo = censusData?.result?.geographies?.["County Subdivisions"]?.[0];
  const countySubFips: string | undefined = countySubGeo?.COUSUB;

  // Step 2: Get a display address from Nominatim
  let displayAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18`;
    const nomRes = await fetch(nomUrl, {
      headers: { "User-Agent": "AMI-Affordability-Map/1.0" },
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      if (nomData?.display_name) {
        displayAddress = nomData.display_name;
      }
    }
  } catch {
    // Fall back to coordinates if Nominatim fails
  }

  return {
    lat,
    lng,
    stateFips: geos.STATE,
    countyFips: geos.COUNTY,
    tractFips: geos.TRACT,
    countySubFips,
    matchedAddress: displayAddress,
  };
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
  );
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Census Geocoder returned ${res.status}`);
  }

  const data = await res.json();
  const matches = data?.result?.addressMatches;

  if (!matches || matches.length === 0) {
    throw new Error("Address not found. Please check the address and try again.");
  }

  const match = matches[0];
  const coords = match.coordinates;
  const geos = match.geographies?.["Census Tracts"]?.[0];

  if (!geos) {
    throw new Error("Could not determine Census tract for this address.");
  }

  // Extract county subdivision FIPS for New England states
  const countySubGeo = match.geographies?.["County Subdivisions"]?.[0];
  const countySubFips: string | undefined = countySubGeo?.COUSUB;

  return {
    lat: coords.y,
    lng: coords.x,
    stateFips: geos.STATE,
    countyFips: geos.COUNTY,
    tractFips: geos.TRACT,
    countySubFips,
    matchedAddress: match.matchedAddress,
  };
}
