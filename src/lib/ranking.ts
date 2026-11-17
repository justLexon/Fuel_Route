<<<<<<< HEAD
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
=======
import type {
  ProcessedStation,
  RankedStation,
  SortMode,
} from "./processing";

const PRICE_WEIGHT = 0.6;
const DISTANCE_WEIGHT = 0.4;

type PreparedStation = {
  station: ProcessedStation;
  price: number | null;
  distance: number | null;
  overallScore: number | null;
};

type NumericRange = {
  minimum: number;
  maximum: number;
};

function validPrice(station: ProcessedStation): number | null {
  const price = station.price?.centsPerGallon;

  return typeof price === "number" &&
    Number.isFinite(price) &&
    price > 0
    ? price
    : null;
}

function validDistance(station: ProcessedStation): number | null {
  const distance = station.distanceMiles;

  return typeof distance === "number" &&
    Number.isFinite(distance) &&
    distance >= 0
    ? distance
    : null;
}

function numericRange(
  values: readonly (number | null)[]
): NumericRange | null {
  const validValues = values.filter(
    (value): value is number => value !== null
  );

  if (validValues.length === 0) return null;

  return {
    minimum: Math.min(...validValues),
    maximum: Math.max(...validValues),
  };
}

function normalizedValue(
  value: number | null,
  range: NumericRange
): number {
  if (value === null) return 1;
  if (range.maximum === range.minimum) return 0;

  return (
    (value - range.minimum) /
    (range.maximum - range.minimum)
  );
}

function calculateOverallScore(
  station: PreparedStation,
  priceRange: NumericRange | null,
  distanceRange: NumericRange | null
): number | null {
  let weightedScore = 0;
  let totalWeight = 0;

  if (priceRange) {
    weightedScore +=
      normalizedValue(station.price, priceRange) * PRICE_WEIGHT;
    totalWeight += PRICE_WEIGHT;
  }

  if (distanceRange) {
    weightedScore +=
      normalizedValue(station.distance, distanceRange) *
      DISTANCE_WEIGHT;
    totalWeight += DISTANCE_WEIGHT;
  }

  if (totalWeight === 0) return null;

  return Number((weightedScore / totalWeight).toFixed(6));
}

function compareNullableNumbers(
  left: number | null,
  right: number | null
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compatibilityOrder(station: ProcessedStation): number {
  return station.fuelCompatibility === "compatible" ? 0 : 1;
}

function comparePreparedStations(
  left: PreparedStation,
  right: PreparedStation,
  sortBy: SortMode
): number {
  const compatibilityDifference =
    compatibilityOrder(left.station) -
    compatibilityOrder(right.station);

  if (compatibilityDifference !== 0) {
    return compatibilityDifference;
  }

  if (sortBy === "cheapest") {
    return (
      compareNullableNumbers(left.price, right.price) ||
      compareNullableNumbers(left.distance, right.distance) ||
      left.station.id.localeCompare(right.station.id)
    );
  }

  if (sortBy === "closest") {
    return (
      compareNullableNumbers(left.distance, right.distance) ||
      compareNullableNumbers(left.price, right.price) ||
      left.station.id.localeCompare(right.station.id)
    );
  }

  return (
    compareNullableNumbers(
      left.overallScore,
      right.overallScore
    ) ||
    compareNullableNumbers(left.price, right.price) ||
    compareNullableNumbers(left.distance, right.distance) ||
    left.station.id.localeCompare(right.station.id)
  );
}

export function rankStations(
  stations: readonly ProcessedStation[],
  sortBy: SortMode = "best"
): RankedStation[] {
  const prepared: PreparedStation[] = stations
    .filter(
      (station) =>
        station.fuelCompatibility !== "incompatible"
    )
    .map((station) => ({
      station,
      price: validPrice(station),
      distance: validDistance(station),
      overallScore: null,
    }));

  const priceRange = numericRange(
    prepared.map((station) => station.price)
  );
  const distanceRange = numericRange(
    prepared.map((station) => station.distance)
  );

  if (sortBy === "best") {
    for (const station of prepared) {
      station.overallScore = calculateOverallScore(
        station,
        priceRange,
        distanceRange
      );
    }
  }

  prepared.sort((left, right) =>
    comparePreparedStations(left, right, sortBy)
  );

  return prepared.map((station, index) => ({
    ...station.station,
    rank: index + 1,
    overallScore:
      sortBy === "best" ? station.overallScore : null,
  }));
}
>>>>>>> 81dc2c1 (feat: add station processing core)
