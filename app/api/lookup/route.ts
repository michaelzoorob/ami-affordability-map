import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress, reverseGeocodeCoordinates } from "@/lib/census-geocoder";
import { fetchIncomeDistribution, fetchMedianByHouseholdSize } from "@/lib/census-acs";
import { fetchAreaMedianIncome } from "@/lib/hud-api";
import { fetchFairMarketRents, getSafmrData } from "@/lib/hud-fmr";
import { calculateAffordability } from "@/lib/affordability";
import { computeMsaPercentile } from "@/lib/msa-percentile";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const lat = request.nextUrl.searchParams.get("lat");
  const lng = request.nextUrl.searchParams.get("lng");

  if ((!address || address.trim().length === 0) && (!lat || !lng)) {
    return NextResponse.json(
      { error: "Please provide an address or lat/lng coordinates." },
      { status: 400 }
    );
  }

  try {
    // Step 1: Geocode address (or reverse-geocode coordinates) to get tract info
    const geo = lat && lng
      ? await reverseGeocodeCoordinates(parseFloat(lat), parseFloat(lng))
      : await geocodeAddress(address!);

    // Step 2: Fetch all data in parallel
    const [incomeData, hudData, fmrData, medianData] = await Promise.all([
      fetchIncomeDistribution(geo.stateFips, geo.countyFips, geo.tractFips),
      fetchAreaMedianIncome(geo.stateFips, geo.countyFips, geo.countySubFips),
      fetchFairMarketRents(geo.stateFips, geo.countyFips, geo.countySubFips, geo.zipCode),
      fetchMedianByHouseholdSize(geo.stateFips, geo.countyFips, geo.tractFips),
    ]);

    // Step 3: Calculate default affordability (4-person, 2BR)
    const defaultFmr = fmrData.fmrByBedroom[2]; // 2BR (SAFMR or metro-level)
    const defaultMonthlyRent = defaultFmr;
    const defaultIncomeNeeded = (defaultFmr * 12) / 0.3;
    const defaultResult = calculateAffordability(
      defaultIncomeNeeded,
      defaultMonthlyRent,
      incomeData.totalHouseholds,
      incomeData.brackets,
      hudData.areaName
    );

    // Step 4: Compute MSA percentile
    // Each tract is evaluated against its own ZIP's SAFMR when available;
    // tracts without SAFMR data fall back to the uniform metro-level threshold.
    const safmrByZip = fmrData.isSafmr ? getSafmrData() : undefined;
    const msaPercentile = computeMsaPercentile(
      geo.stateFips,
      geo.countyFips,
      geo.tractFips,
      defaultIncomeNeeded,
      safmrByZip
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
      // SAFMR info
      isSafmr: fmrData.isSafmr,
      fmrZipCode: fmrData.fmrZipCode ?? null,
      // MSA percentile context
      msaPercentile: msaPercentile?.percentile ?? null,
      msaTractCount: msaPercentile?.msaTractCount ?? null,
      cbsaName: msaPercentile?.cbsaName ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
