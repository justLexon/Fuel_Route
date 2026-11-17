import assert from "node:assert/strict";
import { test } from "vitest";
import type { WorkerBatchRequest } from "../../src/lib/processing";
import type { Station } from "../../src/lib/stations";
import {
  MAX_PRICES_PER_STATION,
  MAX_STATIONS_PER_BATCH,
  validateWorkerBatchRequest,
} from "./validateRequest";

function validRequest(): WorkerBatchRequest {
  const station: Station = {
    id: "node/1",
    name: "Station",
    brand: null,
    lat: 30.1,
    lng: -90.1,
    address: null,
    fuels: ["octane_87"],
  };

  return {
    jobId: "job-1",
    batchId: "batch-1",
    userLocation: { lat: 30, lng: -90 },
    requiredFuel: "regular",
    stations: [station],
  };
}

function expectInvalid(
  value: unknown,
  message: RegExp
) {
  const result = validateWorkerBatchRequest(value);

  if (result.success) {
    assert.fail("Expected validation to fail.");
  }

  assert.match(result.error, message);
}

test("accepts a minimal valid request", () => {
  const input = validRequest();
  const result = validateWorkerBatchRequest(input);

  if (!result.success) {
    assert.fail(result.error);
  }

  assert.equal(result.data, input);
});

test("accepts optional unavailable fuels and price data", () => {
  const input = validRequest();

  input.stations[0].unavailableFuels = ["diesel"];

  Object.assign(input, {
    pricesByStationId: {
      "node/1": [
        {
          fuelType: "regular",
          centsPerGallon: 319,
          source: "test",
          observedAt: "2026-11-17T12:00:00Z",
        },
      ],
    },
  });

  assert.equal(
    validateWorkerBatchRequest(input).success,
    true
  );
});

test("rejects non-object request bodies", () => {
  for (const value of [null, undefined, [], "request", 1]) {
    expectInvalid(
      value,
      /Request body must be an object/
    );
  }
});

test("requires non-empty job and batch IDs", () => {
  expectInvalid(
    { ...validRequest(), jobId: " " },
    /jobId/
  );
  expectInvalid(
    { ...validRequest(), batchId: null },
    /batchId/
  );
});

test("rejects invalid user coordinates", () => {
  for (const userLocation of [
    { lat: 91, lng: 0 },
    { lat: 0, lng: -181 },
    { lat: Number.NaN, lng: 0 },
    { lat: 0 },
  ]) {
    expectInvalid(
      { ...validRequest(), userLocation },
      /userLocation/
    );
  }
});

test("rejects unsupported required fuels", () => {
  expectInvalid(
    {
      ...validRequest(),
      requiredFuel: "rocket-fuel",
    },
    /requiredFuel/
  );
});

test("enforces station-array shape and batch limit", () => {
  expectInvalid(
    { ...validRequest(), stations: null },
    /stations must be an array/
  );

  const sample = validRequest().stations[0];

  expectInvalid(
    {
      ...validRequest(),
      stations: Array.from(
        { length: MAX_STATIONS_PER_BATCH + 1 },
        (_, index) => ({
          ...sample,
          id: `node/${index}`,
        })
      ),
    },
    /cannot contain more than/
  );
});

test("validates station fields and duplicate IDs", () => {
  const input = validRequest();

  expectInvalid(
    {
      ...input,
      stations: [
        { ...input.stations[0], lat: 100 },
      ],
    },
    /valid lat\/lng/
  );

  expectInvalid(
    {
      ...input,
      stations: [
        {
          ...input.stations[0],
          fuels: ["diesel", 1],
        },
      ],
    },
    /fuels/
  );

  expectInvalid(
    {
      ...input,
      stations: [
        input.stations[0],
        { ...input.stations[0] },
      ],
    },
    /duplicate ID/
  );
});

test("validates price collections and size limit", () => {
  expectInvalid(
    {
      ...validRequest(),
      pricesByStationId: [],
    },
    /must be an object/
  );

  expectInvalid(
    {
      ...validRequest(),
      pricesByStationId: {
        "node/1": Array.from(
          { length: MAX_PRICES_PER_STATION + 1 },
          () => ({})
        ),
      },
    },
    /cannot contain more than/
  );
});

test("validates every price field", () => {
  const basePrice = {
    fuelType: "regular",
    centsPerGallon: 319,
    source: "test",
    observedAt: null,
  };

  for (const changedPrice of [
    { ...basePrice, fuelType: "unknown" },
    { ...basePrice, centsPerGallon: 0 },
    { ...basePrice, source: " " },
    { ...basePrice, observedAt: "not-a-date" },
  ]) {
    expectInvalid(
      {
        ...validRequest(),
        pricesByStationId: {
          "node/1": [changedPrice],
        },
      },
      /pricesByStationId/
    );
  }
});