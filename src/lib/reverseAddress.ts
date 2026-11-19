import { straightLineMiles } from "./distance";
import type { LatLng } from "./location";

// The `address` object from a Nominatim reverse lookup (addressdetails=1).
export type NominatimAddress = Partial<Record<string, string>>;

// Nominatim snaps to the nearest object it knows, which may be a neighboring
// building. Past this distance, its house number probably isn't the station's.
const HOUSE_NUMBER_MAX_MILES = 0.03; // about 50 m

// Formats a looked-up address like the OSM ones on the cards:
// "3755 Ambassador Caffery Parkway, Lafayette, LA, 70503".
// No street means no useful address, so it returns null.
export function formatReverseAddress(
  address: NominatimAddress,
  station: LatLng,
  found: LatLng
): string | null {
  const road = address.road?.trim();
  if (!road) return null;

  const distance = straightLineMiles(station, found);
  const nearby = distance !== null && distance <= HOUSE_NUMBER_MAX_MILES;
  const houseNumber = nearby ? address.house_number?.trim() : undefined;

  const city = address.city ?? address.town ?? address.village ?? address.hamlet ?? address.suburb;
  // "US-LA" -> "LA"; fall back to the full state name.
  const state = address["ISO3166-2-lvl4"]?.replace(/^US-/, "") ?? address.state;

  return [[houseNumber, road].filter(Boolean).join(" "), city, state, address.postcode]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}
