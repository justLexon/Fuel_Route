// A gas station: location and prices from GasBuddy, plus name, brand and address
// from OpenStreetMap when it has the station (see mergeStations). The id is
// "gasbuddy/<id>" for GasBuddy stations, and the OSM id ("node/123") for OSM
// stations GasBuddy doesn't have (those have no prices). Shared shape for
// the map, distance calculation, prices, and ranking.
export type Station = {
  id: string;
  name: string;
  brand: string | null;
  lat: number;
  lng: number;
  address: string | null;
  fuels: string[];
  unavailableFuels?: string[];
  prices?: StationPrices;
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
