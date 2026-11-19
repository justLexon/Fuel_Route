import assert from "node:assert/strict";
import { test } from "vitest";
import {
  determineFuelCompatibility,
  normalizeStationFuelTag,
  normalizeVehicleFuel,
} from "./fuelCompatibility";

test("normalizes common FuelEconomy vehicle fuel descriptions", () => {
  assert.equal(normalizeVehicleFuel("Regular Gasoline"), "regular");
  assert.equal(normalizeVehicleFuel("Midgrade Gasoline"), "midgrade");
  assert.equal(normalizeVehicleFuel("Premium Gasoline"), "premium");
  assert.equal(normalizeVehicleFuel("Diesel"), "diesel");
  assert.equal(normalizeVehicleFuel("E85"), "e85");
  assert.equal(normalizeVehicleFuel("Compressed Natural Gas"), "cng");
  assert.equal(normalizeVehicleFuel("Propane"), "lpg");
  assert.equal(normalizeVehicleFuel("Electricity"), "electric");
  assert.equal(normalizeVehicleFuel("Hydrogen"), "hydrogen");
});

test("prefers the gasoline requirement for hybrid descriptions", () => {
  assert.equal(
    normalizeVehicleFuel("Regular Gas and Electricity"),
    "regular"
  );
  assert.equal(
    normalizeVehicleFuel("Premium Gasoline or Electricity"),
    "premium"
  );
});

test("missing and unsupported vehicle fuels normalize to unknown", () => {
  assert.equal(normalizeVehicleFuel(null), "unknown");
  assert.equal(normalizeVehicleFuel(undefined), "unknown");
  assert.equal(normalizeVehicleFuel("  "), "unknown");
  assert.equal(normalizeVehicleFuel("Unobtainium"), "unknown");
});

test("normalizes OSM octane tags", () => {
  assert.equal(normalizeStationFuelTag("octane_85"), "regular");
  assert.equal(normalizeStationFuelTag("octane_87"), "regular");
  assert.equal(normalizeStationFuelTag("octane_89"), "midgrade");
  assert.equal(normalizeStationFuelTag("octane_91"), "premium");
  assert.equal(normalizeStationFuelTag("octane_93"), "premium");
});

test("normalizes common named OSM fuel tags", () => {
  assert.equal(normalizeStationFuelTag("diesel"), "diesel");
  assert.equal(normalizeStationFuelTag("HGV-diesel"), "diesel");
  assert.equal(normalizeStationFuelTag("e85"), "e85");
  assert.equal(normalizeStationFuelTag("CNG"), "cng");
  assert.equal(normalizeStationFuelTag("autogas"), "lpg");
  assert.equal(normalizeStationFuelTag("electricity"), "electric");
  assert.equal(normalizeStationFuelTag("unknown-fuel"), null);
});

test("accepts higher-octane gasoline for regular and midgrade vehicles", () => {
  assert.equal(
    determineFuelCompatibility("regular", ["octane_91"]),
    "compatible"
  );
  assert.equal(
    determineFuelCompatibility("midgrade", ["octane_93"]),
    "compatible"
  );
});

test("matches specialized fuels exactly", () => {
  assert.equal(
    determineFuelCompatibility("diesel", ["diesel"]),
    "compatible"
  );
  assert.equal(
    determineFuelCompatibility("e85", ["e85"]),
    "compatible"
  );
  assert.equal(
    determineFuelCompatibility("electric", ["electricity"]),
    "compatible"
  );
});

test("incomplete station tags produce unknown compatibility", () => {
  assert.equal(determineFuelCompatibility("diesel", []), "unknown");
  assert.equal(
    determineFuelCompatibility("diesel", ["octane_87"]),
    "unknown"
  );
  assert.equal(
    determineFuelCompatibility("unknown", ["diesel"]),
    "unknown"
  );
});

test("explicit unavailable tags can establish incompatibility", () => {
  assert.equal(
    determineFuelCompatibility("diesel", [], ["diesel"]),
    "incompatible"
  );

  assert.equal(
    determineFuelCompatibility(
      "regular",
      [],
      ["octane_87", "octane_89", "octane_93"]
    ),
    "incompatible"
  );

  assert.equal(
    determineFuelCompatibility("regular", [], ["octane_87"]),
    "unknown"
  );
});

test("an available compatible fuel overrides conflicting unavailable data", () => {
  assert.equal(
    determineFuelCompatibility(
      "diesel",
      ["diesel"],
      ["diesel"]
    ),
    "compatible"
  );
});