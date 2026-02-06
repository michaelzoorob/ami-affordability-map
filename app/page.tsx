"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import SearchBar from "@/components/SearchBar";
import ResultsPanel from "@/components/ResultsPanel";
import { IncomeBracket } from "@/lib/census-acs";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

interface RawApiResponse {
  // Default calculation
  incomeThreshold: number;
  monthlyRent: number;
  percentCanAfford: number;
  householdsAboveThreshold: number;
  totalHouseholds: number;
  areaName: string;
  // Raw data for recalculation
  incomeLimitsBySize: number[];
  fmrByBedroom: number[];
  medianBySize: (number | null)[];
  brackets: IncomeBracket[];
  medianIncome: number;
  // Geo
  lat: number;
  lng: number;
  matchedAddress: string;
  stateFips: string;
  countyFips: string;
  tractFips: string;
  hudYear: string;
  fmrYear: string;
}

function recalculate(
  rawData: RawApiResponse,
  householdSize: number,
  bedrooms: number
) {
  const fmr = rawData.fmrByBedroom[bedrooms];
  const incomeNeeded = (fmr * 12) / 0.3;
  const sizeAdjustedAmi = rawData.incomeLimitsBySize[householdSize - 1];

  let householdsAboveThreshold = 0;
  for (const bracket of rawData.brackets) {
    if (bracket.min >= incomeNeeded) {
      householdsAboveThreshold += bracket.count;
    } else if (bracket.max >= incomeNeeded && bracket.max !== Infinity) {
      const bracketWidth = bracket.max - bracket.min + 1;
      const portionAbove = (bracket.max - incomeNeeded + 1) / bracketWidth;
      householdsAboveThreshold += bracket.count * portionAbove;
    } else if (bracket.max === Infinity && bracket.min < incomeNeeded) {
      householdsAboveThreshold += bracket.count;
    }
  }

  const percentCanAfford =
    rawData.totalHouseholds > 0
      ? Math.round(
          (householdsAboveThreshold / rawData.totalHouseholds) * 1000
        ) / 10
      : 0;

  // B19019 index: 0 = overall, 1 = 1-person, ..., 7 = 7+-person
  // For householdSize >= 7, use index 7
  const medianIndex = Math.min(householdSize, 7);
  const tractMedian = rawData.medianBySize[medianIndex];

  return {
    incomeThreshold: incomeNeeded,
    monthlyRent: fmr,
    percentCanAfford,
    householdsAboveThreshold: Math.round(householdsAboveThreshold),
    totalHouseholds: rawData.totalHouseholds,
    sizeAdjustedAmi,
    tractMedian,
  };
}

export default function Home() {
  const [rawData, setRawData] = useState<RawApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [markerPosition, setMarkerPosition] = useState<
    [number, number] | null
  >(null);
  const [householdSize, setHouseholdSize] = useState(4);
  const [bedrooms, setBedrooms] = useState(2);

  const handleSearch = useCallback(async (address: string) => {
    setIsLoading(true);
    setError(null);
    setRawData(null);

    try {
      const res = await fetch(
        `/api/lookup?address=${encodeURIComponent(address)}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "An error occurred.");
        return;
      }

      setRawData(data);
      setMarkerPosition([data.lat, data.lng]);
    } catch {
      setError("Failed to connect to the server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const computed = useMemo(() => {
    if (!rawData) return null;
    return recalculate(rawData, householdSize, bedrooms);
  }, [rawData, householdSize, bedrooms]);

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-white shadow-sm px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 mb-3">
          AMI Affordability Map
        </h1>
        <SearchBar onSearch={handleSearch} isLoading={isLoading} />
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 min-h-[300px]">
          <Map
            center={[39.8283, -98.5795]}
            markerPosition={markerPosition}
            markerLabel={rawData?.matchedAddress}
          />
        </div>

        <div className="md:w-96 p-4 overflow-y-auto bg-gray-50">
          <ResultsPanel
            rawData={rawData}
            computed={computed}
            error={error}
            isLoading={isLoading}
            householdSize={householdSize}
            bedrooms={bedrooms}
            onHouseholdSizeChange={setHouseholdSize}
            onBedroomsChange={setBedrooms}
          />
        </div>
      </div>
    </div>
  );
}
