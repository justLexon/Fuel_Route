"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLng } from "@/lib/location";
import type { Station } from "@/lib/stations";
import { getStationDisplayName } from "@/lib/stationDisplay";
import styles from "./Dashboard.module.css";
import { focusStationSelection, hasStationCoordinates, type StationSelection } from "@/lib/stationSelection";

// Rendered after marker children, whose popup effects bind before this effect runs.
function FocusSelectedStation({ selection, stations, markers, onStationShown }: {
  selection: StationSelection | null;
  stations: Station[];
  markers: RefObject<Map<string, LeafletCircleMarker>>;
  onStationShown: (selection: StationSelection) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!selection) return;
    if (focusStationSelection(selection, stations, markers.current, map)) {
      onStationShown(selection);
    }
  }, [selection, stations, markers, map, onStationShown]);
  return null;
}

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
  selection,
  onStationShown,
}: {
  location: LatLng | null;
  stations: Station[];
  selection: StationSelection | null;
  onStationShown: (selection: StationSelection) => void;
}) {
  const markers = useRef(new Map<string, LeafletCircleMarker>());
  const markerStations = useMemo(() => {
    const seen = new Set<string>();
    return stations.filter((station) => {
      if (seen.has(station.id)) return false;
      seen.add(station.id);
      return hasStationCoordinates(station);
    });
  }, [stations]);
  return (
    <MapContainer
      center={location ?? DEFAULT_CENTER}
      zoom={location ? LOCATION_ZOOM : DEFAULT_ZOOM}
      // Draw markers on a canvas instead of as separate elements; much faster with thousands of stations.
      preferCanvas
      // isolation keeps Leaflet's high z-indexes (up to 1000) from covering modals
      className={styles.map}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {markerStations.map((station) => (
        <CircleMarker
          key={station.id}
          ref={(marker) => {
            if (marker) markers.current.set(station.id, marker);
            else markers.current.delete(station.id);
          }}
          center={station}
          radius={6}
          pathOptions={{ color: "#fd7e14", fillOpacity: 0.8 }}
        >
          <Popup>
            <strong>{getStationDisplayName(station)}</strong>
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
      <FocusSelectedStation
        selection={selection}
        stations={stations}
        markers={markers}
        onStationShown={onStationShown}
      />
    </MapContainer>
  );
}
