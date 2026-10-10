"use client";

import "leaflet/dist/leaflet.css";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLng } from "@/lib/location";
import type { Station } from "@/lib/stations";

// Middle of the US, shown before we know where the user is.
const DEFAULT_CENTER: LatLng = { lat: 39.8283, lng: -98.5795 };
const DEFAULT_ZOOM = 4;
const LOCATION_ZOOM = 11;

// MapContainer only reads `center` once, so this moves the map
// whenever the location changes.
function Recenter({ location }: { location: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView(location, LOCATION_ZOOM);
  }, [map, location]);
  return null;
}

export default function LocationMap({
  location,
  stations,
}: {
  location: LatLng | null;
  stations: Station[];
}) {
  return (
    <MapContainer
      center={location ?? DEFAULT_CENTER}
      zoom={location ? LOCATION_ZOOM : DEFAULT_ZOOM}
      // Draw markers on a canvas instead of as separate elements; much faster with thousands of stations.
      preferCanvas
      // isolation keeps Leaflet's high z-indexes (up to 1000) from covering modals
      style={{ height: 400, width: "100%", borderRadius: 8, isolation: "isolate" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {stations.map((station) => (
        <CircleMarker
          key={station.id}
          center={station}
          radius={6}
          pathOptions={{ color: "#fd7e14", fillOpacity: 0.8 }}
        >
          <Popup>
            <strong>{station.name}</strong>
            {station.address && (
              <>
                <br />
                {station.address}
              </>
            )}
          </Popup>
        </CircleMarker>
      ))}

      {location && (
        <>
          <Recenter location={location} />
          <CircleMarker center={location} radius={10} pathOptions={{ color: "#228be6" }}>
            <Popup>You are here</Popup>
          </CircleMarker>
        </>
      )}
    </MapContainer>
  );
}
