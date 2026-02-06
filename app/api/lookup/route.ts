import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/census-geocoder";
import { fetchIncomeDistribution, fetchMedianByHouseholdSize } from "@/lib/census-acs";
import { fetchAreaMedianIncome } from "@/lib/hud-api";
import { fetchFairMarketRents } from "@/lib/hud-fmr";
import { calculateAffordability } from "@/lib/affordability";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  if (!address || address.trim().length === 0) {
    return NextResponse.json(
      { error: "Please provide an address." },
      { status: 400 }
    );
  }

  try {
    // Step 1: Geocode address and get tract info
    const geo = await geocodeAddress(address);

    // Step 2: Fetch all data in parallel
    const [incomeData, hudData, fmrData, medianData] = await Promise.all([
      fetchIncomeDistribution(geo.stateFips, geo.countyFips, geo.tractFips),
      fetchAreaMedianIncome(geo.stateFips, geo.countyFips),
      fetchFairMarketRents(geo.stateFips, geo.countyFips),
      fetchMedianByHouseholdSize(geo.stateFips, geo.countyFips, geo.tractFips),
    ]);

    // Step 3: Calculate default affordability (4-person, 2BR)
    const defaultFmr = fmrData.fmrByBedroom[2]; // 2BR
    const defaultMonthlyRent = defaultFmr;
    const defaultIncomeNeeded = (defaultFmr * 12) / 0.3;
    const defaultResult = calculateAffordability(
      defaultIncomeNeeded,
      defaultMonthlyRent,
      incomeData.totalHouseholds,
      incomeData.brackets,
      hudData.areaName
    );

    return NextResponse.json({
      // Default calculation result
      ...defaultResult,
      // Raw data for client-side recalculation
      incomeLimitsBySize: hudData.incomeLimitsBySize,
      fmrByBedroom: fmrData.fmrByBedroom,
      medianBySize: medianData.medianBySize,
      brackets: incomeData.brackets,
      // Geo info
      lat: geo.lat,
      lng: geo.lng,
      matchedAddress: geo.matchedAddress,
      stateFips: geo.stateFips,
      countyFips: geo.countyFips,
      tractFips: geo.tractFips,
      hudYear: hudData.year,
      fmrYear: fmrData.year,
      medianIncome: hudData.medianIncome,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
