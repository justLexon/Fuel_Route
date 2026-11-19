import { describe, expect, it } from "vitest";
import type {
  CoordinatorRequest,
  WorkerBatchRequest,
} from "../../src/lib/processing";
import { processWorkerBatch } from "../worker/processBatch";
import type { WorkerFetch } from "./dispatchBatch";
import {
  NoAvailableWorkersError,
  processCoordinatorRequest,
} from "./processRequest";

const WORKERS = [
  {
    url: "http://worker-1:4001",
    workerId: "worker-1",
  },
  {
    url: "http://worker-2:4002",
    workerId: "worker-2",
  },
];

type FakeWorkerOptions = {
  unavailableHealthUrls?: ReadonlySet<string>;
  failingProcessUrls?: ReadonlySet<string>;
  processCalls?: string[];
};

function jsonResponse(
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createWorkerFetch(
  options: FakeWorkerOptions = {}
): WorkerFetch {
  return async (input, init) => {
    const endpoint = new URL(String(input));
    const workerUrl = endpoint.origin;

    const worker = WORKERS.find(
      (candidate) =>
        candidate.url === workerUrl
    );

    if (!worker) {
      return jsonResponse(
        { error: "Unknown worker." },
        404
      );
    }

    if (endpoint.pathname === "/health") {
      if (
        options.unavailableHealthUrls?.has(
          workerUrl
        )
      ) {
        return jsonResponse(
          { error: "Unavailable." },
          503
        );
      }

      return jsonResponse({
        status: "ok",
        workerId: worker.workerId,
      });
    }

    if (endpoint.pathname === "/process") {
      options.processCalls?.push(workerUrl);

      if (
        options.failingProcessUrls?.has(
          workerUrl
        )
      ) {
        return jsonResponse(
          { error: "Processing failed." },
          503
        );
      }

      if (typeof init?.body !== "string") {
        return jsonResponse(
          { error: "Missing request." },
          400
        );
      }

      const request = JSON.parse(
        init.body
      ) as WorkerBatchRequest;

      let tick = 0;

      return jsonResponse(
        processWorkerBatch(
          request,
          worker.workerId,
          () => tick++
        )
      );
    }

    return jsonResponse(
      { error: "Not found." },
      404
    );
  };
}

function makeRequest(
  stationCount: number,
  overrides: Partial<CoordinatorRequest> = {}
): CoordinatorRequest {
  return {
    userLocation: {
      lat: 30,
      lng: -90,
    },
    requiredFuel: "regular",
    stations: Array.from(
      { length: stationCount },
      (_, index) => ({
        id: `station-${index + 1}`,
        name: `Station ${index + 1}`,
        brand: null,
        lat: 30 + (index + 1) / 100,
        lng: -90,
        address: null,
        fuels: ["regular"],
      })
    ),
    ...overrides,
  };
}

describe("processCoordinatorRequest", () => {
  it("processes a distributed request end to end", async () => {
    const processCalls: string[] = [];

    const execution =
      await processCoordinatorRequest(
        makeRequest(4),
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch({
            processCalls,
          }),
          jobIdFactory: () => "job-distributed",
        }
      );

    expect(execution.response.jobId).toBe(
      "job-distributed"
    );

    expect(
      execution.response.stations.map(
        (station) => station.id
      )
    ).toEqual([
      "station-1",
      "station-2",
      "station-3",
      "station-4",
    ]);

    expect(execution.response.metrics).toMatchObject({
      mode: "distributed",
      totalStations: 4,
      workerCount: 2,
      completedBatches: 2,
      retriedBatches: 0,
      failedBatches: 0,
    });

    expect(processCalls).toEqual([
      WORKERS[0].url,
      WORKERS[1].url,
    ]);

    expect(
      execution.diagnostics.batchTimings
    ).toHaveLength(2);

    expect(
      execution.diagnostics.missingStationIds
    ).toEqual([]);
  });

  it("uses only one worker in single mode", async () => {
    const processCalls: string[] = [];

    const execution =
      await processCoordinatorRequest(
        makeRequest(3, {
          mode: "single",
        }),
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch({
            processCalls,
          }),
          jobIdFactory: () => "job-single",
        }
      );

    expect(processCalls).toEqual([
      WORKERS[0].url,
    ]);

    expect(execution.response.metrics).toMatchObject({
      mode: "single",
      workerCount: 1,
      completedBatches: 1,
      failedBatches: 0,
    });
  });

  it("returns immediately when there are no stations", async () => {
    let fetchCalled = false;

    const fetchImpl: WorkerFetch = async () => {
      fetchCalled = true;
      throw new Error("Fetch should not run.");
    };

    const execution =
      await processCoordinatorRequest(
        makeRequest(0),
        [],
        {
          fetchImpl,
          jobIdFactory: () => "job-empty",
          clock: () => 10,
        }
      );

    expect(fetchCalled).toBe(false);
    expect(execution.response).toEqual({
      jobId: "job-empty",
      stations: [],
      metrics: {
        mode: "distributed",
        totalStations: 0,
        workerCount: 0,
        completedBatches: 0,
        retriedBatches: 0,
        failedBatches: 0,
        totalTimeMs: 0,
      },
    });

    expect(
      execution.diagnostics
    ).toMatchObject({
      unavailableWorkers: [],
      failedBatches: [],
      batchTimings: [],
      missingStationIds: [],
    });
  });

  it("reports when no workers are available", async () => {
    let caught: unknown;

    try {
      await processCoordinatorRequest(
        makeRequest(2),
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch({
            unavailableHealthUrls: new Set(
              WORKERS.map(
                (worker) => worker.url
              )
            ),
          }),
          jobIdFactory: () =>
            "job-no-workers",
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(
      NoAvailableWorkersError
    );

    const unavailableError =
      caught as NoAvailableWorkersError;

    expect(unavailableError.jobId).toBe(
      "job-no-workers"
    );
    expect(
      unavailableError.unavailableWorkers
    ).toHaveLength(2);
  });

  it("continues with workers that pass health checks", async () => {
    const execution =
      await processCoordinatorRequest(
        makeRequest(2),
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch({
            unavailableHealthUrls: new Set([
              WORKERS[0].url,
            ]),
          }),
          jobIdFactory: () =>
            "job-one-worker",
        }
      );

    expect(execution.response.metrics).toMatchObject({
      workerCount: 1,
      completedBatches: 1,
      failedBatches: 0,
    });

    expect(
      execution.diagnostics.unavailableWorkers
    ).toHaveLength(1);

    expect(
      execution.diagnostics.batchTimings[0]
        .workerId
    ).toBe(WORKERS[1].workerId);
  });

  it("reassigns a failed batch to another worker", async () => {
    const processCalls: string[] = [];

    const execution =
      await processCoordinatorRequest(
        makeRequest(1),
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch({
            failingProcessUrls: new Set([
              WORKERS[0].url,
            ]),
            processCalls,
          }),
          jobIdFactory: () => "job-retry",
        }
      );

    expect(processCalls).toEqual([
      WORKERS[0].url,
      WORKERS[1].url,
    ]);

    expect(execution.response.metrics).toMatchObject({
      completedBatches: 1,
      retriedBatches: 1,
      failedBatches: 0,
    });

    expect(
      execution.diagnostics.batchTimings[0]
        .attemptCount
    ).toBe(2);
  });

  it("returns partial metrics when every batch fails", async () => {
    const execution =
      await processCoordinatorRequest(
        makeRequest(2),
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch({
            failingProcessUrls: new Set(
              WORKERS.map(
                (worker) => worker.url
              )
            ),
          }),
          jobIdFactory: () =>
            "job-all-failed",
        }
      );

    expect(execution.response.stations).toEqual(
      []
    );

    expect(execution.response.metrics).toMatchObject({
      completedBatches: 0,
      retriedBatches: 2,
      failedBatches: 2,
    });

    expect(
      execution.diagnostics.failedBatches
    ).toHaveLength(2);

    expect(
      execution.diagnostics.missingStationIds
    ).toEqual(["station-1", "station-2"]);
  });

  it("filters incompatible stations", async () => {
    const request = makeRequest(2);

    request.stations[1].fuels = ["diesel"];
    request.stations[1].unavailableFuels = [
        "regular",
        "midgrade",
        "premium",
    ];

    const execution =
      await processCoordinatorRequest(
        request,
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch(),
          jobIdFactory: () =>
            "job-compatibility",
        }
      );

    expect(
      execution.response.stations.map(
        (station) => station.id
      )
    ).toEqual(["station-1"]);

    expect(
      execution.diagnostics
        .incompatibleResultCount
    ).toBe(1);

    expect(
      execution.diagnostics.missingStationIds
    ).toEqual([]);
  });

  it("applies requested price sorting", async () => {
    const request = makeRequest(2, {
      mode: "single",
      sortBy: "cheapest",
      pricesByStationId: {
        "station-1": [
          {
            fuelType: "regular",
            centsPerGallon: 400,
            source: "test",
            observedAt: null,
          },
        ],
        "station-2": [
          {
            fuelType: "regular",
            centsPerGallon: 300,
            source: "test",
            observedAt: null,
          },
        ],
      },
    });

    const execution =
      await processCoordinatorRequest(
        request,
        WORKERS.map((worker) => worker.url),
        {
          fetchImpl: createWorkerFetch(),
          jobIdFactory: () => "job-prices",
        }
      );

    expect(
      execution.response.stations.map(
        (station) => station.id
      )
    ).toEqual(["station-2", "station-1"]);
  });

  it("rejects an empty generated job ID", async () => {
    await expect(
      processCoordinatorRequest(
        makeRequest(1),
        WORKERS.map((worker) => worker.url),
        {
          jobIdFactory: () => "   ",
        }
      )
    ).rejects.toThrow(
      "jobIdFactory must return a non-empty string."
    );
  });
});