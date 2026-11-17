import type { Station } from "../../src/lib/stations";
import type {
  CoordinatorRequest,
  PricesByStationId,
  WorkerBatchRequest,
} from "../../src/lib/processing";
import { MAX_STATIONS_PER_BATCH } from "../worker/validateRequest";

function pricesForStations(
  stations: readonly Station[],
  pricesByStationId: PricesByStationId | undefined
): PricesByStationId | undefined {
  if (!pricesByStationId) {
    return undefined;
  }

  const selected: Record<
    string,
    PricesByStationId[string]
  > = {};

  for (const station of stations) {
    const prices = pricesByStationId[station.id];

    if (prices !== undefined) {
      selected[station.id] = prices;
    }
  }

  return selected;
}

export function createWorkerBatches(
  jobId: string,
  request: CoordinatorRequest,
  workerCount: number
): WorkerBatchRequest[] {
  const normalizedJobId = jobId.trim();

  if (!normalizedJobId) {
    throw new Error("jobId is required.");
  }

  if (
    !Number.isSafeInteger(workerCount) ||
    workerCount < 1
  ) {
    throw new Error(
      "workerCount must be a positive integer."
    );
  }

  const stationCount = request.stations.length;

  if (stationCount === 0) {
    return [];
  }

  const minimumBatchCount = Math.ceil(
    stationCount / MAX_STATIONS_PER_BATCH
  );

  const batchCount = Math.min(
    stationCount,
    Math.max(workerCount, minimumBatchCount)
  );

  const baseBatchSize = Math.floor(
    stationCount / batchCount
  );
  const largerBatchCount =
    stationCount % batchCount;

  const batches: WorkerBatchRequest[] = [];
  let startIndex = 0;

  for (let index = 0; index < batchCount; index += 1) {
    const batchSize =
      baseBatchSize +
      (index < largerBatchCount ? 1 : 0);

    const stations = request.stations.slice(
      startIndex,
      startIndex + batchSize
    );

    startIndex += batchSize;

    const pricesByStationId = pricesForStations(
      stations,
      request.pricesByStationId
    );

    batches.push({
      jobId: normalizedJobId,
      batchId: `${normalizedJobId}-batch-${index + 1}`,
      userLocation: request.userLocation,
      requiredFuel: request.requiredFuel,
      stations,
      ...(pricesByStationId
        ? { pricesByStationId }
        : {}),
    });
  }

  return batches;
}