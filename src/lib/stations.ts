// A gas station from OpenStreetMap. Shared shape for the map, distance
// calculation, prices, and ranking.
export type Station = {
  id: string; // OSM id, e.g. "node/123" or "way/456"
  name: string;
  brand: string | null;
  lat: number;
  lng: number;
  address: string | null;
  fuels: string[]; // from OSM "fuel:*=yes" tags, e.g. ["diesel", "octane_91"]; often empty
  prices?: StationPrices; // from GasBuddy; empty when there are no prices
};

export type GasFuel = "regular" | "midgrade" | "premium" | "diesel" | "e85";

// Per gallon; `cash` marks a cash-only price. A fuel is missing if there's no price for it.
export type StationPrices = Partial<Record<GasFuel, { price: number; cash: boolean }>>;

// Display order.
export const GAS_FUELS: GasFuel[] = ["regular", "midgrade", "premium", "diesel", "e85"];

export const GAS_FUEL_LABELS: Record<GasFuel, string> = {
  regular: "Regular",
  midgrade: "Midgrade",
  premium: "Premium",
  diesel: "Diesel",
  e85: "E85",
};

export function hasPrices(station: Station) {
  return Object.keys(station.prices ?? {}).length > 0;
}

export const SEARCH_RADIUS_MILES = 10;
