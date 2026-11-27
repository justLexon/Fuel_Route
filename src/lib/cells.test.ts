import assert from "node:assert/strict";
import { test } from "vitest";
import { boundsAround, cellFor, cellRadiusMiles, pointKey } from "./cells";
import { straightLineMiles } from "./distance";

test("nearby points share a cell, keyed by its southwest corner", () => {
  assert.equal(cellFor({ lat: 30.2241, lng: -92.0198 }).key, "30.20,-92.05");
  assert.equal(cellFor({ lat: 30.2499, lng: -92.0001 }).key, "30.20,-92.05");
  assert.deepEqual(cellFor({ lat: 30.2241, lng: -92.0198 }).center, { lat: 30.225, lng: -92.025 });
});

test("a point exactly on a cell edge belongs to the cell above it", () => {
  assert.equal(cellFor({ lat: 30.2, lng: -92.05 }).key, "30.20,-92.05");
  assert.equal(cellFor({ lat: 30.25, lng: -92 }).key, "30.25,-92.00");
});

test("a cell's radius covers a full search from any corner of the cell", () => {
  const cell = cellFor({ lat: 30.21, lng: -92.04 });
  const corner = { lat: 30.2, lng: -92.05 };
  const centerToCorner = straightLineMiles(cell.center, corner)!;
  assert.ok(centerToCorner + 10 <= cellRadiusMiles(10));
});

test("bounds contain the circle", () => {
  const center = { lat: 30.2, lng: -92 };
  const box = boundsAround(center, 10);
  assert.ok(straightLineMiles(center, { lat: box.maxLat, lng: center.lng })! >= 9.9);
  assert.ok(straightLineMiles(center, { lat: center.lat, lng: box.minLng })! >= 9.9);
});

test("point keys round to 5 decimals", () => {
  assert.equal(pointKey({ lat: 30.123456, lng: -92.1 }), "30.12346,-92.10000");
});
