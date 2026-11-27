import type {
  CoordinatorRequest,
  ProcessingMode,
  SortMode,
} from "../../src/lib/processing";
import {
  MAX_STATIONS_PER_BATCH,
  validateWorkerBatchRequest,
  type ValidationResult,
} from "../worker/validateRequest";

export const MAX_COORDINATOR_STATIONS = 5_000;

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isSortMode(
  value: unknown
): value is SortMode {
  return (
    value === "best" ||
    value === "cheapest" ||
    value === "closest"
  );
}

function isProcessingMode(
  value: unknown
): value is ProcessingMode {
  return (
    value === "single" ||
    value === "distributed"
  );
}

function adjustStationIndexes(
  error: string,
  offset: number
): string {
  if (offset === 0) {
    return error;
  }

  return error.replace(
    /stations\[(\d+)\]/g,
    (_match, index: string) =>
      `stations[${offset + Number(index)}]`
  );
}

export function validateCoordinatorRequest(
  value: unknown
): ValidationResult<CoordinatorRequest> {
  if (!isRecord(value)) {
    return {
      success: false,
      error: "Request body must be an object.",
    };
  }

  if (!Array.isArray(value.stations)) {
    return {
      success: false,
      error: "stations must be an array.",
    };
  }

  if (
    value.stations.length >
    MAX_COORDINATOR_STATIONS
  ) {
    return {
      success: false,
      error:
        `stations cannot contain more than ` +
        `${MAX_COORDINATOR_STATIONS} entries.`,
    };
  }

  if (
    value.sortBy !== undefined &&
    !isSortMode(value.sortBy)
  ) {
    return {
      success: false,
      error:
        "sortBy must be best, cheapest, or closest.",
    };
  }

  if (
    value.mode !== undefined &&
    !isProcessingMode(value.mode)
  ) {
    return {
      success: false,
      error:
        "mode must be single or distributed.",
    };
  }

  if (
    isRecord(value.pricesByStationId) &&
    Object.keys(value.pricesByStationId).length >
      MAX_COORDINATOR_STATIONS
  ) {
    return {
      success: false,
      error:
        `pricesByStationId cannot contain more than ` +
        `${MAX_COORDINATOR_STATIONS} station entries.`,
    };
  }

  const validatedStations:
    CoordinatorRequest["stations"][number][] = [];

  let validatedBase:
    | {
        userLocation:
          CoordinatorRequest["userLocation"];
        requiredFuel:
          CoordinatorRequest["requiredFuel"];
        pricesByStationId:
          CoordinatorRequest["pricesByStationId"];
      }
    | undefined;

  const iterationLength = Math.max(
    value.stations.length,
    1
  );

  for (
    let offset = 0;
    offset < iterationLength;
    offset += MAX_STATIONS_PER_BATCH
  ) {
    const stations = value.stations.slice(
      offset,
      offset + MAX_STATIONS_PER_BATCH
    );

    const workerValidation =
      validateWorkerBatchRequest({
        jobId: "coordinator-validation",
        batchId:
          `coordinator-validation-${offset}`,
        userLocation: value.userLocation,
        requiredFuel: value.requiredFuel,
        stations,
        ...(offset === 0 &&
        value.pricesByStationId !== undefined
          ? {
              pricesByStationId:
                value.pricesByStationId,
            }
          : {}),
      });

    if (!workerValidation.success) {
      return {
        success: false,
        error: adjustStationIndexes(
          workerValidation.error,
          offset
        ),
      };
    }

    if (!validatedBase) {
      validatedBase = {
        userLocation:
          workerValidation.data.userLocation,
        requiredFuel:
          workerValidation.data.requiredFuel,
        pricesByStationId:
          workerValidation.data.pricesByStationId,
      };
    }

    validatedStations.push(
      ...workerValidation.data.stations
    );
  }

  const stationIds = new Set<string>();

  for (const station of validatedStations) {
    if (stationIds.has(station.id)) {
      return {
        success: false,
        error:
          "stations must not contain duplicate station IDs.",
      };
    }

    stationIds.add(station.id);
  }

  if (validatedBase?.pricesByStationId) {
    for (
      const stationId of Object.keys(
        validatedBase.pricesByStationId
      )
    ) {
      if (!stationIds.has(stationId)) {
        return {
          success: false,
          error:
            `pricesByStationId contains unknown ` +
            `station ID: ${stationId}.`,
        };
      }
    }
  }

  return {
    success: true,
    data: {
      userLocation: validatedBase!.userLocation,
      requiredFuel: validatedBase!.requiredFuel,
      stations: validatedStations,
      ...(validatedBase!.pricesByStationId
        ? {
            pricesByStationId:
              validatedBase!.pricesByStationId,
          }
        : {}),
      ...(value.sortBy !== undefined
        ? { sortBy: value.sortBy as SortMode }
        : {}),
      ...(value.mode !== undefined
        ? { mode: value.mode as ProcessingMode }
        : {}),
    },
  };
}