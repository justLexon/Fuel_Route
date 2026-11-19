import assert from "node:assert/strict";
import { test } from "vitest";
import type {
  StationPrice,
  WorkerBatchRequest,
} from "../../src/lib/processing";
import type { Station } from "../../src/lib/stations";
import {
  processWorkerBatch,
  selectStationPrice,
} from "./processBatch";

function price(
  centsPerGallon: number,
  options: Partial<StationPrice> = {}
): StationPrice {
  return {
    fuelType: "regular",
    centsPerGallon,
    source: "test",
    observedAt: null,
    ...options,
  };
}

function station(
  id: string,
  options: Partial<Station> = {}
): Station {
  return {
    id,
    name: id,
    brand: null,
    lat: 0,
    lng: 1,
    address: null,
    fuels: [],
    ...options,
  };
}

function request(
  stations: readonly Station[],
  options: Partial<WorkerBatchRequest> = {}
): WorkerBatchRequest {
  return {
    jobId: "job-1",
    batchId: "batch-1",
    userLocation: { lat: 0, lng: 0 },
    requiredFuel: "regular",
    stations,
    ...options,
  };
}

test("selects the most recent valid price for the required fuel", () => {
  const selected = selectStationPrice("regular", [
    price(300, { observedAt: "2026-01-01T00:00:00Z" }),
    price(250, {
      fuelType: "premium",
      observedAt: "2026-03-01T00:00:00Z",
    }),
    price(320, { observedAt: "2026-02-01T00:00:00Z" }),
  ]);

  assert.equal(selected?.centsPerGallon, 320);
});

test("ignores mismatched and invalid prices", () => {
  const selected = selectStationPrice("regular", [
    price(0),
    price(Number.NaN),
    price(200, { fuelType: "diesel" }),
    price(350),
  ]);

  assert.equal(selected?.centsPerGallon, 350);
});

test("unknown required fuel does not select a price", () => {
  assert.equal(
    selectStationPrice("unknown", [price(300)]),
    null
  );
});

test("processes distance, compatibility, price, and timing", () => {
  const times = [100, 112.3456];
  const result = processWorkerBatch(
    request(
      [
        station("station-1", {
          fuels: ["octane_87"],
        }),
      ],
      {
        pricesByStationId: {
          "station-1": [price(315)],
        },
      }
    ),
    "worker-1",
    () => times.shift() ?? 0
  );

  assert.equal(result.jobId, "job-1");
  assert.equal(result.batchId, "batch-1");
  assert.equal(result.workerId, "worker-1");
  assert.equal(result.processingTimeMs, 12.346);
  assert.equal(result.stations.length, 1);
  assert.equal(
    result.stations[0].fuelCompatibility,
    "compatible"
  );
  assert.equal(
    result.stations[0].price?.centsPerGallon,
    315
  );
  assert.ok(
    result.stations[0].distanceMiles !== null &&
      Math.abs(result.stations[0].distanceMiles - 69.0934) <
        0.01
  );
});

test("uses explicit unavailable fuel tags", () => {
  const result = processWorkerBatch(
    request(
      [
        station("diesel-unavailable", {
          unavailableFuels: ["diesel"],
        }),
      ],
      {
        requiredFuel: "diesel",
      }
    ),
    "worker-1"
  );

  assert.equal(
    result.stations[0].fuelCompatibility,
    "incompatible"
  );
});

test("keeps incomplete station fuel data unknown", () => {
  const result = processWorkerBatch(
    request([station("unknown")], {
      requiredFuel: "premium",
    }),
    "worker-1"
  );

  assert.equal(
    result.stations[0].fuelCompatibility,
    "unknown"
  );
  assert.equal(result.stations[0].price, null);
});

test("handles an empty batch", () => {
  const result = processWorkerBatch(
    request([]),
    "worker-1",
    () => 10
  );

  assert.deepEqual(result.stations, []);
  assert.equal(result.processingTimeMs, 0);
});

test("does not mutate its request", () => {
  const input = request(
    [
      station("station-1", {
        fuels: ["octane_87"],
      }),
    ],
    {
      pricesByStationId: {
        "station-1": [price(300)],
      },
    }
  );
  const original = structuredClone(input);

  processWorkerBatch(input, "worker-1");

  assert.deepEqual(input, original);
});