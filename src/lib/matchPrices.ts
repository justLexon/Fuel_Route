import { straightLineMiles } from "./distance";
import type { GasBuddyStation } from "./gasbuddy";
import type { LatLng } from "./location";
import type { Station } from "./stations";

// GasBuddy and OpenStreetMap place the same station within a few dozen meters,
// so anything farther than this is treated as a different station.
const MAX_MATCH_MILES = 0.06; // ~100 m

// Name for a station GasBuddy knows about but OpenStreetMap doesn't (or Overpass
// was too busy to answer). GasBuddy's map data has no names or brands.
export const UNNAMED_STATION = "Gas station";

// Builds the station list from GasBuddy, which has every station's location and
// prices, and adds the name, brand, address and fuel tags from OpenStreetMap
// where an OSM station is within MAX_MATCH_MILES. Each station is matched at
// most once, closest pairs first.
// - osmStations null (Overpass busy): every GasBuddy station is unnamed.
// - gasBuddyStations null (GasBuddy failed): the OSM stations, without prices.
// OSM stations with no GasBuddy match are kept, without prices.
// GasBuddy stations keep the id "gasbuddy/<id>" whether or not they're matched,
// so a station's id doesn't depend on whether Overpass answered in time.
export function mergeStations(
  osmStations: Station[] | null,
  gasBuddyStations: GasBuddyStation[] | null,
  center: LatLng,
  radiusMiles: number
): Station[] {
  const osm = osmStations ?? [];
  if (gasBuddyStations === null) return osm.map((station) => ({ ...station, prices: {} }));

  // GasBuddy's map views cover more than the search radius.
  const nearby = gasBuddyStations.filter((station) => {
    const miles = straightLineMiles(center, station);
    return miles !== null && miles <= radiusMiles;
  });

  const pairs: { gasBuddy: number; osm: number; miles: number }[] = [];
  nearby.forEach((gasBuddyStation, g) => {
    osm.forEach((osmStation, o) => {
      const miles = straightLineMiles(gasBuddyStation, osmStation);
      if (miles !== null && miles <= MAX_MATCH_MILES) pairs.push({ gasBuddy: g, osm: o, miles });
    });
  });
  pairs.sort((a, b) => a.miles - b.miles);

  const osmFor = new Map<number, number>(); // GasBuddy index -> OSM index
  const matchedOsm = new Set<number>();
  for (const pair of pairs) {
    if (osmFor.has(pair.gasBuddy) || matchedOsm.has(pair.osm)) continue;
    osmFor.set(pair.gasBuddy, pair.osm);
    matchedOsm.add(pair.osm);
  }

  const fromGasBuddy = nearby.map((gasBuddyStation, g): Station => {
    const id = `gasbuddy/${gasBuddyStation.id}`;
    const o = osmFor.get(g);
    if (o !== undefined) return { ...osm[o], id, prices: gasBuddyStation.prices };
    return {
      id,
      name: UNNAMED_STATION,
      brand: null,
      lat: gasBuddyStation.lat,
      lng: gasBuddyStation.lng,
      address: null, // the station card looks one up from the coordinates
      fuels: [],
      prices: gasBuddyStation.prices,
    };
  });
  const unmatchedOsm = osm
    .filter((_, o) => !matchedOsm.has(o))
    .map((station) => ({ ...station, prices: {} }));

  return [...fromGasBuddy, ...unmatchedOsm];
}
