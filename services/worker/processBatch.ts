import { straightLineMiles } from "../../src/lib/distance";
import { determineFuelCompatibility } from "../../src/lib/fuelCompatibility";
import type {
  FuelType,
  StationPrice,
  WorkerBatchRequest,
  WorkerBatchResponse,
} from "../../src/lib/processing";

type Clock = () => number;

function validPrice(price: StationPrice): boolean {
  return (
    Number.isFinite(price.centsPerGallon) &&
    price.centsPerGallon > 0
  );
}

function observationTime(price: StationPrice): number {
  if (!price.observedAt) return Number.NEGATIVE_INFINITY;

  const timestamp = Date.parse(price.observedAt);
  return Number.isFinite(timestamp)
    ? timestamp
    : Number.NEGATIVE_INFINITY;
}

export function selectStationPrice(
  requiredFuel: FuelType,
  prices: readonly StationPrice[]
): StationPrice | null {
  if (requiredFuel === "unknown") return null;

  let selected: StationPrice | null = null;
  let selectedTime = Number.NEGATIVE_INFINITY;

  for (const price of prices) {
    if (
      price.fuelType !== requiredFuel ||
      !validPrice(price)
    ) {
      continue;
    }

    const timestamp = observationTime(price);

    if (!selected || timestamp > selectedTime) {
      selected = price;
      selectedTime = timestamp;
    }
  }

  return selected ? { ...selected } : null;
}

function elapsedMilliseconds(
  startedAt: number,
  finishedAt: number
): number {
  const elapsed = finishedAt - startedAt;

  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Number(elapsed.toFixed(3));
}

export function processWorkerBatch(
  request: WorkerBatchRequest,
  workerId: string,
  clock: Clock = () => performance.now()
): WorkerBatchResponse {
  const startedAt = clock();

  const stations = request.stations.map((station) => ({
    ...station,
    distanceMiles: straightLineMiles(
      request.userLocation,
      station
    ),
    fuelCompatibility: determineFuelCompatibility(
      request.requiredFuel,
      station.fuels,
      station.unavailableFuels ?? []
    ),
    price: selectStationPrice(
      request.requiredFuel,
      request.pricesByStationId?.[station.id] ?? []
    ),
  }));

  return {
    jobId: request.jobId,
    batchId: request.batchId,
    workerId,
    stations,
    processingTimeMs: elapsedMilliseconds(
      startedAt,
      clock()
    ),
  };
}