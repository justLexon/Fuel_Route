import type { LatLng } from "./location";

const EARTH_RADIUS_MILES = 3958.7613;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

function validCoordinates(point: LatLng | null | undefined): point is LatLng {
  return Boolean(
    point && Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
  );
}

// Great-circle distance, not a driving route. Invalid coordinates have no distance.
export function straightLineMiles(
  from: LatLng | null | undefined,
  to: LatLng | null | undefined
): number | null {
  if (!validCoordinates(from) || !validCoordinates(to)) return null;
  const latitudeDelta = radians(to.lat - from.lat);
  const longitudeDelta = radians(to.lng - from.lng);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) *
    Math.sin(longitudeDelta / 2) ** 2;
  // Clamp floating-point rounding at antipodal points.
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
