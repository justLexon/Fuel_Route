import assert from "node:assert/strict";
import { test } from "node:test";
import type { GasBuddyStation } from "./gasbuddy";
import { attachPrices } from "./matchPrices";
import { hasPrices, type Station } from "./stations";

const station = (id: string, lat: number, lng: number): Station => ({
  id, name: id, brand: null, lat, lng, address: null, fuels: [],
});

const gasBuddy = (id: number, lat: number, lng: number, regular: number): GasBuddyStation => ({
  id, lat, lng, prices: { regular: { price: regular, cash: false } },
});

test("a station gets every fuel price of a GasBuddy station a few meters away", () => {
  const [result] = attachPrices(
    [station("node/1", 30.2, -92.0)],
    [{
      id: 10, lat: 30.2002, lng: -92.0001,
      prices: { regular: { price: 3.09, cash: true }, diesel: { price: 3.59, cash: false } },
    }]
  );
  assert.deepEqual(result.prices, {
    regular: { price: 3.09, cash: true },
    diesel: { price: 3.59, cash: false },
  });
  assert.equal(hasPrices(result), true);
});

test("a GasBuddy station more than ~100 m away is not matched", () => {
  const [result] = attachPrices(
    [station("node/1", 30.2, -92.0)],
    [gasBuddy(10, 30.202, -92.0, 3.09)] // ~0.14 mi north
  );
  assert.deepEqual(result.prices, {});
  assert.equal(hasPrices(result), false);
});

test("the closest of several nearby GasBuddy stations wins", () => {
  const [result] = attachPrices(
    [station("node/1", 30.2, -92.0)],
    [gasBuddy(10, 30.2006, -92.0, 3.5), gasBuddy(11, 30.2001, -92.0, 3.1)]
  );
  assert.equal(result.prices?.regular?.price, 3.1);
});

test("no GasBuddy stations leaves every station without prices", () => {
  const results = attachPrices([station("node/1", 30.2, -92.0), station("node/2", 30.3, -92.1)], []);
  assert.deepEqual(results.map(hasPrices), [false, false]);
});
