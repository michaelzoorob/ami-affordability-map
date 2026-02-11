"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
  // SAFMR
  isSafmr: boolean;
  fmrZipCode: string | null;
  // MSA percentile
  msaPercentile: number | null;
  msaTractCount: number | null;
  cbsaName: string | null;
}

export interface AmiTableRow {
  amiPercent: number;
  income: number;
  rent: number;
  percentCanAfford: number;
  percentFeasible: number;
}

function interpolatePercentAbove(
  incomeThreshold: number,
  brackets: IncomeBracket[],
  totalHouseholds: number
): number {
  if (totalHouseholds === 0) return 0;

  let householdsAbove = 0;
  for (const bracket of brackets) {
    const isTopBracket = bracket.max === Infinity || bracket.max == null;
    if (bracket.min >= incomeThreshold) {
      householdsAbove += bracket.count;
    } else if (!isTopBracket && bracket.max >= incomeThreshold) {
      const bracketWidth = bracket.max - bracket.min + 1;
      const portionAbove = (bracket.max - incomeThreshold + 1) / bracketWidth;
      householdsAbove += bracket.count * portionAbove;
    } else if (isTopBracket && bracket.min < incomeThreshold) {
      // Top bracket ($200k+): assume all are above any threshold
      householdsAbove += bracket.count;
    }
  }

  return Math.round((householdsAbove / totalHouseholds) * 1000) / 10;
}

const AMI_PERCENTS = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const BEDROOM_LABELS = ["Studio", "1 BR", "2 BR", "3 BR", "4 BR"];

function recalculate(
  rawData: RawApiResponse,
  householdSize: number,
  bedrooms: number
) {
  const fmr = rawData.fmrByBedroom[bedrooms];
  const incomeNeeded = (fmr * 12) / 0.3;
  const sizeAdjustedAmi = rawData.incomeLimitsBySize[householdSize - 1];

  const percentCanAfford = interpolatePercentAbove(
    incomeNeeded,
    rawData.brackets,
    rawData.totalHouseholds
  );

  let householdsAboveThreshold = 0;
  for (const bracket of rawData.brackets) {
    const isTopBracket = bracket.max === Infinity || bracket.max == null;
    if (bracket.min >= incomeNeeded) {
      householdsAboveThreshold += bracket.count;
    } else if (!isTopBracket && bracket.max >= incomeNeeded) {
      const bracketWidth = bracket.max - bracket.min + 1;
      const portionAbove = (bracket.max - incomeNeeded + 1) / bracketWidth;
      householdsAboveThreshold += bracket.count * portionAbove;
    } else if (isTopBracket && bracket.min < incomeNeeded) {
      householdsAboveThreshold += bracket.count;
    }
  }

  // B19019 index: 0 = overall, 1 = 1-person, ..., 7 = 7+-person
  // For householdSize >= 7, use index 7
  const medianIndex = Math.min(householdSize, 7);
  const tractMedian = rawData.medianBySize[medianIndex];

  // AMI affordability table
  // "Eligible & feasible" band: earns ≤ AMI ceiling (eligible) but rent
  // doesn't exceed 40% of income (feasible). Floor = ceiling * 0.75
  // because rent = ceiling * 0.30/12, and ceiling * 0.30 / 0.40 = ceiling * 0.75.
  const amiTable: AmiTableRow[] = AMI_PERCENTS.map((pct) => {
    const income = sizeAdjustedAmi * pct / 100;
    const rent = income * 0.30 / 12;
    const floor = income * 0.75; // income where rent = 40% of income
    const pctAboveFloor = interpolatePercentAbove(
      floor,
      rawData.brackets,
      rawData.totalHouseholds
    );
    const pctAboveCeiling = interpolatePercentAbove(
      income,
      rawData.brackets,
      rawData.totalHouseholds
    );
    return {
      amiPercent: pct,
      income: Math.round(income),
      rent: Math.round(rent),
      percentCanAfford: pctAboveCeiling,
      percentFeasible: Math.round((pctAboveFloor - pctAboveCeiling) * 10) / 10,
    };
  });

  return {
    incomeThreshold: incomeNeeded,
    monthlyRent: fmr,
    percentCanAfford,
    householdsAboveThreshold: Math.round(householdsAboveThreshold),
    totalHouseholds: rawData.totalHouseholds,
    sizeAdjustedAmi,
    tractMedian,
    amiTable,
  };
}

export interface ChoroplethResponse {
  cbsaCode: string;
  cbsaName: string;
  tracts: [string, number, number[], number[] | null][];
  geo: object | null;
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
  const [currentAddress, setCurrentAddress] = useState<string | null>(null);
  const [initialAddress, setInitialAddress] = useState<string | undefined>(undefined);
  const initializedFromUrl = useRef(false);
  const [choroplethData, setChoroplethData] = useState<ChoroplethResponse | null>(null);
  const [choroplethLoading, setChoroplethLoading] = useState(false);
  const [choroplethMetric, setChoroplethMetric] = useState<"affordability" | "percentile">("affordability");
  const [legendPos, setLegendPos] = useState<{ x: number; y: number } | null>(null);
  const legendDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Reset legend position when choropleth data changes (new search)
  useEffect(() => {
    setLegendPos(null);
  }, [choroplethData]);

  // Fetch choropleth data in the background
  const fetchChoropleth = useCallback(async (stateFips: string, countyFips: string) => {
    setChoroplethLoading(true);
    try {
      const res = await fetch(
        `/api/choropleth?stateFips=${stateFips}&countyFips=${countyFips}`
      );
      if (res.ok) {
        const data = await res.json();
        setChoroplethData(data);
      } else {
        // Non-MSA or error — just clear choropleth
        setChoroplethData(null);
      }
    } catch {
      setChoroplethData(null);
    } finally {
      setChoroplethLoading(false);
    }
  }, []);

  // Update URL query params whenever search state changes
  const updateUrl = useCallback(
    (address: string, hh: number, br: number) => {
      const params = new URLSearchParams();
      params.set("address", address);
      params.set("household", String(hh));
      params.set("bedrooms", String(br));
      window.history.replaceState(null, "", `?${params.toString()}`);
    },
    []
  );

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
      setCurrentAddress(address);
      setMarkerPosition([data.lat, data.lng]);
      fetchChoropleth(data.stateFips, data.countyFips);
    } catch {
      setError("Failed to connect to the server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchChoropleth]);

  // Sync URL when search state changes
  useEffect(() => {
    if (currentAddress) {
      updateUrl(currentAddress, householdSize, bedrooms);
    }
  }, [currentAddress, householdSize, bedrooms, updateUrl]);

  // On mount, restore state from URL params and auto-search
  useEffect(() => {
    if (initializedFromUrl.current) return;
    initializedFromUrl.current = true;

    const params = new URLSearchParams(window.location.search);
    const address = params.get("address");
    if (!address) return;

    const hh = parseInt(params.get("household") || "", 10);
    const br = parseInt(params.get("bedrooms") || "", 10);
    if (hh >= 1 && hh <= 8) setHouseholdSize(hh);
    if (br >= 0 && br <= 4) setBedrooms(br);

    setInitialAddress(address);
    handleSearch(address);
  }, [handleSearch]);

  const handleMapClick = useCallback(
    async (lat: number, lng: number) => {
      setIsLoading(true);
      setError(null);
      setRawData(null);

      try {
        const res = await fetch(
          `/api/lookup?lat=${lat}&lng=${lng}`
        );
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Could not find data at this location.");
          return;
        }

        setRawData(data);
        setCurrentAddress(data.matchedAddress);
        setInitialAddress(data.matchedAddress);
        setMarkerPosition([data.lat, data.lng]);
        fetchChoropleth(data.stateFips, data.countyFips);
      } catch {
        setError("Failed to look up this location. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [fetchChoropleth]
  );

  const computed = useMemo(() => {
    if (!rawData) return null;
    return recalculate(rawData, householdSize, bedrooms);
  }, [rawData, householdSize, bedrooms]);

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-white shadow-sm px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">
          Who Can Afford to Live Here?
        </h1>
        <p className="text-sm text-gray-500 mb-3">
          Comparing Census Tract Incomes with Regional AMI
        </p>
        <SearchBar onSearch={handleSearch} isLoading={isLoading} initialAddress={initialAddress} />
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 min-h-[300px] relative">
          <Map
            center={[39.8283, -98.5795]}
            markerPosition={markerPosition}
            markerLabel={rawData?.matchedAddress}
            onMapClick={handleMapClick}
            choroplethData={choroplethData}
            choroplethLoading={choroplethLoading}
            bedroomIndex={bedrooms}
            searchedTractFips={rawData ? `${rawData.stateFips}${rawData.countyFips}${rawData.tractFips}` : undefined}
            fallbackFmr={rawData?.fmrByBedroom ?? null}
            choroplethMetric={choroplethMetric}
          />
          {choroplethData && choroplethData.geo && (
            <div
              className={`z-[1000] bg-white rounded-lg shadow-lg p-3 text-xs max-w-[220px] select-none ${
                legendPos ? "absolute" : "absolute bottom-4 right-4"
              }`}
              style={{
                touchAction: "none",
                cursor: legendDragRef.current ? "grabbing" : "grab",
                ...(legendPos ? { left: legendPos.x, top: legendPos.y } : {}),
              }}
              onPointerDown={(e) => {
                // Don't drag when clicking buttons
                if ((e.target as HTMLElement).closest("button")) return;
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                const parentRect = e.currentTarget.parentElement!.getBoundingClientRect();
                legendDragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: rect.left - parentRect.left,
                  origY: rect.top - parentRect.top,
                };
              }}
              onPointerMove={(e) => {
                if (!legendDragRef.current) return;
                const parent = e.currentTarget.parentElement!;
                const parentRect = parent.getBoundingClientRect();
                const elRect = e.currentTarget.getBoundingClientRect();
                const dx = e.clientX - legendDragRef.current.startX;
                const dy = e.clientY - legendDragRef.current.startY;
                const newX = Math.max(0, Math.min(legendDragRef.current.origX + dx, parentRect.width - elRect.width));
                const newY = Math.max(0, Math.min(legendDragRef.current.origY + dy, parentRect.height - elRect.height));
                setLegendPos({ x: newX, y: newY });
              }}
              onPointerUp={(e) => {
                if (!legendDragRef.current) return;
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                legendDragRef.current = null;
              }}
            >
              <div className="flex items-center justify-center mb-1 text-gray-400 text-[10px] leading-none tracking-widest cursor-grab" aria-label="Drag to reposition">
                ⠿
              </div>
              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => setChoroplethMetric("affordability")}
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    choroplethMetric === "affordability"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  % Can Afford
                </button>
                <button
                  onClick={() => setChoroplethMetric("percentile")}
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    choroplethMetric === "percentile"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  MSA Percentile
                </button>
              </div>
              <div className="flex items-center gap-0.5">
                {[
                  { color: "#d73027", label: "0" },
                  { color: "#fc8d59", label: "20" },
                  { color: "#fee08b", label: "40" },
                  { color: "#91cf60", label: "60" },
                  { color: "#1a9850", label: "80" },
                ].map((item) => (
                  <div key={item.color} className="flex flex-col items-center">
                    <div
                      className="w-6 h-3"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-[10px] text-gray-600 mt-0.5">
                      {item.label}%
                    </span>
                  </div>
                ))}
                <span className="text-[10px] text-gray-600 ml-0.5">100%</span>
              </div>
              <div className="text-[10px] text-gray-500 mt-1 leading-tight">
                {choroplethMetric === "affordability"
                  ? `% of households that can afford the ${BEDROOM_LABELS[bedrooms]} Small Area Fair Market Rent`
                  : `Affordability percentile among all census tracts in the ${choroplethData.cbsaName} metro area`}
              </div>
            </div>
          )}
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
