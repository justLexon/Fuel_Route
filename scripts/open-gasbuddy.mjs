// Opens GasBuddy's gas price map at a location in Chrome, one tab per fuel type
// (all loading at once), and prints the prices the map loads for that area.
// Fuel types with no prices in the area are left out.
//
// Run from the project root:
//   node scripts/open-gasbuddy.mjs <lat> <lng> [zoom]
//   node scripts/open-gasbuddy.mjs 30.2020 -92.0773
//
// Uses your installed Chrome (no browser download). Keep headless: false;
// GasBuddy's bot check blocks hidden browsers.

import { chromium } from "playwright-core";

// The map's `fuel` URL parameter for each fuel type.
const FUELS = [
  { key: "regular", label: "Regular", id: 1 },
  { key: "midgrade", label: "Midgrade", id: 2 },
  { key: "premium", label: "Premium", id: 3 },
  { key: "diesel", label: "Diesel", id: 4 },
  { key: "e85", label: "E85", id: 5 },
];

const [lat, lng, zoom = "12"] = process.argv.slice(2);

if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
  console.error("Usage: node scripts/open-gasbuddy.mjs <lat> <lng> [zoom]");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: false });

async function loadFuel(fuel) {
  // Tall window: the map only loads its data once it's on screen.
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

  // The map asks GasBuddy for the stations in its visible area with this request.
  const mapResponse = page.waitForResponse(
    (res) => res.url().endsWith("/gaspricemap/map") && res.request().method() === "POST",
    { timeout: 60_000 }
  );
  // Only wait for the page to start loading; the full load (ads, trackers) can take over 30 s.
  await page.goto(
    `https://www.gasbuddy.com/gaspricemap?lat=${lat}&lng=${lng}&z=${zoom}&fuel=${fuel.id}`,
    { waitUntil: "commit", timeout: 60_000 }
  );
  const data = await (await mapResponse).json();

  // Each station: { id, lat, lng, price: "3.16" or "--", iscash, ... }
  return [...data.primaryStations, ...data.secondaryStations]
    .filter((station) => station.price !== "--")
    .map((station) => ({ ...station, price: Number(station.price) }));
}

try {
  const results = await Promise.allSettled(FUELS.map(loadFuel));

  // Combine every fuel's prices into one row per station.
  const byId = new Map();
  const fuelsWithPrices = [];
  results.forEach((result, i) => {
    const fuel = FUELS[i];
    if (result.status === "rejected") {
      console.warn(`${fuel.label}: couldn't load (${result.reason.message})`);
      return;
    }
    if (result.value.length === 0) return;
    fuelsWithPrices.push(fuel);

    for (const station of result.value) {
      const row = byId.get(station.id) ?? { id: station.id, lat: station.lat, lng: station.lng };
      row[fuel.label] = station.iscash ? `${station.price.toFixed(2)} cash` : station.price.toFixed(2);
      byId.set(station.id, row);
    }

    const prices = result.value.map((station) => station.price).sort((a, b) => a - b);
    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    console.log(
      `${fuel.label.padEnd(9)} ${String(prices.length).padStart(3)} stations | ` +
        `Lowest $${prices[0].toFixed(2)} | Average $${average.toFixed(2)} | Highest $${prices.at(-1).toFixed(2)}`
    );
  });

  if (fuelsWithPrices.length === 0) {
    console.log(`No prices found near ${lat}, ${lng}.`);
  } else {
    // Cheapest regular first; stations without a regular price go last.
    const firstFuel = fuelsWithPrices[0].label;
    const rows = [...byId.values()].sort(
      (a, b) => parseFloat(a[firstFuel] ?? Infinity) - parseFloat(b[firstFuel] ?? Infinity)
    );
    console.log(`\n${rows.length} stations near ${lat}, ${lng}`);
    console.table(rows, ["id", "lat", "lng", ...fuelsWithPrices.map((fuel) => fuel.label)]);
  }
} catch (error) {
  console.error("Couldn't get prices:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
