import assert from "node:assert/strict";
import { test } from "vitest";
import type {
  ProcessedStation,
  StationPrice,
} from "./processing";
import { rankStations } from "./processedStationRanking";

function price(centsPerGallon: number): StationPrice {
  return {
    fuelType: "regular",
    centsPerGallon,
    source: "test",
    observedAt: null,
  };
}

function station(
  id: string,
  overrides: Partial<ProcessedStation> = {}
): ProcessedStation {
  return {
    id,
    name: id,
    brand: null,
    lat: 30,
    lng: -90,
    address: null,
    fuels: [],
    distanceMiles: 1,
    fuelCompatibility: "compatible",
    price: null,
    ...overrides,
  };
}

test("filters explicitly incompatible stations", () => {
  const results = rankStations([
    station("compatible"),
    station("unknown", {
      fuelCompatibility: "unknown",
    }),
    station("incompatible", {
      fuelCompatibility: "incompatible",
    }),
  ]);

  assert.deepEqual(
    results.map((result) => result.id),
    ["compatible", "unknown"]
  );
});

test("cheapest sorting puts known prices first", () => {
  const results = rankStations(
    [
      station("expensive", {
        price: price(400),
        distanceMiles: 1,
      }),
      station("missing", {
        price: null,
        distanceMiles: 0,
      }),
      station("cheap", {
        price: price(300),
        distanceMiles: 5,
      }),
    ],
    "cheapest"
  );

  assert.deepEqual(
    results.map((result) => result.id),
    ["cheap", "expensive", "missing"]
  );
});

test("cheapest sorting uses distance as its tie breaker", () => {
  const results = rankStations(
    [
      station("far", {
        price: price(300),
        distanceMiles: 5,
      }),
      station("near", {
        price: price(300),
        distanceMiles: 2,
      }),
    ],
    "cheapest"
  );

  assert.deepEqual(
    results.map((result) => result.id),
    ["near", "far"]
  );
});

test("closest sorting puts known distances first", () => {
  const results = rankStations(
    [
      station("far", {
        price: price(300),
        distanceMiles: 8,
      }),
      station("missing", {
        price: price(200),
        distanceMiles: null,
      }),
      station("near", {
        price: price(400),
        distanceMiles: 2,
      }),
    ],
    "closest"
  );

  assert.deepEqual(
    results.map((result) => result.id),
    ["near", "far", "missing"]
  );
});

test("best sorting uses 60 percent price and 40 percent distance", () => {
  const results = rankStations([
    station("cheap-far", {
      price: price(300),
      distanceMiles: 10,
    }),
    station("expensive-near", {
      price: price(400),
      distanceMiles: 0,
    }),
  ]);

  assert.deepEqual(
    results.map((result) => result.id),
    ["cheap-far", "expensive-near"]
  );
  assert.equal(results[0].overallScore, 0.4);
  assert.equal(results[1].overallScore, 0.6);
});

test("best sorting falls back to distance when no prices exist", () => {
  const results = rankStations([
    station("far", { distanceMiles: 10 }),
    station("near", { distanceMiles: 0 }),
  ]);

  assert.deepEqual(
    results.map((result) => result.id),
    ["near", "far"]
  );
  assert.equal(results[0].overallScore, 0);
  assert.equal(results[1].overallScore, 1);
});

test("missing prices receive the worst normalized price value", () => {
  const results = rankStations([
    station("known-price", {
      price: price(300),
      distanceMiles: 5,
    }),
    station("missing-price", {
      price: null,
      distanceMiles: 0,
    }),
  ]);

  assert.deepEqual(
    results.map((result) => result.id),
    ["known-price", "missing-price"]
  );
});

test("confirmed compatibility ranks ahead of unknown compatibility", () => {
  const results = rankStations([
    station("unknown", {
      fuelCompatibility: "unknown",
      price: price(200),
      distanceMiles: 0,
    }),
    station("compatible", {
      fuelCompatibility: "compatible",
      price: price(500),
      distanceMiles: 10,
    }),
  ]);

  assert.deepEqual(
    results.map((result) => result.id),
    ["compatible", "unknown"]
  );
});

test("invalid prices and distances are treated as missing", () => {
  const results = rankStations(
    [
      station("invalid", {
        price: price(0),
        distanceMiles: -1,
      }),
      station("valid", {
        price: price(350),
        distanceMiles: 2,
      }),
    ],
    "cheapest"
  );

  assert.deepEqual(
    results.map((result) => result.id),
    ["valid", "invalid"]
  );
});

test("ranking is deterministic and does not mutate its input", () => {
  const stations = [
    station("station-b", {
      price: price(300),
      distanceMiles: 2,
    }),
    station("station-a", {
      price: price(300),
      distanceMiles: 2,
    }),
  ];
  const original = structuredClone(stations);

  const results = rankStations(stations, "closest");

  assert.deepEqual(stations, original);
  assert.deepEqual(
    results.map((result) => result.id),
    ["station-a", "station-b"]
  );
  assert.deepEqual(
    results.map((result) => result.rank),
    [1, 2]
  );
  assert.deepEqual(
    results.map((result) => result.overallScore),
    [null, null]
  );
});