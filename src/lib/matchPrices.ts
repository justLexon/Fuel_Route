import { straightLineMiles } from "./distance";
import type { GasBuddyStation } from "./gasbuddy";
import type { Station } from "./stations";

// GasBuddy and OpenStreetMap place the same station within a few dozen meters,
// so anything farther than this is treated as a different station.
const MAX_MATCH_MILES = 0.06; // ~100 m

// Gives each OpenStreetMap station the prices of the closest GasBuddy station
// within MAX_MATCH_MILES. Stations with no match get no prices.
export function attachPrices(stations: Station[], gasBuddyStations: GasBuddyStation[]): Station[] {
  return stations.map((station) => {
    let closest: GasBuddyStation | null = null;
    let closestMiles = MAX_MATCH_MILES;

    for (const candidate of gasBuddyStations) {
      const miles = straightLineMiles(station, candidate);
      if (miles !== null && miles <= closestMiles) {
        closest = candidate;
        closestMiles = miles;
      }
    }

    return { ...station, prices: closest?.prices ?? {} };
  });
}
