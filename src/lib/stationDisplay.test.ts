import assert from "node:assert/strict";
import { test } from "node:test";
import { getStationDisplayName } from "./stationDisplay";

test("actual name takes precedence over a valid brand", () => {
  assert.equal(getStationDisplayName({ name: "Main Street Fuel", brand: "Shell" }), "Main Street Fuel");
});

test("missing or empty name falls back to a valid brand", () => {
  assert.equal(getStationDisplayName({ brand: "Chevron" }), "Chevron");
  assert.equal(getStationDisplayName({ name: "", brand: "Chevron" }), "Chevron");
});

test("whitespace-only name falls back to brand", () => {
  assert.equal(getStationDisplayName({ name: " \t\n ", brand: "Texaco" }), "Texaco");
});

test("generic fallback name gives precedence to a meaningful brand", () => {
  assert.equal(getStationDisplayName({ name: "  Gas station  ", brand: " Shell " }), "Shell");
});

test("missing name and brand use the final fallback", () => {
  assert.equal(getStationDisplayName({}), "Gas station");
  assert.equal(getStationDisplayName({ name: "", brand: null }), "Gas station");
});

test("whitespace-only brand is ignored", () => {
  assert.equal(getStationDisplayName({ brand: " \t " }), "Gas station");
  assert.equal(getStationDisplayName({ name: "Gas station", brand: " \n " }), "Gas station");
  assert.equal(getStationDisplayName({ name: "Local Fuel", brand: " " }), "Local Fuel");
});

test("trimming preserves the supplied capitalization and internal spaces", () => {
  assert.equal(getStationDisplayName({ name: "  McKay's  Fuel \n", brand: "SHELL" }), "McKay's  Fuel");
  assert.equal(getStationDisplayName({ brand: "  eFuel EXPRESS \t" }), "eFuel EXPRESS");
});

test("display naming does not mutate station data", () => {
  const station = Object.freeze({ name: " Gas station ", brand: " Shell " });
  assert.equal(getStationDisplayName(station), "Shell");
  assert.deepEqual(station, { name: " Gas station ", brand: " Shell " });
});
