import {
  FUEL_TYPES,
  type FuelType,
  type KnownFuelType,
  type WorkerBatchRequest,
} from "../../src/lib/processing";

export const MAX_STATIONS_PER_BATCH = 500;
export const MAX_PRICES_PER_STATION = 50;

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function isNullableString(
  value: unknown
): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function validCoordinates(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const { lat, lng } = value;

  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    Math.abs(lng) <= 180
  );
}

function isFuelType(value: unknown): value is FuelType {
  return (
    typeof value === "string" &&
    FUEL_TYPES.includes(value as FuelType)
  );
}

function isKnownFuelType(
  value: unknown
): value is KnownFuelType {
  return isFuelType(value) && value !== "unknown";
}

function stationError(
  value: unknown,
  index: number
): string | null {
  const path = `stations[${index}]`;

  if (!isRecord(value)) {
    return `${path} must be an object.`;
  }
  if (!isNonEmptyString(value.id)) {
    return `${path}.id must be a non-empty string.`;
  }
  if (typeof value.name !== "string") {
    return `${path}.name must be a string.`;
  }
  if (!isNullableString(value.brand)) {
    return `${path}.brand must be a string or null.`;
  }
  if (!validCoordinates(value)) {
    return `${path} must contain valid lat/lng coordinates.`;
  }
  if (!isNullableString(value.address)) {
    return `${path}.address must be a string or null.`;
  }
  if (!isStringArray(value.fuels)) {
    return `${path}.fuels must be an array of strings.`;
  }
  if (
    value.unavailableFuels !== undefined &&
    !isStringArray(value.unavailableFuels)
  ) {
    return `${path}.unavailableFuels must be an array of strings.`;
  }

  return null;
}

function priceError(
  value: unknown,
  path: string
): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object.`;
  }
  if (!isKnownFuelType(value.fuelType)) {
    return `${path}.fuelType must be a known fuel type.`;
  }
  if (
    typeof value.centsPerGallon !== "number" ||
    !Number.isFinite(value.centsPerGallon) ||
    value.centsPerGallon <= 0
  ) {
    return `${path}.centsPerGallon must be a positive finite number.`;
  }
  if (!isNonEmptyString(value.source)) {
    return `${path}.source must be a non-empty string.`;
  }
  if (
    value.observedAt !== null &&
    (
      typeof value.observedAt !== "string" ||
      !Number.isFinite(Date.parse(value.observedAt))
    )
  ) {
    return `${path}.observedAt must be null or a valid date string.`;
  }

  return null;
}

function pricesError(value: unknown): string | null {
  if (value === undefined) return null;

  if (!isRecord(value)) {
    return "pricesByStationId must be an object.";
  }

  for (const [stationId, prices] of Object.entries(value)) {
    if (!isNonEmptyString(stationId)) {
      return "pricesByStationId keys must be non-empty station IDs.";
    }
    if (!Array.isArray(prices)) {
      return `pricesByStationId.${stationId} must be an array.`;
    }
    if (prices.length > MAX_PRICES_PER_STATION) {
      return (
        `pricesByStationId.${stationId} cannot contain more than ` +
        `${MAX_PRICES_PER_STATION} prices.`
      );
    }

    for (let index = 0; index < prices.length; index += 1) {
      const error = priceError(
        prices[index],
        `pricesByStationId.${stationId}[${index}]`
      );

      if (error) return error;
    }
  }

  return null;
}

export function validateWorkerBatchRequest(
  value: unknown
): ValidationResult<WorkerBatchRequest> {
  if (!isRecord(value)) {
    return {
      success: false,
      error: "Request body must be an object.",
    };
  }

  if (!isNonEmptyString(value.jobId)) {
    return {
      success: false,
      error: "jobId must be a non-empty string.",
    };
  }

  if (!isNonEmptyString(value.batchId)) {
    return {
      success: false,
      error: "batchId must be a non-empty string.",
    };
  }

  if (!validCoordinates(value.userLocation)) {
    return {
      success: false,
      error:
        "userLocation must contain valid lat/lng coordinates.",
    };
  }

  if (!isFuelType(value.requiredFuel)) {
    return {
      success: false,
      error: "requiredFuel is invalid.",
    };
  }

  if (!Array.isArray(value.stations)) {
    return {
      success: false,
      error: "stations must be an array.",
    };
  }

  if (value.stations.length > MAX_STATIONS_PER_BATCH) {
    return {
      success: false,
      error:
        `stations cannot contain more than ` +
        `${MAX_STATIONS_PER_BATCH} entries.`,
    };
  }

  const stationIds = new Set<string>();

  for (
    let index = 0;
    index < value.stations.length;
    index += 1
  ) {
    const station = value.stations[index];
    const error = stationError(station, index);

    if (error) {
      return { success: false, error };
    }

    const stationId =
      (station as UnknownRecord).id as string;

    if (stationIds.has(stationId)) {
      return {
        success: false,
        error:
          `stations contains duplicate ID: ${stationId}.`,
      };
    }

    stationIds.add(stationId);
  }

  const priceValidationError = pricesError(
    value.pricesByStationId
  );

  if (priceValidationError) {
    return {
      success: false,
      error: priceValidationError,
    };
  }

  return {
    success: true,
    data: value as WorkerBatchRequest,
  };
}