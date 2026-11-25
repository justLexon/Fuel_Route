import type { LatLng } from "./location";
import type {
  CoordinatorRequest,
  FuelType,
  PricesByStationId,
  ProcessingMode,
  SortMode,
  StationPrice,
} from "./processing";
import {
  GAS_FUELS,
  type Station,
} from "./stations";

export type CoordinatorRequestInput = {
  userLocation: LatLng;
  requiredFuel: FuelType;
  stations: readonly Station[];
  sortBy?: SortMode;
  mode?: ProcessingMode;
};

export function createPricesByStationId(
  stations: readonly Station[]
): PricesByStationId {
  const pricesByStationId: Record<
    string,
    StationPrice[]
  > = {};

  for (const station of stations) {
    const stationPrices: StationPrice[] = [];

    for (const fuelType of GAS_FUELS) {
      const price = station.prices?.[fuelType]?.price;

      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        continue;
      }

      stationPrices.push({
        fuelType,
        centsPerGallon: Math.round(price * 100),
        source: "gasbuddy",
        observedAt: null,
      });
    }

    if (stationPrices.length > 0) {
      pricesByStationId[station.id] = stationPrices;
    }
  }

  return pricesByStationId;
}

export function createCoordinatorRequest(
  input: CoordinatorRequestInput
): CoordinatorRequest {
  const pricesByStationId =
    createPricesByStationId(input.stations);

  return {
    userLocation: input.userLocation,
    requiredFuel: input.requiredFuel,
    stations: input.stations,
    sortBy: input.sortBy ?? "best",
    mode: input.mode ?? "distributed",
    ...(Object.keys(pricesByStationId).length > 0
      ? { pricesByStationId }
      : {}),
  };
}