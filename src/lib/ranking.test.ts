import assert from "node:assert/strict";
import { test } from "node:test";
import { gasFuelFor } from "./fuelEconomy";
import { DEFAULT_MPG, FILL_UP_GALLONS, rankStations } from "./ranking";
import type { StationPrices, Station } from "./stations";

const center = { lat: 30.2, lng: -92.0 };
// One degree of latitude is ~69.09 miles, so lat offsets give exact-ish distances.
const station = (id: string, miles: number, prices: StationPrices): Station => ({
  id, name: id, brand: null, lat: 30.2 + miles / 69.09, lng: -92.0, address: null, fuels: [], prices,
});
const regular = (price: number): StationPrices => ({ regular: { price, cash: false } });
const ids = (ranked: { station: Station }[]) => ranked.map((entry) => entry.station.id);

test("best overall counts the drive: a slightly pricier nearby station beats a cheap far one", () => {
  const far = station("far", 9, regular(3.06));
  const near = station("near", 1, regular(3.19));
  const ranked = rankStations([far, near], center, "regular", 25, "best");
  assert.deepEqual(ids(ranked), ["near", "far"]);
  // 3.06 * (12 + 18/25) = 38.92; 3.19 * (12 + 2/25) = 38.54
  assert.ok(Math.abs((ranked[0].fillUpCost ?? 0) - 38.54) < 0.01);
  assert.ok(Math.abs((ranked[1].fillUpCost ?? 0) - 38.92) < 0.01);
});

test("cheapest sorts by price and closest sorts by distance", () => {
  const stations = [station("a", 5, regular(3.2)), station("b", 1, regular(3.4)), station("c", 3, regular(3.0))];
  assert.deepEqual(ids(rankStations(stations, center, "regular", 25, "cheapest")), ["c", "a", "b"]);
  assert.deepEqual(ids(rankStations(stations, center, "regular", 25, "closest")), ["b", "c", "a"]);
});

test("stations without a price for the vehicle's fuel are left out", () => {
  const stations = [
    station("regularOnly", 1, regular(3.1)),
    station("diesel", 2, { diesel: { price: 5.2, cash: false } }),
  ];
  const ranked = rankStations(stations, center, "diesel", 20, "best");
  assert.deepEqual(ids(ranked), ["diesel"]);
  assert.equal(ranked[0].price, 5.2);
});

test("if no station has a price for the fuel, all stations are returned closest first", () => {
  const stations = [station("far", 4, {}), station("near", 1, {})];
  const ranked = rankStations(stations, center, "premium", 25, "best");
  assert.deepEqual(ids(ranked), ["near", "far"]);
  assert.equal(ranked[0].fillUpCost, null);
});

test("unknown MPG falls back to the default", () => {
  const [entry] = rankStations([station("a", 5, regular(3))], center, "regular", null, "best");
  const expected = 3 * (FILL_UP_GALLONS + 10 / DEFAULT_MPG);
  assert.ok(Math.abs((entry.fillUpCost ?? 0) - expected) < 0.01);
});

test("FuelEconomy.gov fuel types map to station prices", () => {
  assert.equal(gasFuelFor("Regular Gasoline"), "regular");
  assert.equal(gasFuelFor("Premium Gasoline"), "premium");
  assert.equal(gasFuelFor("Midgrade Gasoline"), "midgrade");
  assert.equal(gasFuelFor("Diesel"), "diesel");
  assert.equal(gasFuelFor("Electricity"), null);
  assert.equal(gasFuelFor("Natural Gas"), null);
  assert.equal(gasFuelFor(undefined), null);
});
