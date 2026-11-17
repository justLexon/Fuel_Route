import { describe, expect, it } from "vitest";
import type {
  WorkerBatchRequest,
  WorkerBatchResponse,
} from "../../src/lib/processing";
import {
  WorkerDispatchError,
} from "./dispatchBatch";
import {
  dispatchBatches,
} from "./dispatchBatches";
import type { AvailableWorker } from "./workers";

function makeBatch(index: number): WorkerBatchRequest {
  return {
    jobId: "job-1",
    batchId: `job-1-batch-${index}`,
    userLocation: {
      lat: 30,
      lng: -90,
    },
    requiredFuel: "regular",
    stations: [
      {
        id: `station-${index}`,
        name: `Station ${index}`,
        brand: null,
        lat: 30 + index / 100,
        lng: -90 - index / 100,
        address: null,
        fuels: ["regular"],
      },
    ],
  };
}

function makeWorker(index: number): AvailableWorker {
  return {
    url: `http://worker-${index}:400${index}`,
    workerId: `worker-${index}`,
    healthCheckTimeMs: 1,
  };
}

function makeResponse(
  request: WorkerBatchRequest,
  workerId: string
): WorkerBatchResponse {
  return {
    jobId: request.jobId,
    batchId: request.batchId,
    workerId,
    stations: request.stations.map((station) => ({
      ...station,
      distanceMiles: 1,
      fuelCompatibility: "compatible",
      price: null,
    })),
    processingTimeMs: 1,
  };
}

describe("dispatchBatches", () => {
  it("returns an empty result for no batches", async () => {
    await expect(
      dispatchBatches([], [])
    ).resolves.toEqual({
      completed: [],
      failed: [],
      retriedBatches: 0,
    });
  });

  it("requires an available worker", async () => {
    await expect(
      dispatchBatches([makeBatch(1)], [])
    ).rejects.toThrow(
      "At least one available worker is required."
    );
  });

  it("rejects duplicate batch IDs", async () => {
    await expect(
      dispatchBatches(
        [makeBatch(1), makeBatch(1)],
        [makeWorker(1)]
      )
    ).rejects.toThrow("Batch IDs must be unique.");
  });

  it("assigns batches round-robin", async () => {
    const workers = [makeWorker(1), makeWorker(2)];
    const calls: string[] = [];

    const result = await dispatchBatches(
      [
        makeBatch(1),
        makeBatch(2),
        makeBatch(3),
        makeBatch(4),
        makeBatch(5),
      ],
      workers,
      {
        dispatchImpl: async (workerUrl, request) => {
          calls.push(`${request.batchId}:${workerUrl}`);

          const worker = workers.find(
            (candidate) =>
              candidate.url === workerUrl
          );

          return makeResponse(
            request,
            worker!.workerId
          );
        },
      }
    );

    expect(calls).toEqual([
      "job-1-batch-1:http://worker-1:4001",
      "job-1-batch-2:http://worker-2:4002",
      "job-1-batch-3:http://worker-1:4001",
      "job-1-batch-4:http://worker-2:4002",
      "job-1-batch-5:http://worker-1:4001",
    ]);

    expect(result.completed).toHaveLength(5);
    expect(result.failed).toEqual([]);
  });

  it("dispatches batches concurrently", async () => {
    const workers = [makeWorker(1), makeWorker(2)];
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let releaseGate!: () => void;

    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const execution = dispatchBatches(
      [makeBatch(1), makeBatch(2), makeBatch(3)],
      workers,
      {
        dispatchImpl: async (
          workerUrl,
          request
        ) => {
          activeRequests += 1;
          maximumActiveRequests = Math.max(
            maximumActiveRequests,
            activeRequests
          );

          await gate;
          activeRequests -= 1;

          const worker = workers.find(
            (candidate) =>
              candidate.url === workerUrl
          );

          return makeResponse(
            request,
            worker!.workerId
          );
        },
      }
    );

    await Promise.resolve();

    expect(activeRequests).toBe(3);
    expect(maximumActiveRequests).toBe(3);

    releaseGate();

    const result = await execution;
    expect(result.completed).toHaveLength(3);
  });

  it("retries a retryable failure on another worker", async () => {
    const workers = [makeWorker(1), makeWorker(2)];
    const calls: string[] = [];

    const result = await dispatchBatches(
      [makeBatch(1)],
      workers,
      {
        dispatchImpl: async (
          workerUrl,
          request
        ) => {
          calls.push(workerUrl);

          if (workerUrl === workers[0].url) {
            throw new WorkerDispatchError(
              "Worker timed out.",
              workerUrl,
              true
            );
          }

          return makeResponse(
            request,
            workers[1].workerId
          );
        },
      }
    );

    expect(calls).toEqual([
      workers[0].url,
      workers[1].url,
    ]);
    expect(result.completed).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(result.retriedBatches).toBe(1);
    expect(
      result.completed[0].failures
    ).toHaveLength(1);
  });

  it("does not retry a permanent failure", async () => {
    const workers = [makeWorker(1), makeWorker(2)];
    const calls: string[] = [];

    const result = await dispatchBatches(
      [makeBatch(1)],
      workers,
      {
        dispatchImpl: async (workerUrl) => {
          calls.push(workerUrl);

          throw new WorkerDispatchError(
            "Worker rejected the request.",
            workerUrl,
            false,
            400
          );
        },
      }
    );

    expect(calls).toEqual([workers[0].url]);
    expect(result.completed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].attemptCount).toBe(1);
    expect(result.retriedBatches).toBe(0);
  });

  it("records failure after every worker fails", async () => {
    const workers = [
      makeWorker(1),
      makeWorker(2),
      makeWorker(3),
    ];

    const result = await dispatchBatches(
      [makeBatch(1)],
      workers,
      {
        dispatchImpl: async (workerUrl) => {
          throw new WorkerDispatchError(
            "Worker unavailable.",
            workerUrl,
            true
          );
        },
      }
    );

    expect(result.completed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].attemptCount).toBe(3);
    expect(result.failed[0].failures).toHaveLength(3);
    expect(result.retriedBatches).toBe(1);
  });

  it("does not attempt duplicate worker URLs", async () => {
    const worker = makeWorker(1);
    let attemptCount = 0;

    const result = await dispatchBatches(
      [makeBatch(1)],
      [
        worker,
        {
          ...worker,
          workerId: "duplicate-worker",
        },
      ],
      {
        dispatchImpl: async (workerUrl) => {
          attemptCount += 1;

          throw new WorkerDispatchError(
            "Worker unavailable.",
            workerUrl,
            true
          );
        },
      }
    );

    expect(attemptCount).toBe(1);
    expect(result.failed[0].attemptCount).toBe(1);
  });

  it("retries when worker identity changes", async () => {
    const workers = [makeWorker(1), makeWorker(2)];

    const result = await dispatchBatches(
      [makeBatch(1)],
      workers,
      {
        dispatchImpl: async (
          workerUrl,
          request
        ) => {
          if (workerUrl === workers[0].url) {
            return makeResponse(
              request,
              "unexpected-worker"
            );
          }

          return makeResponse(
            request,
            workers[1].workerId
          );
        },
      }
    );

    expect(result.completed).toHaveLength(1);
    expect(result.retriedBatches).toBe(1);
    expect(
      result.completed[0].failures[0].message
    ).toBe(
      "Worker identity changed after its health check."
    );
  });

  it("treats unexpected errors as permanent", async () => {
    const workers = [makeWorker(1), makeWorker(2)];
    let attemptCount = 0;

    const result = await dispatchBatches(
      [makeBatch(1)],
      workers,
      {
        dispatchImpl: async () => {
          attemptCount += 1;
          throw new Error("Unexpected coordinator bug.");
        },
      }
    );

    expect(attemptCount).toBe(1);
    expect(result.failed[0].failures[0]).toMatchObject({
      message: "Unexpected coordinator bug.",
      retryable: false,
    });
  });

  it("rejects invalid timeout configuration", async () => {
    for (const timeoutMs of [
      0,
      -1,
      1.5,
      Number.NaN,
    ]) {
      await expect(
        dispatchBatches(
          [makeBatch(1)],
          [makeWorker(1)],
          { timeoutMs }
        )
      ).rejects.toThrow(
        "timeoutMs must be a positive integer."
      );
    }
  });
});