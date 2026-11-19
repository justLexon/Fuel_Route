import type {
  WorkerBatchRequest,
  WorkerBatchResponse,
} from "../../src/lib/processing";
import {
  dispatchBatch,
  WorkerDispatchError,
  type DispatchBatchOptions,
} from "./dispatchBatch";
import type { AvailableWorker } from "./workers";

type Clock = () => number;

export type BatchAttemptFailure = {
  batchId: string;
  workerUrl: string;
  message: string;
  retryable: boolean;
  attemptTimeMs: number;
};

export type CompletedBatchDispatch = {
  batchId: string;
  workerUrl: string;
  response: WorkerBatchResponse;
  attemptCount: number;
  totalTimeMs: number;
  failures: BatchAttemptFailure[];
};

export type FailedBatchDispatch = {
  batchId: string;
  attemptCount: number;
  totalTimeMs: number;
  failures: BatchAttemptFailure[];
};

export type BatchDispatchResult = {
  completed: CompletedBatchDispatch[];
  failed: FailedBatchDispatch[];
  retriedBatches: number;
};

type BatchDispatcher = (
  workerUrl: string,
  request: WorkerBatchRequest,
  options?: DispatchBatchOptions
) => Promise<WorkerBatchResponse>;

export type DispatchBatchesOptions = {
  timeoutMs?: number;
  dispatchImpl?: BatchDispatcher;
  clock?: Clock;
};

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

function uniqueWorkers(
  workers: readonly AvailableWorker[]
): AvailableWorker[] {
  const workersByUrl = new Map<
    string,
    AvailableWorker
  >();

  for (const worker of workers) {
    if (!workersByUrl.has(worker.url)) {
      workersByUrl.set(worker.url, worker);
    }
  }

  return [...workersByUrl.values()];
}

function normalizeFailure(
  error: unknown
): {
  message: string;
  retryable: boolean;
} {
  if (error instanceof WorkerDispatchError) {
    return {
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    message:
      error instanceof Error
        ? error.message
        : "Unexpected worker dispatch failure.",
    retryable: false,
  };
}

export async function dispatchBatches(
  batches: readonly WorkerBatchRequest[],
  workers: readonly AvailableWorker[],
  options: DispatchBatchesOptions = {}
): Promise<BatchDispatchResult> {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1)
  ) {
    throw new Error(
      "timeoutMs must be a positive integer."
    );
  }

  const batchIds = new Set(
    batches.map((batch) => batch.batchId)
  );

  if (batchIds.size !== batches.length) {
    throw new Error("Batch IDs must be unique.");
  }

  if (batches.length === 0) {
    return {
      completed: [],
      failed: [],
      retriedBatches: 0,
    };
  }

  const availableWorkers = uniqueWorkers(workers);

  if (availableWorkers.length === 0) {
    throw new Error(
      "At least one available worker is required."
    );
  }

  const dispatchImpl =
    options.dispatchImpl ?? dispatchBatch;
  const clock =
    options.clock ?? (() => performance.now());

  const dispatchOptions: DispatchBatchOptions =
    options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs };

  const results = await Promise.all(
    batches.map(async (batch, batchIndex) => {
      const batchStartedAt = clock();
      const failures: BatchAttemptFailure[] = [];

      for (
        let offset = 0;
        offset < availableWorkers.length;
        offset += 1
      ) {
        const worker =
          availableWorkers[
            (batchIndex + offset) %
              availableWorkers.length
          ];

        const attemptStartedAt = clock();

        try {
          const response = await dispatchImpl(
            worker.url,
            batch,
            dispatchOptions
          );

          if (response.workerId !== worker.workerId) {
            throw new WorkerDispatchError(
              "Worker identity changed after its health check.",
              worker.url,
              true
            );
          }

          return {
            success: true as const,
            value: {
              batchId: batch.batchId,
              workerUrl: worker.url,
              response,
              attemptCount: failures.length + 1,
              totalTimeMs: elapsedMilliseconds(
                batchStartedAt,
                clock()
              ),
              failures,
            },
          };
        } catch (error) {
          const failure = normalizeFailure(error);

          failures.push({
            batchId: batch.batchId,
            workerUrl: worker.url,
            message: failure.message,
            retryable: failure.retryable,
            attemptTimeMs: elapsedMilliseconds(
              attemptStartedAt,
              clock()
            ),
          });

          if (!failure.retryable) {
            break;
          }
        }
      }

      return {
        success: false as const,
        value: {
          batchId: batch.batchId,
          attemptCount: failures.length,
          totalTimeMs: elapsedMilliseconds(
            batchStartedAt,
            clock()
          ),
          failures,
        },
      };
    })
  );

  const completed: CompletedBatchDispatch[] = [];
  const failed: FailedBatchDispatch[] = [];
  let retriedBatches = 0;

  for (const result of results) {
    if (result.value.attemptCount > 1) {
      retriedBatches += 1;
    }

    if (result.success) {
      completed.push(result.value);
    } else {
      failed.push(result.value);
    }
  }

  return {
    completed,
    failed,
    retriedBatches,
  };
}