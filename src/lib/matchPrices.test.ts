import assert from "node:assert/strict";
import { test } from "vitest";
import type { GasBuddyStation } from "./gasbuddy";
import { mergeStations, UNNAMED_STATION } from "./matchPrices";
import { hasPrices, type Station } from "./stations";

const CENTER = { lat: 30.2, lng: -92.0 };
const RADIUS = 10;

const station = (id: string, lat: number, lng: number): Station => ({
  id, name: id, brand: "Shell", lat, lng, address: "1 Main St", fuels: [],
});

const gasBuddy = (id: number, lat: number, lng: number, regular: number): GasBuddyStation => ({
  id, lat, lng, prices: { regular: { price: regular, cash: false } },
});

test("a GasBuddy station a few meters from an OSM station gets its name, brand and address", () => {
  const [result] = mergeStations(
    [station("node/1", 30.2, -92.0)],
    [{
      id: 10, lat: 30.2002, lng: -92.0001,
      prices: { regular: { price: 3.09, cash: true }, diesel: { price: 3.59, cash: false } },
    }],
    CENTER, RADIUS
  );
  assert.equal(result.id, "gasbuddy/10"); // same id as before names arrived
  assert.equal(result.name, "node/1");
  assert.equal(result.brand, "Shell");
  assert.equal(result.address, "1 Main St");
  assert.deepEqual(result.prices, {
    regular: { price: 3.09, cash: true },
    diesel: { price: 3.59, cash: false },
  });
});

test("a GasBuddy station more than ~100 m from any OSM station is shown unnamed, and the OSM one without prices", () => {
  const results = mergeStations(
    [station("node/1", 30.2, -92.0)],
    [gasBuddy(10, 30.202, -92.0, 3.09)], // ~0.14 mi north
    CENTER, RADIUS
  );
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    id: "gasbuddy/10", name: UNNAMED_STATION, brand: null, lat: 30.202, lng: -92.0,
    address: null, fuels: [], prices: { regular: { price: 3.09, cash: false } },
  });
  assert.equal(results[1].id, "node/1");
  assert.equal(hasPrices(results[1]), false);
});

test("each station is matched once, closest pair first", () => {
  const results = mergeStations(
    [station("node/1", 30.2, -92.0)],
    [gasBuddy(10, 30.2006, -92.0, 3.5), gasBuddy(11, 30.2001, -92.0, 3.1)],
    CENTER, RADIUS
  );
  assert.equal(results.find((result) => result.id === "gasbuddy/11")?.name, "node/1");
  assert.equal(results.find((result) => result.id === "gasbuddy/10")?.name, UNNAMED_STATION);
  assert.equal(results.length, 2); // the OSM station was used once, not left over
});

test("Overpass busy: every GasBuddy station still shows, unnamed, with prices", () => {
  const results = mergeStations(
    null,
    [gasBuddy(10, 30.2, -92.0, 3.09), gasBuddy(11, 30.25, -92.05, 3.19)],
    CENTER, RADIUS
  );
  assert.deepEqual(results.map((result) => result.id), ["gasbuddy/10", "gasbuddy/11"]);
  assert.ok(results.every((result) => result.name === UNNAMED_STATION && hasPrices(result)));
});

test("GasBuddy failed: the OSM stations, without prices", () => {
  const results = mergeStations([station("node/1", 30.2, -92.0), station("node/2", 30.3, -92.1)], null, CENTER, RADIUS);
  assert.deepEqual(results.map((result) => result.id), ["node/1", "node/2"]);
  assert.deepEqual(results.map(hasPrices), [false, false]);
});

test("GasBuddy stations outside the search radius are dropped", () => {
  const results = mergeStations(
    null,
    [gasBuddy(10, 30.2, -92.0, 3.09), gasBuddy(11, 30.4, -92.0, 2.5)], // ~13.8 mi north
    CENTER, RADIUS
  );
  assert.deepEqual(results.map((result) => result.id), ["gasbuddy/10"]);
});
