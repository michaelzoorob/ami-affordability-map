export interface GeocodeResult {
  lat: number;
  lng: number;
  stateFips: string;
  countyFips: string;
  tractFips: string;
  countySubFips?: string;
  matchedAddress: string;
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
