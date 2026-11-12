import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStationAddress } from "./stationAddress";

test("complete street address includes city, state, and postcode", () => {
  assert.equal(formatStationAddress({
    "addr:housenumber": "1200", "addr:street": "Main Street",
    "addr:city": "Metairie", "addr:state": "LA", "addr:postcode": "70003",
  }), "1200 Main Street, Metairie, LA, 70003");
});

test("full-address-only data is used and trimmed", () => {
  assert.equal(formatStationAddress({ "addr:full": "  1200 Main Street, Metairie LA 70003  " }),
    "1200 Main Street, Metairie LA 70003");
});

test("meaningful full address wins without appending conflicting structured fields", () => {
  assert.equal(formatStationAddress({ "addr:full": "123 Real Road", "addr:street": "Other Road", "addr:city": "Elsewhere" }), "123 Real Road");
});

test("street without a house number is retained", () => {
  assert.equal(formatStationAddress({ "addr:street": "Main Street", "addr:city": "Metairie" }), "Main Street, Metairie");
});

test("city-only information is clearly labeled as an area", () => {
  assert.equal(formatStationAddress({ "addr:city": "Metairie" }), "Area: Metairie");
});

test("postcode-only and state-only information remain honest area labels", () => {
  assert.equal(formatStationAddress({ "addr:postcode": "70506" }), "Area: 70506");
  assert.equal(formatStationAddress({ "addr:state": "LA" }), "Area: LA");
});

test("house number alone is omitted, while available locality is retained", () => {
  assert.equal(formatStationAddress({ "addr:housenumber": "123" }), null);
  assert.equal(formatStationAddress({ "addr:housenumber": "123", "addr:city": "Metairie" }), "Area: Metairie");
});

test("whitespace-only values and missing fields return null", () => {
  assert.equal(formatStationAddress({}), null);
  assert.equal(formatStationAddress({ "addr:full": " \n ", "addr:street": " \t ", "addr:city": " " }), null);
  assert.equal(formatStationAddress({ name: "Station", brand: "Brand" }), null);
});

test("blank full address falls through and every structured value is trimmed", () => {
  assert.equal(formatStationAddress({ "addr:full": " ", "addr:housenumber": " 12 ",
    "addr:street": " Main St \n", "addr:city": " Metairie ", "addr:state": " LA ", "addr:postcode": " 70003 " }),
  "12 Main St, Metairie, LA, 70003");
});

test("explicit numbered place addresses are supported; street takes priority", () => {
  assert.equal(formatStationAddress({ "addr:housenumber": "12", "addr:place": "Example Village", "addr:city": "Metairie" }), "12 Example Village, Metairie");
  assert.equal(formatStationAddress({ "addr:housenumber": "12", "addr:street": "Main St", "addr:place": "Example Village" }), "12 Main St");
  assert.equal(formatStationAddress({ "addr:place": "Example Village" }), "Area: Example Village");
});

test("duplicate locality components are omitted case-insensitively", () => {
  assert.equal(formatStationAddress({ "addr:place": "Metairie", "addr:city": "metairie", "addr:state": "LA" }), "Area: Metairie, LA");
  assert.equal(formatStationAddress({ "addr:street": "Main St, Metairie", "addr:city": "Metairie" }), "Main St, Metairie");
  assert.equal(formatStationAddress({ "addr:full": "12 Main St, Metairie, metairie" }), "12 Main St, Metairie");
});

test("capitalization, internal spacing, and valid numbers are preserved", () => {
  assert.equal(formatStationAddress({ "addr:housenumber": "12-B", "addr:street": "McKay's  Road", "addr:state": "LA", "addr:postcode": "70003-1234" }), "12-B McKay's  Road, LA, 70003-1234");
  assert.equal(formatStationAddress({ "addr:housenumber": "70003", "addr:street": "Highway 70003", "addr:postcode": "70003" }), "70003 Highway 70003, 70003");
});

test("numeric or punctuation-only full addresses do not become street addresses", () => {
  assert.equal(formatStationAddress({ "addr:full": "123" }), null);
  assert.equal(formatStationAddress({ "addr:full": ", ," }), null);
  assert.equal(formatStationAddress({ "addr:full": "123", "addr:street": "Main St" }), "Main St");
});

test("formatting does not mutate the source tags", () => {
  const tags = Object.freeze({ "addr:street": " Main St ", "addr:city": " Metairie " });
  assert.equal(formatStationAddress(tags), "Main St, Metairie");
  assert.equal(tags["addr:street"], " Main St ");
});

test("full address matching an alphanumeric house number is not displayed alone", () => {
  assert.equal(formatStationAddress({ "addr:full": "12-B", "addr:housenumber": "12-B" }), null);
  assert.equal(formatStationAddress({ "addr:full": " 12-b ", "addr:housenumber": " 12-B ", "addr:city": "Metairie" }), "Area: Metairie");
});

test("house-number-only full address falls through to available street information", () => {
  assert.equal(formatStationAddress({ "addr:full": "12-B", "addr:housenumber": "12-B", "addr:street": "Main St" }), "12-B Main St");
});

test("full address matching a known city uses partial-location formatting", () => {
  assert.equal(formatStationAddress({ "addr:full": "Metairie", "addr:city": "Metairie" }), "Area: Metairie");
  assert.equal(formatStationAddress({ "addr:full": " METAIRIE ", "addr:city": " Metairie ", "addr:state": "LA", "addr:postcode": "70003" }), "Area: Metairie, LA, 70003");
});

test("exact matching recognizes state, postcode, and place without guessing", () => {
  assert.equal(formatStationAddress({ "addr:full": "LA", "addr:state": "LA" }), "Area: LA");
  assert.equal(formatStationAddress({ "addr:full": "AB12  3CD", "addr:postcode": " AB12 3CD " }), "Area: AB12 3CD");
  assert.equal(formatStationAddress({ "addr:full": " example  village ", "addr:place": "Example Village" }), "Area: Example Village");
});

test("locality-only full address falls through to a known street when available", () => {
  assert.equal(formatStationAddress({ "addr:full": "Metairie", "addr:city": "Metairie", "addr:street": "Main St" }), "Main St, Metairie");
});

test("legitimate full addresses containing known incomplete fields are preserved", () => {
  assert.equal(formatStationAddress({ "addr:full": "12-B Main St, Metairie, LA 70003", "addr:housenumber": "12-B", "addr:city": "Metairie", "addr:state": "LA", "addr:postcode": "70003" }), "12-B Main St, Metairie, LA 70003");
  assert.equal(formatStationAddress({ "addr:full": "Metairie Road", "addr:city": "Metairie" }), "Metairie Road");
});
