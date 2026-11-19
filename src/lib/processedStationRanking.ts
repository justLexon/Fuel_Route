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