// Gets gas prices near a point by opening GasBuddy's price map in Chrome and
// reading the station data the map loads. One tab per fuel type per map tile,
// all loading in parallel.
// Server only. Needs Chrome installed and a visible window (GasBuddy's bot
// check blocks hidden browsers), so it works on a dev PC but not on Vercel.
// When PRICE_SERVICE_URL is set, the same lookup runs on our EC2 price service
// instead (see _docs/price-service-ec2.md), and this machine needs no Chrome.

import { chromium, type Browser } from "playwright-core";
import type { GasFuel, StationPrices } from "./stations";

export type GasBuddyStation = {
  id: number; // GasBuddy's station id (the same across fuel types)
  lat: number;
  lng: number;
  prices: StationPrices;
};

// The map's `fuel` URL parameter for each fuel type.
const FUEL_IDS: Record<GasFuel, number> = {
  regular: 1,
  midgrade: 2,
  premium: 3,
  diesel: 4,
  e85: 5,
};

// The map always covers about 25 x 12 miles at zoom 12 (zooming out drops
// stations), so a 10-mile search needs two tiles: one north, one south.
const ZOOM = 12;
const TILE_LAT_OFFSET = 0.089; // ~6 miles, half a tile's height
const MAP_TIMEOUT_MS = 45_000;
// One uncached map view takes the service about 1-15 s (5 fuel tabs, maybe
// waiting for a free tab), so allow plenty.
const SERVICE_TIMEOUT_MS = 90_000;

export async function getGasBuddyPrices(lat: number, lng: number): Promise<GasBuddyStation[]> {
  const serviceUrl = process.env.PRICE_SERVICE_URL?.trim();
  if (serviceUrl) return getPricesFromService(serviceUrl.replace(/\/+$/, ""), lat, lng);

  const browser = await chromium.launch({ channel: "chrome", headless: false });

  try {
    const tabs = (Object.keys(FUEL_IDS) as GasFuel[]).flatMap((fuel) =>
      [lat + TILE_LAT_OFFSET, lat - TILE_LAT_OFFSET].map((tileLat) =>
        loadMapTile(browser, tileLat, lng, fuel)
      )
    );
    const results = await Promise.allSettled(tabs);

    // One slow or failed tab shouldn't throw away the others.
    const loaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (loaded.length === 0) {
      throw (results[0] as PromiseRejectedResult).reason;
    }
    const failed = results.length - loaded.length;
    if (failed > 0) console.warn(`GasBuddy: ${failed} of ${results.length} map tabs failed`);

    // Combine every tab's prices into one entry per GasBuddy station. Tiles
    // overlap, so the same station and fuel can appear twice.
    const byId = new Map<number, GasBuddyStation>();
    for (const { fuel, stations } of loaded) {
      for (const station of stations) {
        const entry = byId.get(station.id) ?? { id: station.id, lat: station.lat, lng: station.lng, prices: {} };
        entry.prices[fuel] = { price: station.price, cash: station.cash };
        byId.set(station.id, entry);
      }
    }
    return [...byId.values()];
  } finally {
    await browser.close();
  }
}

// Asks the EC2 price service for the same two map views the local code loads
// (north and south of the search). Each view comes back with all fuel types.
async function getPricesFromService(serviceUrl: string, lat: number, lng: number) {
  const views = await Promise.allSettled(
    [lat + TILE_LAT_OFFSET, lat - TILE_LAT_OFFSET].map(async (viewLat) => {
      const res = await fetch(`${serviceUrl}/prices?lat=${viewLat}&lng=${lng}`, {
        headers: { "x-price-secret": process.env.PRICE_SERVICE_SECRET ?? "" },
        signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Price service returned ${res.status}`);
      const data: { stations: GasBuddyStation[]; failedFuels: GasFuel[] } = await res.json();
      if (data.failedFuels.length > 0) {
        console.warn(`Price service: ${data.failedFuels.join(", ")} failed for one map view`);
      }
      return data.stations;
    })
  );

  const loaded = views.flatMap((view) => (view.status === "fulfilled" ? [view.value] : []));
  if (loaded.length === 0) throw (views[0] as PromiseRejectedResult).reason;
  if (loaded.length < views.length) console.warn("Price service: 1 of 2 map views failed");

  // The two views overlap, so merge each station's prices.
  const byId = new Map<number, GasBuddyStation>();
  for (const station of loaded.flat()) {
    const existing = byId.get(station.id);
    byId.set(station.id, existing ? { ...existing, prices: { ...existing.prices, ...station.prices } } : station);
  }
  return [...byId.values()];
}

type MapStation = {
  id: number;
  lat: number;
  lng: number;
  price: string; // "3.16", or "--" when there's no price
  iscash: boolean;
};

async function loadMapTile(browser: Browser, lat: number, lng: number, fuel: GasFuel) {
  // The map only loads its data once it's on screen, and it sits below the
  // header and notices, so use a tall window to keep it in view.
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

  // The map asks GasBuddy for the stations in its visible area with this request.
  const mapResponse = page.waitForResponse(
    (res) => res.url().endsWith("/gaspricemap/map") && res.request().method() === "POST",
    { timeout: MAP_TIMEOUT_MS }
  );
  // Only wait for the page to start loading; the full load (ads, trackers) can
  // take over 30 s, and all we need is the map request above.
  await page.goto(
    `https://www.gasbuddy.com/gaspricemap?lat=${lat}&lng=${lng}&z=${ZOOM}&fuel=${FUEL_IDS[fuel]}`,
    { waitUntil: "commit", timeout: MAP_TIMEOUT_MS }
  );
  const data: { primaryStations: MapStation[]; secondaryStations: MapStation[] } =
    await (await mapResponse).json();

  const stations = [...data.primaryStations, ...data.secondaryStations]
    .filter((station) => station.price !== "--")
    .map((station) => ({
      id: station.id,
      lat: station.lat,
      lng: station.lng,
      price: Number(station.price),
      cash: station.iscash,
    }));
  return { fuel, stations };
}
