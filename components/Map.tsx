"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useEffect, useRef, useMemo, useCallback } from "react";
import * as topojsonClient from "topojson-client";
import { computeAffordabilityPct } from "@/lib/bracket-math";
import type { ChoroplethResponse } from "@/app/page";
import type { Topology } from "topojson-specification";

// Fix default marker icon issue with webpack
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = defaultIcon;

interface MapProps {
  center: [number, number];
  markerPosition: [number, number] | null;
  markerLabel?: string;
  onMapClick?: (lat: number, lng: number) => void;
  choroplethData?: ChoroplethResponse | null;
  choroplethLoading?: boolean;
  bedroomIndex?: number;
  searchedTractFips?: string;
  fallbackFmr?: number[] | null;
  choroplethMetric?: "affordability" | "percentile";
}

// Color scale: 5-class diverging red → green
const COLOR_STOPS = [
  { threshold: 0, color: "#d73027" },
  { threshold: 20, color: "#fc8d59" },
  { threshold: 40, color: "#fee08b" },
  { threshold: 60, color: "#91cf60" },
  { threshold: 80, color: "#1a9850" },
];

function getColor(value: number | null): string {
  if (value === null) return "#cccccc";
  for (let i = COLOR_STOPS.length - 1; i >= 0; i--) {
    if (value >= COLOR_STOPS[i].threshold) return COLOR_STOPS[i].color;
  }
  return COLOR_STOPS[0].color;
}

interface TractMetrics {
  affordability: number;
  percentile: number;
}

function FlyToMarker({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(position, 14, { duration: 1.5 });
  }, [map, position]);
  return null;
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

interface ChoroplethLayerProps {
  geojson: GeoJSON.FeatureCollection;
  tractMetrics: Map<string, TractMetrics>;
  metric: "affordability" | "percentile";
  searchedTractFips?: string;
  onTractClick?: (lat: number, lng: number) => void;
}

function ChoroplethLayer({ geojson, tractMetrics, metric, searchedTractFips, onTractClick }: ChoroplethLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  const styleFunction = useCallback((feature: GeoJSON.Feature | undefined) => {
    const geoid = feature?.properties?.GEOID;
    const metrics = geoid ? tractMetrics.get(geoid) : undefined;
    const value = metrics ? metrics[metric] : null;
    const isSearched = geoid === searchedTractFips;

    return {
      fillColor: getColor(value),
      weight: isSearched ? 3 : 0.5,
      opacity: 1,
      color: isSearched ? "#000000" : "#666666",
      fillOpacity: 0.6,
    };
  }, [tractMetrics, metric, searchedTractFips]);

  // Create/replace the GeoJSON layer when geometry changes (new MSA)
  useEffect(() => {
    const layer = L.geoJSON(geojson, {
      style: styleFunction,
      onEachFeature: (feature, featureLayer) => {
        const geoid = feature.properties?.GEOID;
        const metrics = geoid ? tractMetrics.get(geoid) : undefined;

        // Tooltip on hover
        featureLayer.on("mouseover", function (e) {
          const l = e.target;
          l.setStyle({ weight: 2, color: "#333" });
          l.bringToFront();

          if (metrics) {
            const tooltipContent = `Tract ${geoid}<br/>Can afford SAFMR: ${metrics.affordability}%<br/>MSA percentile: ${metrics.percentile}%`;
            l.bindTooltip(tooltipContent).openTooltip();
          }
        });
        featureLayer.on("mouseout", function (e) {
          layer.resetStyle(e.target);
        });

        // Click → trigger lookup
        if (onTractClick) {
          featureLayer.on("click", function (e) {
            L.DomEvent.stopPropagation(e);
            const center = (e.target as L.Layer & { getBounds: () => L.LatLngBounds }).getBounds().getCenter();
            onTractClick(center.lat, center.lng);
          });
        }
      },
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
    };
    // geojson identity is stable per MSA; tractMetrics/metric can change
    // but we recreate to rebind event handlers with fresh metric data
  }, [geojson, tractMetrics, metric, searchedTractFips, map, onTractClick, styleFunction]);

  return null;
}

export default function MapComponent({
  center,
  markerPosition,
  markerLabel,
  onMapClick,
  choroplethData,
  bedroomIndex = 2,
  searchedTractFips,
  fallbackFmr,
  choroplethMetric = "affordability",
}: MapProps) {
  // Compute tract metrics client-side
  const { geojson, tractMetrics } = useMemo(() => {
    if (!choroplethData?.geo || !choroplethData?.tracts) {
      return { geojson: null, tractMetrics: new Map<string, TractMetrics>() };
    }

    // Convert TopoJSON → GeoJSON
    const topo = choroplethData.geo as Topology;
    const objectKey = Object.keys(topo.objects)[0];
    if (!objectKey) return { geojson: null, tractMetrics: new Map<string, TractMetrics>() };
    const fc = topojsonClient.feature(topo, topo.objects[objectKey]) as GeoJSON.FeatureCollection;

    // Build a map of tract GEOID → metrics
    const metrics = new Map<string, TractMetrics>();
    const allPcts: { geoid: string; pct: number }[] = [];

    for (const tract of choroplethData.tracts) {
      const [geoid, totalHH, brackets, safmrArray] = tract;

      // Use tract's own SAFMR if available, otherwise fall back to metro-level FMR
      const fmrArray = safmrArray ?? fallbackFmr;
      if (!fmrArray) continue;

      const fmr = fmrArray[bedroomIndex];
      if (!fmr) continue;

      const threshold = (fmr * 12) / 0.3;
      const pct = computeAffordabilityPct(threshold, totalHH, brackets);
      allPcts.push({ geoid, pct });
    }

    // Sort for percentile computation
    const sorted = [...allPcts].sort((a, b) => a.pct - b.pct);
    const n = sorted.length;

    // Build rank map: for each unique pct value, count how many are below
    // Use binary search for efficiency
    for (const item of allPcts) {
      // Count how many tracts have a strictly lower affordability %
      let lo = 0, hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].pct < item.pct) lo = mid + 1;
        else hi = mid;
      }
      const belowCount = lo;
      const percentile = n > 0 ? Math.round((belowCount / n) * 1000) / 10 : 0;

      metrics.set(item.geoid, {
        affordability: item.pct,
        percentile,
      });
    }

    return { geojson: fc, tractMetrics: metrics };
  }, [choroplethData, bedroomIndex, fallbackFmr]);

  return (
    <MapContainer
      center={center}
      zoom={5}
      className="h-full w-full"
      scrollWheelZoom={true}
      preferCanvas={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {onMapClick && <MapClickHandler onClick={onMapClick} />}
      {geojson && tractMetrics.size > 0 && (
        <ChoroplethLayer
          geojson={geojson}
          tractMetrics={tractMetrics}
          metric={choroplethMetric}
          searchedTractFips={searchedTractFips}
          onTractClick={onMapClick}
        />
      )}
      {markerPosition && (
        <>
          <FlyToMarker position={markerPosition} />
          <Marker position={markerPosition} zIndexOffset={1000}>
            {markerLabel && <Popup>{markerLabel}</Popup>}
          </Marker>
        </>
      )}
    </MapContainer>
  );
}
