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
};

export const SEARCH_RADIUS_MILES = 15;
