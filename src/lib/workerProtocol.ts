// The JSON format between the web app, the coordinator, and the workers.
// Explained with examples in _docs/worker-protocol.md.

import type { LatLng } from "./location";
import type { Station } from "./stations";

export type FuelGrade = "regular" | "midgrade" | "premium" | "diesel";

// "unknown" matters: most OpenStreetMap stations don't list their fuels, so
// only "no" should filter a station out.
export type FuelCompatibility = "yes" | "no" | "unknown";

// A station after a worker has processed it.
export type ProcessedStation = Station & {
  distanceMiles: number;
  price: number | null; // per gallon for the required fuel; null if there's no price
  compatibility: FuelCompatibility;
};

// Web app -> coordinator: POST /jobs
export type JobRequest = {
  user: LatLng;
  requiredFuel: FuelGrade;
  stations: Station[];
};

// Coordinator -> web app
export type JobResponse = {
  jobId: string;
  results: ProcessedStation[]; // deduped, filtered, and ranked
  failedBatchIds: string[]; // batches no worker could finish; empty if results are complete
  totalMs: number;
};

// Coordinator -> worker: POST /process
export type WorkerRequest = {
  jobId: string;
  batchId: string;
  user: LatLng;
  requiredFuel: FuelGrade;
  stations: Station[];
};

// Worker -> coordinator
export type WorkerResponse =
  | {
      status: "ok";
      jobId: string;
      batchId: string;
      workerId: string;
      results: ProcessedStation[];
      processingMs: number;
    }
  | {
      status: "error";
      jobId: string;
      batchId: string;
      workerId: string;
      error: string;
    };

// Worker -> coordinator: GET /health
export type WorkerHealth = {
  status: "ok";
  workerId: string;
};
