import assert from "node:assert/strict";
import { test } from "node:test";
import { straightLineMiles } from "./distance";

test("identical coordinates and zero latitude/longitude are valid", () => {
  assert.equal(straightLineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
});

test("one degree at the equator is approximately 69.09 miles", () => {
  const miles = straightLineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(miles !== null && Math.abs(miles - 69.0934) < 0.01);
});

test("distance is symmetric and crosses the date line by the shorter arc", () => {
  const a = { lat: 0, lng: 179 };
  const b = { lat: 0, lng: -179 };
  const miles = straightLineMiles(a, b);
  assert.equal(miles, straightLineMiles(b, a));
  assert.ok(miles !== null && Math.abs(miles - 138.1868) < 0.01);
});

test("antipodal and polar points remain finite", () => {
  const miles = straightLineMiles({ lat: 90, lng: 0 }, { lat: -90, lng: 0 });
  assert.ok(miles !== null && Number.isFinite(miles) && Math.abs(miles - 12436.8) < 1);
});

test("missing, non-finite, and out-of-range coordinates omit distance", () => {
  const origin = { lat: 0, lng: 0 };
  for (const invalid of [null, undefined, { lat: NaN, lng: 0 },
    { lat: 0, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }]) {
    assert.equal(straightLineMiles(origin, invalid), null);
    assert.equal(straightLineMiles(invalid, origin), null);
  }
});
