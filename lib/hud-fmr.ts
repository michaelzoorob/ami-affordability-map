export interface HudFmrData {
  fmrByBedroom: number[]; // index 0 = studio, 1 = 1BR, ... 4 = 4BR
  year: string;
}

export async function fetchFairMarketRents(
  stateFips: string,
  countyFips: string
): Promise<HudFmrData> {
  const token = process.env.HUD_API_TOKEN;
  if (!token) {
    throw new Error("HUD_API_TOKEN environment variable is not set.");
  }

  const entityId = `${stateFips}${countyFips}99999`;
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

  // basicdata can be an object (single area) or an array (multiple zip-level entries)
  const basicdata = data.data.basicdata;
  const record = Array.isArray(basicdata) ? basicdata[0] : basicdata;

  const fmrByBedroom = [
    record.Efficiency,
    record["One-Bedroom"],
    record["Two-Bedroom"],
    record["Three-Bedroom"],
    record["Four-Bedroom"],
  ];

  if (fmrByBedroom.some((v: number) => v == null || isNaN(v))) {
    throw new Error("Incomplete FMR data in HUD response.");
  }

  return {
    fmrByBedroom,
    year: record.year?.toString() || data.data.year?.toString() || "2025",
  };
}
