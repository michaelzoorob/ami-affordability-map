export interface GeocodeResult {
  lat: number;
  lng: number;
  stateFips: string;
  countyFips: string;
  tractFips: string;
  countySubFips?: string;
  zipCode?: string;
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

  // Step 2: Get a display address and ZIP code from Nominatim
  let displayAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  let zipCode: string | undefined;
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`;
    const nomRes = await fetch(nomUrl, {
      headers: { "User-Agent": "AMI-Affordability-Map/1.0" },
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      if (nomData?.display_name) {
        displayAddress = nomData.display_name;
      }
      if (nomData?.address?.postcode) {
        // Take the first 5 digits (some postcodes include ZIP+4)
        zipCode = nomData.address.postcode.slice(0, 5);
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
    zipCode,
    matchedAddress: displayAddress,
  };
}

/**
 * Primary geocoding: Nominatim → Census coordinate API for FIPS.
 * Fallback: Census forward geocoder (strict but authoritative for US street addresses).
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  // Try Nominatim first — handles building names, landmarks, neighborhoods, etc.
  try {
    const nomResult = await nominatimForwardGeocode(address);
    if (nomResult) {
      return await reverseGeocodeCoordinates(
        nomResult.lat,
        nomResult.lng,
      );
    }
  } catch {
    // Nominatim failed — fall through to Census
  }

  // Fallback: Census forward geocoder
  return censusForwardGeocode(address);
}

async function nominatimForwardGeocode(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "AMI-Affordability-Map/1.0" },
  });

  if (!res.ok) return null;

  const results = await res.json();
  if (!results || results.length === 0) return null;

  const lat = parseFloat(results[0].lat);
  const lng = parseFloat(results[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;

  return { lat, lng };
}

async function censusForwardGeocode(address: string): Promise<GeocodeResult> {
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

  const countySubGeo = match.geographies?.["County Subdivisions"]?.[0];
  const countySubFips: string | undefined = countySubGeo?.COUSUB;

  // Try to get ZIP code via Nominatim reverse geocode
  let zipCode: string | undefined;
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${coords.y}&lon=${coords.x}&format=json&zoom=18&addressdetails=1`;
    const nomRes = await fetch(nomUrl, {
      headers: { "User-Agent": "AMI-Affordability-Map/1.0" },
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      if (nomData?.address?.postcode) {
        zipCode = nomData.address.postcode.slice(0, 5);
      }
    }
  } catch {
    // ZIP code is best-effort
  }

  return {
    lat: coords.y,
    lng: coords.x,
    stateFips: geos.STATE,
    countyFips: geos.COUNTY,
    tractFips: geos.TRACT,
    countySubFips,
    zipCode,
    matchedAddress: match.matchedAddress,
  };
}
