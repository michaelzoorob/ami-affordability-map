"use client";

import { IncomeBracket } from "@/lib/census-acs";

interface RawApiResponse {
  incomeThreshold: number;
  monthlyRent: number;
  percentCanAfford: number;
  householdsAboveThreshold: number;
  totalHouseholds: number;
  areaName: string;
  incomeLimitsBySize: number[];
  fmrByBedroom: number[];
  medianBySize: (number | null)[];
  brackets: IncomeBracket[];
  medianIncome: number;
  lat: number;
  lng: number;
  matchedAddress: string;
  stateFips: string;
  countyFips: string;
  tractFips: string;
  hudYear: string;
  fmrYear: string;
}

interface ComputedResult {
  incomeThreshold: number;
  monthlyRent: number;
  percentCanAfford: number;
  householdsAboveThreshold: number;
  totalHouseholds: number;
  sizeAdjustedAmi: number;
  tractMedian: number | null;
}

interface ResultsPanelProps {
  rawData: RawApiResponse | null;
  computed: ComputedResult | null;
  error: string | null;
  isLoading: boolean;
  householdSize: number;
  bedrooms: number;
  onHouseholdSizeChange: (size: number) => void;
  onBedroomsChange: (bedrooms: number) => void;
}

const BEDROOM_LABELS = ["Studio", "1 BR", "2 BR", "3 BR", "4 BR"];

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function ResultsPanel({
  rawData,
  computed,
  error,
  isLoading,
  householdSize,
  bedrooms,
  onHouseholdSizeChange,
  onBedroomsChange,
}: ResultsPanelProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    );
  }

  if (!rawData || !computed) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
        <p className="text-gray-500 text-sm">
          Search for an address to see AMI affordability data for its Census
          tract.
        </p>
      </div>
    );
  }

  const tractId = `${rawData.stateFips}${rawData.countyFips}${rawData.tractFips}`;

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          {rawData.matchedAddress}
        </h2>
        <p className="text-sm text-gray-500">
          Census Tract {tractId} &middot; {rawData.areaName}
        </p>
      </div>

      {/* Dropdowns */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="householdSize"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Household Size
          </label>
          <select
            id="householdSize"
            value={householdSize}
            onChange={(e) => onHouseholdSizeChange(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "person" : "persons"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="bedrooms"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            Bedroom Count
          </label>
          <select
            id="bedrooms"
            value={bedrooms}
            onChange={(e) => onBedroomsChange(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {BEDROOM_LABELS.map((label, i) => (
              <option key={i} value={i}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Fair Market Rent */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 rounded-lg p-4">
          <p className="text-xs text-green-600 font-medium uppercase tracking-wide">
            Fair Market Rent ({rawData.fmrYear})
          </p>
          <p className="text-2xl font-bold text-green-900">
            {formatCurrency(computed.monthlyRent)}
            <span className="text-sm font-normal">/mo</span>
          </p>
          <p className="text-xs text-green-600">
            {BEDROOM_LABELS[bedrooms]} unit
          </p>
        </div>

        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">
            Income Needed
          </p>
          <p className="text-2xl font-bold text-blue-900">
            {formatCurrency(Math.round(computed.incomeThreshold))}
          </p>
          <p className="text-xs text-blue-600">
            to afford FMR at 30% of income
          </p>
        </div>
      </div>

      {/* % who can afford */}
      <div className="bg-amber-50 rounded-lg p-4">
        <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">
          Households That Can Afford This Rent
        </p>
        <p className="text-3xl font-bold text-amber-900">
          {computed.percentCanAfford}%
        </p>
        <p className="text-xs text-amber-700">
          ~{computed.householdsAboveThreshold.toLocaleString()} of{" "}
          {computed.totalHouseholds.toLocaleString()} households in this tract
          earn {formatCurrency(Math.round(computed.incomeThreshold))} or more
        </p>
      </div>

      {/* Context: AMI and tract median */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-purple-50 rounded-lg p-4">
          <p className="text-xs text-purple-600 font-medium uppercase tracking-wide">
            100% AMI ({rawData.hudYear})
          </p>
          <p className="text-xl font-bold text-purple-900">
            {formatCurrency(computed.sizeAdjustedAmi)}
          </p>
          <p className="text-xs text-purple-600">
            {householdSize}-person household
          </p>
        </div>

        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-xs text-gray-600 font-medium uppercase tracking-wide">
            Tract Median Income
          </p>
          <p className="text-xl font-bold text-gray-900">
            {computed.tractMedian !== null
              ? formatCurrency(computed.tractMedian)
              : "N/A"}
          </p>
          <p className="text-xs text-gray-600">
            {householdSize >= 7 ? "7+" : householdSize}-person households
            (B19019)
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Sources: HUD Income Limits ({rawData.hudYear}), HUD Fair Market Rents (
        {rawData.fmrYear}), ACS 5-Year Estimates (Tables B19001, B19019), Census
        Bureau Geocoder
      </p>
    </div>
  );
}
