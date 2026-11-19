import {
  FUEL_TYPES,
  type ProcessedStation,
  type RankedStation,
  type SortMode,
} from "../../src/lib/processing";
import { rankStations } from "../../src/lib/processedStationRanking";
import type {
  CompletedBatchDispatch,
} from "./dispatchBatches";

const KNOWN_FUEL_TYPES = new Set<string>(
  FUEL_TYPES.filter(
    (fuelType) => fuelType !== "unknown"
  )
);

export type AggregatedBatchResults = {
  stations: RankedStation[];
  invalidResultCount: number;
  incompatibleResultCount: number;
  duplicateStationIds: string[];
  missingStationIds: string[];
};

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isStringArray(
  value: unknown
): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string"
    )
  );
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isValidPrice(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.fuelType !== "string" ||
    !KNOWN_FUEL_TYPES.has(value.fuelType) ||
    typeof value.centsPerGallon !== "number" ||
    !Number.isFinite(value.centsPerGallon) ||
    value.centsPerGallon <= 0 ||
    typeof value.source !== "string" ||
    !value.source.trim()
  ) {
    return false;
  }

  return (
    value.observedAt === null ||
    (typeof value.observedAt === "string" &&
      Number.isFinite(Date.parse(value.observedAt)))
  );
}

function isValidProcessedStation(
  value: unknown
): value is ProcessedStation {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !isNullableString(value.brand) ||
    typeof value.lat !== "number" ||
    !Number.isFinite(value.lat) ||
    value.lat < -90 ||
    value.lat > 90 ||
    typeof value.lng !== "number" ||
    !Number.isFinite(value.lng) ||
    value.lng < -180 ||
    value.lng > 180 ||
    !isNullableString(value.address) ||
    !isStringArray(value.fuels) ||
    (value.unavailableFuels !== undefined &&
      !isStringArray(value.unavailableFuels))
  ) {
    return false;
  }

  if (
    value.distanceMiles !== null &&
    (typeof value.distanceMiles !== "number" ||
      !Number.isFinite(value.distanceMiles) ||
      value.distanceMiles < 0)
  ) {
    return false;
  }

  if (
    value.fuelCompatibility !== "compatible" &&
    value.fuelCompatibility !== "incompatible" &&
    value.fuelCompatibility !== "unknown"
  ) {
    return false;
  }

  return isValidPrice(value.price);
}

export function aggregateBatchResults(
  jobId: string,
  expectedStationIds: readonly string[],
  completedBatches:
    readonly CompletedBatchDispatch[],
  sortBy: SortMode = "best"
): AggregatedBatchResults {
  const normalizedJobId = jobId.trim();

  if (!normalizedJobId) {
    throw new Error("jobId is required.");
  }

  const expectedIds = new Set(
    expectedStationIds
  );

  if (expectedIds.size !== expectedStationIds.length) {
    throw new Error(
      "Expected station IDs must be unique."
    );
  }

  const returnedIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const validStations: ProcessedStation[] = [];

  let invalidResultCount = 0;
  let incompatibleResultCount = 0;

  for (const completedBatch of completedBatches) {
    const response = completedBatch.response;

    if (
      response.jobId !== normalizedJobId ||
      response.batchId !== completedBatch.batchId
    ) {
      invalidResultCount +=
        response.stations.length;
      continue;
    }

    for (
      const candidate of response.stations as
        readonly unknown[]
    ) {
      if (
        !isValidProcessedStation(candidate) ||
        !expectedIds.has(candidate.id)
      ) {
        invalidResultCount += 1;
        continue;
      }

      if (returnedIds.has(candidate.id)) {
        duplicateIds.add(candidate.id);
        continue;
      }

      returnedIds.add(candidate.id);

      if (
        candidate.fuelCompatibility ===
        "incompatible"
      ) {
        incompatibleResultCount += 1;
        continue;
      }

      validStations.push(candidate);
    }
  }

  return {
    stations: rankStations(
      validStations,
      sortBy
    ),
    invalidResultCount,
    incompatibleResultCount,
    duplicateStationIds: [...duplicateIds],
    missingStationIds: expectedStationIds.filter(
      (stationId) => !returnedIds.has(stationId)
    ),
  };
}