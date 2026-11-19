import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReverseAddress } from "./reverseAddress";

// Real Nominatim response for 30.2020, -92.0773.
const GUILBEAU = {
  house_number: "889",
  road: "Guilbeau Road",
  city: "Lafayette",
  county: "Lafayette Parish",
  state: "Louisiana",
  "ISO3166-2-lvl4": "US-LA",
  postcode: "70506",
  country: "United States",
};
const station = { lat: 30.2027, lng: -92.0773 };

test("formats like the OSM addresses on the cards", () => {
  assert.equal(
    formatReverseAddress(GUILBEAU, station, { lat: 30.20272, lng: -92.0773 }),
    "889 Guilbeau Road, Lafayette, LA, 70506"
  );
});

test("drops the house number when the match is a different building", () => {
  // About 0.06 mi (100 m) north of the station.
  assert.equal(
    formatReverseAddress(GUILBEAU, station, { lat: 30.2036, lng: -92.0773 }),
    "Guilbeau Road, Lafayette, LA, 70506"
  );
});

test("uses town or village when there's no city, and the state name without an ISO code", () => {
  assert.equal(
    formatReverseAddress({ road: "Main St", town: "Scott", state: "Louisiana" }, station, station),
    "Main St, Scott, Louisiana"
  );
});

test("no road means no address", () => {
  assert.equal(formatReverseAddress({ city: "Lafayette", state: "Louisiana" }, station, station), null);
});
