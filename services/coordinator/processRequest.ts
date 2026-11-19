import { randomUUID } from "node:crypto";
import type {
  CoordinatorRequest,
  CoordinatorResponse,
} from "../../src/lib/processing";
import {
  aggregateBatchResults,
} from "./aggregateResults";
import { createWorkerBatches } from "./createBatches";
import {
  dispatchBatch,
  type WorkerFetch,
} from "./dispatchBatch";
import {
  dispatchBatches,
  type FailedBatchDispatch,
} from "./dispatchBatches";
import {
  discoverWorkers,
  type UnavailableWorker,
} from "./workers";

type Clock = () => number;
type JobIdFactory = () => string;

export type BatchTiming = {
  batchId: string;
  workerId: string;
  workerUrl: string;
  workerProcessingTimeMs: number;
  totalTimeMs: number;
  attemptCount: number;
};

export type CoordinatorDiagnostics = {
  unavailableWorkers: UnavailableWorker[];
  failedBatches: FailedBatchDispatch[];
  batchTimings: BatchTiming[];
  invalidResultCount: number;
  incompatibleResultCount: number;
  duplicateStationIds: string[];
  missingStationIds: string[];
};

export type CoordinatorExecution = {
  response: CoordinatorResponse;
  diagnostics: CoordinatorDiagnostics;
};

export type ProcessCoordinatorOptions = {
  healthTimeoutMs?: number;
  workerTimeoutMs?: number;
  fetchImpl?: WorkerFetch;
  jobIdFactory?: JobIdFactory;
  clock?: Clock;
};

export class NoAvailableWorkersError extends Error {
  readonly name = "NoAvailableWorkersError";

  constructor(
    readonly jobId: string,
    readonly unavailableWorkers:
      readonly UnavailableWorker[]
  ) {
    super("No processing workers are available.");
  }
}

function elapsedMilliseconds(
  startedAt: number,
  finishedAt: number
): number {
  const elapsed = finishedAt - startedAt;

  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return 0;
  }

  return Number(elapsed.toFixed(3));
}

function emptyDiagnostics(): CoordinatorDiagnostics {
  return {
    unavailableWorkers: [],
    failedBatches: [],
    batchTimings: [],
    invalidResultCount: 0,
    incompatibleResultCount: 0,
    duplicateStationIds: [],
    missingStationIds: [],
  };
}

export async function processCoordinatorRequest(
  request: CoordinatorRequest,
  workerUrls: readonly string[],
  options: ProcessCoordinatorOptions = {}
): Promise<CoordinatorExecution> {
  const clock =
    options.clock ?? (() => performance.now());

  const startedAt = clock();

  const generatedJobId = (
    options.jobIdFactory ?? randomUUID
  )();

  const jobId = generatedJobId.trim();

  if (!jobId) {
    throw new Error(
      "jobIdFactory must return a non-empty string."
    );
  }

  const mode = request.mode ?? "distributed";
  const sortBy = request.sortBy ?? "best";

  if (request.stations.length === 0) {
    return {
      response: {
        jobId,
        stations: [],
        metrics: {
          mode,
          totalStations: 0,
          workerCount: 0,
          completedBatches: 0,
          retriedBatches: 0,
          failedBatches: 0,
          totalTimeMs: elapsedMilliseconds(
            startedAt,
            clock()
          ),
        },
      },
      diagnostics: emptyDiagnostics(),
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  const discovery = await discoverWorkers(
    workerUrls,
    {
      timeoutMs: options.healthTimeoutMs,
      fetchImpl,
      clock,
    }
  );

  if (discovery.available.length === 0) {
    throw new NoAvailableWorkersError(
      jobId,
      discovery.unavailable
    );
  }

  const selectedWorkers =
    mode === "single"
      ? [discovery.available[0]]
      : discovery.available;

  const batches = createWorkerBatches(
    jobId,
    request,
    selectedWorkers.length
  );

  const dispatchResult = await dispatchBatches(
    batches,
    selectedWorkers,
    {
      timeoutMs: options.workerTimeoutMs,
      clock,
      dispatchImpl: (
        workerUrl,
        batch,
        dispatchOptions
      ) =>
        dispatchBatch(workerUrl, batch, {
          ...dispatchOptions,
          fetchImpl,
        }),
    }
  );

  const aggregation = aggregateBatchResults(
    jobId,
    request.stations.map(
      (station) => station.id
    ),
    dispatchResult.completed,
    sortBy
  );

  const response: CoordinatorResponse = {
    jobId,
    stations: aggregation.stations,
    metrics: {
      mode,
      totalStations: request.stations.length,
      workerCount: selectedWorkers.length,
      completedBatches:
        dispatchResult.completed.length,
      retriedBatches:
        dispatchResult.retriedBatches,
      failedBatches:
        dispatchResult.failed.length,
      totalTimeMs: elapsedMilliseconds(
        startedAt,
        clock()
      ),
    },
  };

  return {
    response,
    diagnostics: {
      unavailableWorkers:
        discovery.unavailable,
      failedBatches: dispatchResult.failed,
      batchTimings:
        dispatchResult.completed.map(
          (completedBatch) => ({
            batchId: completedBatch.batchId,
            workerId:
              completedBatch.response.workerId,
            workerUrl:
              completedBatch.workerUrl,
            workerProcessingTimeMs:
              completedBatch.response
                .processingTimeMs,
            totalTimeMs:
              completedBatch.totalTimeMs,
            attemptCount:
              completedBatch.attemptCount,
          })
        ),
      invalidResultCount:
        aggregation.invalidResultCount,
      incompatibleResultCount:
        aggregation.incompatibleResultCount,
      duplicateStationIds:
        aggregation.duplicateStationIds,
      missingStationIds:
        aggregation.missingStationIds,
    },
  };
}