import type { LatLng } from "./location";
import type { Station } from "./stations";

// UI-only activation, tied to the exact successful result array.
export type StationSelection = {
  stationId: string;
  stations: readonly Station[];
  activation: number;
};

export function hasStationCoordinates(point: Partial<LatLng> | null | undefined): point is LatLng {
  const lat = point?.lat;
  const lng = point?.lng;
  return typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function resolveStationSelection(
  selection: StationSelection | null,
  stations: readonly Station[]
): Station | null {
  if (!selection || selection.stations !== stations) return null;
  const station = stations.find((item) => item.id === selection.stationId);
  return station && hasStationCoordinates(station) ? station : null;
}

type MarkerTarget = { getPopup(): unknown; openPopup(): unknown };
type MapTarget = { panTo(center: LatLng, options: { animate: boolean }): unknown };

// Small testable adapter: no zoom change, timers, DOM lookup, or network requests.
export function focusStationSelection(
  selection: StationSelection | null,
  stations: readonly Station[],
  markers: ReadonlyMap<string, MarkerTarget>,
  map: MapTarget
): Station | null {
  const station = resolveStationSelection(selection, stations);
  if (!station) return null;
  const marker = markers.get(station.id);
  if (!marker?.getPopup()) return null;
  // Instant panning avoids motion and lets popup auto-pan use the settled center.
  map.panTo({ lat: station.lat, lng: station.lng }, { animate: false });
  marker.openPopup();
  return station;
}
