import { describe, expect, it } from "vitest";
import type {
  CoordinatorRequest,
  StationPrice,
} from "../../src/lib/processing";
import type { Station } from "../../src/lib/stations";
import { MAX_STATIONS_PER_BATCH } from "../worker/validateRequest";
import { createWorkerBatches } from "./createBatches";

function makeStation(index: number): Station {
  return {
    id: `station-${index}`,
    name: `Station ${index}`,
    brand: null,
    lat: 30 + index / 1000,
    lng: -90 - index / 1000,
    address: null,
    fuels: ["regular"],
  };
}

function makeRequest(
  stationCount: number
): CoordinatorRequest {
  return {
    userLocation: {
      lat: 30,
      lng: -90,
    },
    requiredFuel: "regular",
    stations: Array.from(
      { length: stationCount },
      (_, index) => makeStation(index + 1)
    ),
  };
}

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

describe("createWorkerBatches", () => {
  it("splits stations approximately evenly", () => {
    const request = makeRequest(8);

    const batches = createWorkerBatches(
      "job-1",
      request,
      3
    );

    expect(
      batches.map((batch) => batch.stations.length)
    ).toEqual([3, 3, 2]);

    expect(
      batches.map((batch) => batch.batchId)
    ).toEqual([
      "job-1-batch-1",
      "job-1-batch-2",
      "job-1-batch-3",
    ]);

    expect(
      batches.flatMap((batch) =>
        batch.stations.map((station) => station.id)
      )
    ).toEqual(
      request.stations.map((station) => station.id)
    );
  });

  it("does not create empty batches", () => {
    const batches = createWorkerBatches(
      "job-2",
      makeRequest(2),
      5
    );

    expect(batches).toHaveLength(2);
    expect(
      batches.every(
        (batch) => batch.stations.length === 1
      )
    ).toBe(true);
  });

  it("returns no batches when there are no stations", () => {
    expect(
      createWorkerBatches(
        "job-empty",
        makeRequest(0),
        3
      )
    ).toEqual([]);
  });

  it("keeps every batch within the worker limit", () => {
    const stationCount =
      MAX_STATIONS_PER_BATCH * 2 + 1;

    const batches = createWorkerBatches(
      "job-large",
      makeRequest(stationCount),
      1
    );

    expect(batches).toHaveLength(3);
    expect(
      Math.max(
        ...batches.map(
          (batch) => batch.stations.length
        )
      )
    ).toBeLessThanOrEqual(MAX_STATIONS_PER_BATCH);

    expect(
      batches.reduce(
        (total, batch) =>
          total + batch.stations.length,
        0
      )
    ).toBe(stationCount);
  });

  it("includes only prices belonging to each batch", () => {
    const request = makeRequest(4);

    request.pricesByStationId = {
      "station-1": [makePrice(300)],
      "station-3": [makePrice(320)],
      unused: [makePrice(999)],
    };

    const batches = createWorkerBatches(
      "job-prices",
      request,
      2
    );

    expect(
      Object.keys(
        batches[0].pricesByStationId ?? {}
      )
    ).toEqual(["station-1"]);

    expect(
      Object.keys(
        batches[1].pricesByStationId ?? {}
      )
    ).toEqual(["station-3"]);
  });

  it("omits prices when none were provided", () => {
    const batches = createWorkerBatches(
      "job-no-prices",
      makeRequest(1),
      1
    );

    expect(batches[0]).not.toHaveProperty(
      "pricesByStationId"
    );
  });

  it.each(["", "   "])(
    "rejects an invalid job ID",
    (jobId) => {
      expect(() =>
        createWorkerBatches(
          jobId,
          makeRequest(1),
          1
        )
      ).toThrow("jobId is required.");
    }
  );

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid worker count %s",
    (workerCount) => {
      expect(() =>
        createWorkerBatches(
          "job-invalid-workers",
          makeRequest(1),
          workerCount
        )
      ).toThrow(
        "workerCount must be a positive integer."
      );
    }
  );

  it("does not modify the coordinator request", () => {
    const request = makeRequest(5);
    const originalStationIds =
      request.stations.map((station) => station.id);

    createWorkerBatches("job-stable", request, 2);

    expect(
      request.stations.map((station) => station.id)
    ).toEqual(originalStationIds);
  });
});