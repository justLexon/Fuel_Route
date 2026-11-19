import { straightLineMiles } from "./distance";
import type { LatLng } from "./location";
import type { GasFuel, Station } from "./stations";

export type SortMode = "best" | "cheapest" | "closest";

// Used to compare stations by the cost of a typical fill-up, including the gas
// burned driving there and back.
export const FILL_UP_GALLONS = 12;
export const DEFAULT_MPG = 25; // when no vehicle is selected or its MPG is unknown

export type RankedStation = {
  station: Station;
  price: number | null; // per gallon for the chosen fuel
  distanceMiles: number | null; // straight line from the search location
  fillUpCost: number | null; // FILL_UP_GALLONS plus the round trip, at this station's price
};

// Ranks stations for one fuel type.
// - best: lowest fill-up cost, so a slightly pricier station nearby can beat a
//   cheap one far away
// - cheapest: lowest price per gallon
// - closest: shortest distance
// Stations without a price for `fuel` are left out. If no station has one
// (e.g. prices are unavailable), every station is returned, closest first.
export function rankStations(
  stations: Station[],
  center: LatLng,
  fuel: GasFuel,
  mpg: number | null,
  sort: SortMode
): RankedStation[] {
  const milesPerGallon = mpg && mpg > 0 ? mpg : DEFAULT_MPG;

  const ranked = stations.map((station): RankedStation => {
    const price = station.prices?.[fuel]?.price ?? null;
    const distanceMiles = straightLineMiles(center, station);
    const fillUpCost =
      price !== null && distanceMiles !== null
        ? price * (FILL_UP_GALLONS + (2 * distanceMiles) / milesPerGallon)
        : null;
    return { station, price, distanceMiles, fillUpCost };
  });

  const priced = ranked.filter((entry) => entry.price !== null);
  if (priced.length === 0) {
    return ranked.sort((a, b) => compare(a.distanceMiles, b.distanceMiles));
  }

  return priced.sort((a, b) => {
    switch (sort) {
      case "best":
        return compare(a.fillUpCost, b.fillUpCost) || compare(a.distanceMiles, b.distanceMiles);
      case "cheapest":
        return compare(a.price, b.price) || compare(a.distanceMiles, b.distanceMiles);
      case "closest":
        return compare(a.distanceMiles, b.distanceMiles) || compare(a.price, b.price);
    }
  });
}

// Ascending, with missing values last.
function compare(a: number | null, b: number | null) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}
