import type { LatLng } from "./location";
import type { Station } from "./stations";

export const FUEL_TYPES = [
  "regular",
  "midgrade",
  "premium",
  "diesel",
  "e85",
  "cng",
  "lpg",
  "electric",
  "hydrogen",
  "unknown",
] as const;

export type FuelType = (typeof FUEL_TYPES)[number];
export type KnownFuelType = Exclude<FuelType, "unknown">;

export type FuelCompatibility =
  | "compatible"
  | "incompatible"
  | "unknown";

export type SortMode = "best" | "cheapest" | "closest";
export type ProcessingMode = "single" | "distributed";

export type StationPrice = {
  fuelType: KnownFuelType;
  centsPerGallon: number;
  source: string;
  observedAt: string | null;
};

export type PricesByStationId = Readonly<
  Record<string, readonly StationPrice[]>
>;

export type WorkerBatchRequest = {
  jobId: string;
  batchId: string;
  userLocation: LatLng;
  requiredFuel: FuelType;
  stations: readonly Station[];
  pricesByStationId?: PricesByStationId;
};

export type ProcessedStation = Station & {
  distanceMiles: number | null;
  fuelCompatibility: FuelCompatibility;
  price: StationPrice | null;
};

export type WorkerBatchResponse = {
  jobId: string;
  batchId: string;
  workerId: string;
  stations: ProcessedStation[];
  processingTimeMs: number;
};

export type RankedStation = ProcessedStation & {
  rank: number;
  overallScore: number | null;
};

export type CoordinatorRequest = {
  userLocation: LatLng;
  requiredFuel: FuelType;
  stations: readonly Station[];
  pricesByStationId?: PricesByStationId;
  sortBy?: SortMode;
  mode?: ProcessingMode;
};

export type ProcessingMetrics = {
  mode: ProcessingMode;
  totalStations: number;
  workerCount: number;
  completedBatches: number;
  retriedBatches: number;
  failedBatches: number;
  totalTimeMs: number;
};

export type CoordinatorResponse = {
  jobId: string;
  stations: RankedStation[];
  metrics: ProcessingMetrics;
};

export type ServiceErrorResponse = {
  error: string;
  jobId?: string;
  batchId?: string;
};