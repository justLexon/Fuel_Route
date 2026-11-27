import { describe, expect, it } from "vitest";
import type {
  CoordinatorRequest,
  ProcessingMode,
} from "../../src/lib/processing";
import type { WorkerFetch } from "../coordinator/dispatchBatch";
import {
  calculateStatistics,
  createBenchmarkRequest,
  runBenchmark,
} from "./runBenchmark";

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

function successfulCoordinatorResponse(
  mode: ProcessingMode,
  stationCount: number
) {
  return {
    jobId: `job-${mode}`,
    stations: Array.from(
      { length: stationCount },
      (_, index) => ({
        id: `result-${index + 1}`,
      })
    ),
    metrics: {
      mode,
      totalStations: stationCount,
      workerCount:
        mode === "single" ? 1 : 2,
      completedBatches:
        mode === "single" ? 1 : 2,
      retriedBatches: 0,
      failedBatches: 0,
      totalTimeMs:
        mode === "single" ? 20 : 10,
    },
  };
}

describe("calculateStatistics", () => {
  it("calculates summary statistics", () => {
    expect(
      calculateStatistics([4, 1, 3, 2])
    ).toEqual({
      runs: 4,
      averageMs: 2.5,
      medianMs: 2.5,
      minimumMs: 1,
      maximumMs: 4,
      p95Ms: 4,
    });
  });

  it("requires at least one value", () => {
    expect(() =>
      calculateStatistics([])
    ).toThrow(
      "At least one benchmark value is required."
    );
  });
});

describe("createBenchmarkRequest", () => {
  it("creates deterministic stations and prices", () => {
    const request = createBenchmarkRequest(3);

    expect(request.stations).toHaveLength(3);

    expect(
      request.stations.map(
        (station) => station.id
      )
    ).toEqual([
      "benchmark-1",
      "benchmark-2",
      "benchmark-3",
    ]);

    expect(
      request.pricesByStationId?.[
        "benchmark-1"
      ][0].centsPerGallon
    ).toBe(300);

    expect(
      request.pricesByStationId?.[
        "benchmark-3"
      ][0].centsPerGallon
    ).toBe(302);

    expect(request.sortBy).toBe("best");
  });

  it("rejects invalid station counts", () => {
    for (const stationCount of [
      0,
      501,
      1.5,
      Number.NaN,
    ]) {
      expect(() =>
        createBenchmarkRequest(stationCount)
      ).toThrow();
    }
  });
});

describe("runBenchmark", () => {
  it("warms up, alternates modes, and reports speedup", async () => {
    const modes: ProcessingMode[] = [];
    const endpoints: string[] = [];
    const stationCounts: number[] = [];

    const fetchImpl: WorkerFetch = async (
      input,
      init
    ) => {
      endpoints.push(String(input));

      const request = JSON.parse(
        String(init?.body)
      ) as CoordinatorRequest;

      const mode =
        request.mode as ProcessingMode;

      modes.push(mode);
      stationCounts.push(
        request.stations.length
      );

      return jsonResponse(
        successfulCoordinatorResponse(
          mode,
          request.stations.length
        )
      );
    };

    let currentTime = 0;

    const report = await runBenchmark({
      coordinatorUrl:
        "http://coordinator:4000",
      stationCount: 2,
      iterations: 3,
      warmupIterations: 1,
      fetchImpl,
      clock: () => {
        const value = currentTime;
        currentTime += 5;
        return value;
      },
    });

    expect(modes).toEqual([
      "single",
      "distributed",
      "single",
      "distributed",
      "distributed",
      "single",
      "single",
      "distributed",
    ]);

    expect(
      endpoints.every(
        (endpoint) =>
          endpoint ===
          "http://coordinator:4000/process"
      )
    ).toBe(true);

    expect(
      stationCounts.every(
        (stationCount) => stationCount === 2
      )
    ).toBe(true);

    expect(report.stationCount).toBe(2);
    expect(report.iterations).toBe(3);
    expect(report.warmupIterations).toBe(1);

    expect(report.single.samples).toHaveLength(
      3
    );

    expect(
      report.distributed.samples
    ).toHaveLength(3);

    expect(report.single.client.averageMs).toBe(
      5
    );

    expect(
      report.distributed.client.averageMs
    ).toBe(5);

    expect(
      report.single.coordinator.averageMs
    ).toBe(20);

    expect(
      report.distributed.coordinator.averageMs
    ).toBe(10);

    expect(report.clientSpeedup).toBe(1);
    expect(report.coordinatorSpeedup).toBe(2);

    expect(
      report.single.samples.every(
        (sample) =>
          sample.returnedStations === 2
      )
    ).toBe(true);
  });

  it("reports coordinator HTTP failures", async () => {
    const fetchImpl: WorkerFetch = async () =>
      jsonResponse(
        { error: "Unavailable." },
        503
      );

    await expect(
      runBenchmark({
        coordinatorUrl:
          "http://coordinator:4000",
        stationCount: 1,
        iterations: 1,
        warmupIterations: 0,
        fetchImpl,
      })
    ).rejects.toThrow(
      "Coordinator returned HTTP 503."
    );
  });

  it("rejects invalid coordinator JSON", async () => {
    const fetchImpl: WorkerFetch = async () =>
      new Response("{invalid", {
        status: 200,
      });

    await expect(
      runBenchmark({
        coordinatorUrl:
          "http://coordinator:4000",
        stationCount: 1,
        iterations: 1,
        warmupIterations: 0,
        fetchImpl,
      })
    ).rejects.toThrow(
      "Coordinator returned invalid JSON."
    );
  });

  it("rejects an invalid coordinator response", async () => {
    const fetchImpl: WorkerFetch = async () =>
      jsonResponse({
        jobId: "job-invalid",
        stations: [],
        metrics: {
          mode: "wrong",
        },
      });

    await expect(
      runBenchmark({
        coordinatorUrl:
          "http://coordinator:4000",
        stationCount: 1,
        iterations: 1,
        warmupIterations: 0,
        fetchImpl,
      })
    ).rejects.toThrow(
      "Coordinator returned an invalid response."
    );
  });

  it("rejects invalid coordinator URLs", async () => {
    for (const coordinatorUrl of [
      "not-a-url",
      "ftp://coordinator",
    ]) {
      await expect(
        runBenchmark({
          coordinatorUrl,
          stationCount: 1,
          iterations: 1,
          warmupIterations: 0,
        })
      ).rejects.toThrow();
    }
  });

  it("rejects invalid benchmark options", async () => {
    const baseOptions = {
      coordinatorUrl:
        "http://coordinator:4000",
    };

    await expect(
      runBenchmark({
        ...baseOptions,
        stationCount: 0,
      })
    ).rejects.toThrow();

    await expect(
      runBenchmark({
        ...baseOptions,
        iterations: 0,
      })
    ).rejects.toThrow();

    for (const warmupIterations of [
      -1,
      21,
      1.5,
    ]) {
      await expect(
        runBenchmark({
          ...baseOptions,
          warmupIterations,
        })
      ).rejects.toThrow(
        "warmupIterations must be an integer"
      );
    }
  });
});