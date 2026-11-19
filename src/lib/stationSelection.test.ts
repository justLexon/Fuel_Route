import assert from "node:assert/strict";
import { test } from "node:test";
import type { Station } from "./stations";
import { focusStationSelection, hasStationCoordinates, resolveStationSelection, type StationSelection } from "./stationSelection";

const station = (id: string, lat = 30, lng = -90): Station => ({
  id, name: "Same name", brand: null, address: null, fuels: [], lat, lng,
});
const stations = [station("node/123"), station("way/123"), station("relation/123")];
const selection: StationSelection = { stationId: "way/123", stations, activation: 1 };

test("selection matches the full ID, not names or numeric ID suffixes", () => {
  assert.equal(resolveStationSelection(selection, stations), stations[1]);
  assert.equal(resolveStationSelection({ ...selection, stationId: "123" }, stations), null);
});

test("replacement results reject stale selections even with identical IDs", () => {
  assert.equal(resolveStationSelection(selection, [...stations]), null);
  assert.equal(resolveStationSelection(selection, []), null);
  assert.equal(resolveStationSelection(null, stations), null);
});

test("unknown IDs and invalid station coordinates cannot be selected", () => {
  assert.equal(resolveStationSelection({ ...selection, stationId: "node/missing" }, stations), null);
  const invalid = [station("node/invalid", NaN, 0)];
  assert.equal(resolveStationSelection({ ...selection, stations: invalid, stationId: invalid[0].id }, invalid), null);
});

test("coordinates validate ranges and preserve zero as a valid location", () => {
  assert.equal(hasStationCoordinates({ lat: 0, lng: 0 }), true);
  assert.equal(hasStationCoordinates({ lat: -90, lng: 180 }), true);
  for (const invalid of [null, undefined, {}, { lat: 0 }, { lat: NaN, lng: 0 },
    { lat: 0, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }]) {
    assert.equal(hasStationCoordinates(invalid), false);
  }
});

test("focusing pans without zoom changes and opens only the matching existing popup", () => {
  const calls: string[] = [];
  const markers = new Map(stations.map((item) => [item.id, {
    getPopup: () => ({}),
    openPopup: () => { calls.push(item.id); },
  }]));
  const map = { panTo: (center: { lat: number; lng: number }, options: { animate: boolean }) => {
    assert.deepEqual(center, { lat: 30, lng: -90 });
    assert.deepEqual(options, { animate: false });
    calls.push("pan");
  } };
  assert.equal(focusStationSelection(selection, stations, markers, map), stations[1]);
  assert.deepEqual(calls, ["pan", "way/123"]);
  assert.equal(focusStationSelection({ ...selection, activation: 2 }, stations, markers, map), stations[1]);
  assert.deepEqual(calls, ["pan", "way/123", "pan", "way/123"]);
});

test("stale selections and markers whose popup is not ready do nothing", () => {
  const fail = () => { assert.fail("must not move the map or open a popup"); };
  const map = { panTo: fail };
  assert.equal(focusStationSelection(selection, [...stations], new Map(), map), null);
  assert.equal(focusStationSelection(selection, stations, new Map(), map), null);
  const markers = new Map([["way/123", { getPopup: () => undefined, openPopup: fail }]]);
  assert.equal(focusStationSelection(selection, stations, markers, map), null);
});

test("duplicate IDs consistently resolve to the first occurrence", () => {
  const duplicates = [station("node/1", 10, 20), station("node/1", 40, 50)];
  assert.equal(resolveStationSelection({ stationId: "node/1", stations: duplicates, activation: 1 }, duplicates), duplicates[0]);
});
