import { describe, expect, it } from "vitest";
import type {
  ProcessedStation,
  StationPrice,
} from "../../src/lib/processing";
import type {
  CompletedBatchDispatch,
} from "./dispatchBatches";
import {
  aggregateBatchResults,
} from "./aggregateResults";

function makePrice(
  centsPerGallon: number
): StationPrice {
  return {
    fuelType: "regular",
    centsPerGallon,
    source: "test",
    observedAt: null,
  };
}

function makeStation(
  id: string,
  overrides: Partial<ProcessedStation> = {}
): ProcessedStation {
  return {
    id,
    name: `Station ${id}`,
    brand: null,
    lat: 30,
    lng: -90,
    address: null,
    fuels: ["regular"],
    distanceMiles: 1,
    fuelCompatibility: "compatible",
    price: makePrice(300),
    ...overrides,
  };
}

function makeCompletedBatch(
  batchId: string,
  stations: ProcessedStation[]
): CompletedBatchDispatch {
  return {
    batchId,
    workerUrl: "http://worker-1:4001",
    response: {
      jobId: "job-1",
      batchId,
      workerId: "worker-1",
      stations,
      processingTimeMs: 2,
    },
    attemptCount: 1,
    totalTimeMs: 3,
    failures: [],
  };
}

describe("aggregateBatchResults", () => {
  it("combines and ranks completed worker results", () => {
    const stationA = makeStation("a", {
      distanceMiles: 5,
      price: makePrice(300),
    });

    const stationB = makeStation("b", {
      distanceMiles: 1,
      price: makePrice(350),
    });

    const result = aggregateBatchResults(
      "job-1",
      ["a", "b"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          [stationB]
        ),
        makeCompletedBatch(
          "job-1-batch-2",
          [stationA]
        ),
      ]
    );

    expect(
      result.stations.map((station) => station.id)
    ).toEqual(["a", "b"]);

    expect(
      result.stations.map((station) => station.rank)
    ).toEqual([1, 2]);

    expect(result.invalidResultCount).toBe(0);
    expect(result.incompatibleResultCount).toBe(0);
    expect(result.duplicateStationIds).toEqual([]);
    expect(result.missingStationIds).toEqual([]);
  });

  it("uses the requested final sort mode", () => {
    const result = aggregateBatchResults(
      "job-1",
      ["a", "b"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          [
            makeStation("a", {
              distanceMiles: 1,
              price: makePrice(350),
            }),
            makeStation("b", {
              distanceMiles: 10,
              price: makePrice(300),
            }),
          ]
        ),
      ],
      "cheapest"
    );

    expect(
      result.stations.map((station) => station.id)
    ).toEqual(["b", "a"]);

    expect(
      result.stations.every(
        (station) => station.overallScore === null
      )
    ).toBe(true);
  });

  it("filters incompatible stations", () => {
    const result = aggregateBatchResults(
      "job-1",
      ["compatible", "incompatible", "unknown"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          [
            makeStation("incompatible", {
              fuelCompatibility: "incompatible",
            }),
            makeStation("unknown", {
              fuelCompatibility: "unknown",
            }),
            makeStation("compatible"),
          ]
        ),
      ]
    );

    expect(
      result.stations.map((station) => station.id)
    ).toEqual(["compatible", "unknown"]);

    expect(result.incompatibleResultCount).toBe(1);
    expect(result.missingStationIds).toEqual([]);
  });

  it("prevents duplicate station results", () => {
    const first = makeStation("duplicate", {
      price: makePrice(300),
    });

    const second = makeStation("duplicate", {
      price: makePrice(250),
    });

    const result = aggregateBatchResults(
      "job-1",
      ["duplicate"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          [first]
        ),
        makeCompletedBatch(
          "job-1-batch-2",
          [second]
        ),
      ]
    );

    expect(result.stations).toHaveLength(1);
    expect(
      result.stations[0].price?.centsPerGallon
    ).toBe(300);
    expect(result.duplicateStationIds).toEqual([
      "duplicate",
    ]);
  });

  it("rejects invalid and unexpected station results", () => {
    const invalidDistance = makeStation(
      "bad-distance",
      {
        distanceMiles: -1,
      }
    );

    const unexpected = makeStation("unexpected");

    const result = aggregateBatchResults(
      "job-1",
      ["bad-distance", "missing"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          [invalidDistance, unexpected]
        ),
      ]
    );

    expect(result.stations).toEqual([]);
    expect(result.invalidResultCount).toBe(2);
    expect(result.missingStationIds).toEqual([
      "bad-distance",
      "missing",
    ]);
  });

  it("rejects an invalid returned price", () => {
    const station = makeStation("bad-price", {
      price: {
        fuelType: "regular",
        centsPerGallon: 300,
        source: "test",
        observedAt: "not-a-date",
      },
    });

    const result = aggregateBatchResults(
      "job-1",
      ["bad-price"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          [station]
        ),
      ]
    );

    expect(result.stations).toEqual([]);
    expect(result.invalidResultCount).toBe(1);
    expect(result.missingStationIds).toEqual([
      "bad-price",
    ]);
  });

  it("rejects a mismatched job response", () => {
    const completed = makeCompletedBatch(
      "job-1-batch-1",
      [
        makeStation("a"),
        makeStation("b"),
      ]
    );

    completed.response.jobId = "wrong-job";

    const result = aggregateBatchResults(
      "job-1",
      ["a", "b"],
      [completed]
    );

    expect(result.stations).toEqual([]);
    expect(result.invalidResultCount).toBe(2);
    expect(result.missingStationIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("reports stations missing from worker results", () => {
    const result = aggregateBatchResults(
      "job-1",
      ["a", "b"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          [makeStation("a")]
        ),
      ]
    );

    expect(
      result.stations.map((station) => station.id)
    ).toEqual(["a"]);
    expect(result.missingStationIds).toEqual(["b"]);
  });

  it("rejects a blank job ID", () => {
    for (const jobId of ["", "   "]) {
      expect(() =>
        aggregateBatchResults(
          jobId,
          [],
          []
        )
      ).toThrow("jobId is required.");
    }
  });

  it("rejects duplicate expected station IDs", () => {
    expect(() =>
      aggregateBatchResults(
        "job-1",
        ["a", "a"],
        []
      )
    ).toThrow(
      "Expected station IDs must be unique."
    );
  });

  it("does not modify worker result ordering", () => {
    const stations = [
      makeStation("b", {
        price: makePrice(350),
      }),
      makeStation("a", {
        price: makePrice(300),
      }),
    ];

    const originalIds = stations.map(
      (station) => station.id
    );

    aggregateBatchResults(
      "job-1",
      ["a", "b"],
      [
        makeCompletedBatch(
          "job-1-batch-1",
          stations
        ),
      ]
    );

    expect(
      stations.map((station) => station.id)
    ).toEqual(originalIds);
  });
});