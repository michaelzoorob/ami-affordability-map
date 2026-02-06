"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";

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
}

function FlyToMarker({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(position, 14, { duration: 1.5 });
  }, [map, position]);
  return null;
}

export default function Map({ center, markerPosition, markerLabel }: MapProps) {
  return (
    <MapContainer
      center={center}
      zoom={5}
      className="h-full w-full"
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {markerPosition && (
        <>
          <FlyToMarker position={markerPosition} />
          <Marker position={markerPosition}>
            {markerLabel && <Popup>{markerLabel}</Popup>}
          </Marker>
        </>
      )}
    </MapContainer>
  );
}
