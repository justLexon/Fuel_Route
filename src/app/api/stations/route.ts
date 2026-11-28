// Finds gas stations near a point.
// Usage: GET /api/stations?lat=30.50&lng=-90.46&fuel=regular
// - GasBuddy is the main source: it has every station's location and prices.
// - OpenStreetMap, through the Overpass API, adds names, brands and addresses
//   when its servers answer in time. They're often busy, so this asks several at
//   once, waits only a few seconds past GasBuddy, and caches what they return,
//   even late, so the next search has the names. Stations without a name show
//   the default "Gas station".
// If GasBuddy fails, the OSM stations are shown without prices.
//
// The finished list then goes to the distributed coordinator (src/lib/coordinator.ts),
// whose workers process it in parallel for the vehicle's fuel and drop stations
// that don't sell it. If the coordinator is down, the list is returned as is.
//
// Everything is cached per grid cell (src/lib/cells.ts), first in this server's
// memory, then in Supabase, which all servers and users share
// (_docs/supabase-cache.md). Station info is kept 365 days, prices 30 minutes.
// Without Supabase configured, only the memory cache is used.
// https://wiki.openstreetmap.org/wiki/Overpass_API

import { after } from "next/server";
import { GAS_FUELS, SEARCH_RADIUS_MILES, type GasFuel, type Station } from "@/lib/stations";
import { coordinatorConfigured, processWithCoordinator, type Processing } from "@/lib/coordinator";
import { formatStationAddress } from "@/lib/stationAddress";
import { getGasBuddyPrices, type GasBuddyStation } from "@/lib/gasbuddy";
import type { LatLng } from "@/lib/location";
import { mergeStations } from "@/lib/matchPrices";
import { straightLineMiles } from "@/lib/distance";
import { cellFor, cellRadiusMiles, pointKey, type Cell } from "@/lib/cells";
import { supabaseConfigured } from "@/lib/supabase";
import {
  claimPriceCell,
  markPriceCellFailed,
  markStationCellFailed,
  readAddresses,
  readGasBuddyStations,
  readOsmStations,
  readPriceCell,
  readStationCell,
  saveGasBuddyStations,
  saveOsmStations,
  type CellRow,
} from "@/lib/cacheStore";

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "FuelRoute/0.1 (CMPS 432 class project)";
const METERS_PER_MILE = 1609.34;
const SERVER_TIMEOUT_MS = 30_000;
// On Vercel: a search in a new area waits for GasBuddy (up to ~90 s if EC2 is
// slow) plus a few seconds for names, more than the default limit.
export const maxDuration = 120;

// Each cell's data covers a full search from anywhere in the cell.
const CELL_RADIUS_MILES = cellRadiusMiles(SEARCH_RADIUS_MILES);

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number; // nodes
  lon?: number;
  center?: { lat: number; lon: number }; // ways/relations (station drawn as a building outline)
  tags?: Record<string, string>;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  if (!params.get("lat") || !params.get("lng") || Number.isNaN(lat) || Number.isNaN(lng)) {
    return Response.json({ error: "Missing or invalid lat/lng." }, { status: 400 });
  }
  const fuelParam = params.get("fuel") ?? "regular";
  if (!GAS_FUELS.includes(fuelParam as GasFuel)) {
    return Response.json({ error: `fuel must be one of ${GAS_FUELS.join(", ")}.` }, { status: 400 });
  }
  const fuel = fuelParam as GasFuel;

  // Distances are measured from the searched point (to ~110 m); data is loaded per cell.
  const center: LatLng = { lat: Number(lat.toFixed(3)), lng: Number(lng.toFixed(3)) };
  const cell = cellFor(center);

  // Both start now and run at the same time. A request that's already running
  // for this cell (e.g. another user's) is shared.
  const osm = getOsmStations(cell);
  osm.catch(() => {}); // handled below; this stops an "unhandled rejection" if we stop waiting
  const prices = getPrices(cell);
  // Saving to Supabase, and Overpass if it answers late, finish after the
  // response is sent (even on Vercel), so the next search here has them.
  after(async () => {
    await Promise.allSettled([osm, prices]);
    await Promise.allSettled([...pendingWrites]);
  });

  const gasBuddy = await prices.catch((error: Error) => {
    console.warn(`GasBuddy prices failed for ${cell.key}: ${error.message}`);
    return null;
  });

  let osmStations: Station[] | null;
  if (gasBuddy) {
    // Prices are in, so names are a bonus: give Overpass a few more seconds, not
    // its full timeout. One answer, so the page never changes after it shows.
    osmStations = await Promise.race([osm.catch(() => null), delay(NAMES_GRACE_MS)]);
    if (!osmStations) console.warn(`Overpass not ready; showing GasBuddy stations without names for ${cell.key}`);
  } else {
    // No prices, so Overpass is all there is.
    osmStations = await osm.catch(() => null);
    if (!osmStations) {
      return Response.json(
        { error: "Gas station servers are busy. Try again in a minute." },
        { status: 503 }
      );
    }
  }

  // The cell's data reaches a bit past this search's radius.
  const stations = mergeStations(osmStations, gasBuddy, center, SEARCH_RADIUS_MILES).filter(
    (station) => (straightLineMiles(center, station) ?? Infinity) <= SEARCH_RADIUS_MILES
  );
  const withAddresses = await withSavedAddresses(stations);
  return Response.json(await processDistributed(withAddresses, center, fuel));
}

async function processDistributed(
  stations: Station[],
  center: LatLng,
  fuel: GasFuel
): Promise<{ stations: Station[]; processing: Processing }> {
  if (!coordinatorConfigured() || stations.length === 0) {
    return { stations, processing: { distributed: false } };
  }
  try {
    const result = await processWithCoordinator(stations, center, fuel);
    return { stations: result.stations, processing: { distributed: true, ...result.metrics } };
  } catch (error) {
    console.warn(`Coordinator failed; returning unprocessed stations: ${(error as Error).message}`);
    return { stations, processing: { distributed: false } };
  }
}

// How long to wait for Overpass once GasBuddy has answered.
const NAMES_GRACE_MS = 3_000;

const delay = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

// Supabase writes run in the background; the route's after() waits for them.
const pendingWrites = new Set<Promise<unknown>>();
function inBackground(description: string, write: Promise<unknown>) {
  const tracked = write
    .catch((error: Error) => console.warn(`Supabase: couldn't ${description}: ${error.message}`))
    .finally(() => pendingWrites.delete(tracked));
  pendingWrites.add(tracked);
}

// Fills in addresses looked up earlier (see /api/station-address), so the
// browser only asks for the ones never looked up.
async function withSavedAddresses(stations: Station[]): Promise<Station[]> {
  const missing = stations.filter((station) => !station.address?.trim());
  if (!supabaseConfigured || missing.length === 0) return stations;
  try {
    const saved = await readAddresses(missing.map(pointKey));
    return stations.map((station) =>
      station.address?.trim() ? station : { ...station, address: saved.get(pointKey(station)) ?? null }
    );
  } catch (error) {
    console.warn(`Supabase: couldn't read addresses: ${(error as Error).message}`);
    return stations;
  }
}

// ---- Stations (OpenStreetMap) -----------------------------------------------
// Memory (1 hour) → Supabase (365 days) → Overpass. If Overpass fails, expired
// Supabase rows are used, and Overpass isn't asked again for an hour.

const OSM_MEMORY_MS = 60 * 60 * 1000;
const OSM_FRESH_MS = 365 * 24 * 60 * 60 * 1000;
const OSM_RETRY_MS = 60 * 60 * 1000;
const osmCache = new Map<string, { stations: Station[]; cachedAt: number }>();
const osmInFlight = new Map<string, Promise<Station[]>>();

function getOsmStations(cell: Cell): Promise<Station[]> {
  const cached = osmCache.get(cell.key);
  if (cached && Date.now() - cached.cachedAt < OSM_MEMORY_MS) return Promise.resolve(cached.stations);

  let request = osmInFlight.get(cell.key);
  if (!request) {
    request = loadOsmStations(cell)
      .then((stations) => {
        osmCache.set(cell.key, { stations, cachedAt: Date.now() });
        return stations;
      })
      .catch((error) => {
        // Everything failed. Old names are better than none.
        if (cached) {
          console.warn(`Overpass and Supabase failed; using memory-cached stations for ${cell.key}`);
          return cached.stations;
        }
        throw error;
      })
      .finally(() => osmInFlight.delete(cell.key));
    osmInFlight.set(cell.key, request);
  }
  return request;
}

async function loadOsmStations(cell: Cell): Promise<Station[]> {
  let useDatabase = supabaseConfigured;
  let row: CellRow | null = null;
  if (useDatabase) {
    try {
      row = await readStationCell(cell);
      const fresh = row?.fetchedAt != null && Date.now() - row.fetchedAt < OSM_FRESH_MS;
      const failedRecently = row?.failedAt != null && Date.now() - row.failedAt < OSM_RETRY_MS;
      // Expired but Overpass failed within the hour: keep using the old rows.
      if (fresh || (row?.fetchedAt != null && failedRecently)) {
        return await readOsmStations(cell.center, CELL_RADIUS_MILES);
      }
    } catch (error) {
      console.warn(`Supabase: couldn't read stations for ${cell.key}: ${(error as Error).message}`);
      useDatabase = false;
    }
  }

  try {
    const stations = await fetchFromFastestServer(cell.center, CELL_RADIUS_MILES);
    if (useDatabase) inBackground(`save stations for ${cell.key}`, saveOsmStations(cell, CELL_RADIUS_MILES, stations));
    return stations;
  } catch (error) {
    if (useDatabase) {
      inBackground(`mark ${cell.key} failed`, markStationCellFailed(cell));
      if (row?.fetchedAt != null) {
        console.warn(`All Overpass servers failed; using expired stations for ${cell.key}`);
        return await readOsmStations(cell.center, CELL_RADIUS_MILES);
      }
    }
    throw error;
  }
}

// ---- Prices (GasBuddy) ------------------------------------------------------
// Memory → Supabase → the GasBuddy scraper, all fresh for 30 minutes from the
// scrape. Supabase decides which server scrapes a cell, so two users searching
// the same area at once cause one scrape, not two.

const PRICES_FRESH_MS = 30 * 60 * 1000;
// After the scraper fails (e.g. the EC2 instance is stopped), skip it for a
// minute; each search would otherwise wait for its full timeout.
const PRICES_RETRY_MS = 60 * 1000;
const WAIT_FOR_OTHER_SCRAPE_MS = 30_000;
const POLL_MS = 1_500;

type CellPrices = { stations: GasBuddyStation[]; fetchedAt: number };
const priceCache = new Map<string, CellPrices>();
const priceInFlight = new Map<string, Promise<GasBuddyStation[]>>();
let scraperFailedAt = 0;

function getPrices(cell: Cell): Promise<GasBuddyStation[]> {
  const cached = priceCache.get(cell.key);
  if (cached && Date.now() - cached.fetchedAt < PRICES_FRESH_MS) return Promise.resolve(cached.stations);

  let request = priceInFlight.get(cell.key);
  if (!request) {
    request = loadPrices(cell)
      .then((prices) => {
        priceCache.set(cell.key, prices);
        return prices.stations;
      })
      .finally(() => priceInFlight.delete(cell.key));
    priceInFlight.set(cell.key, request);
  }
  return request;
}

async function loadPrices(cell: Cell): Promise<CellPrices> {
  if (!supabaseConfigured) return scrape(cell);

  let claim: Awaited<ReturnType<typeof claimPriceCell>>;
  try {
    claim = await claimPriceCell(cell, PRICES_FRESH_MS);
  } catch (error) {
    console.warn(`Supabase: couldn't claim prices for ${cell.key}: ${(error as Error).message}`);
    return scrape(cell); // no shared cache right now
  }

  switch (claim.status) {
    case "fresh":
      return readPrices(cell, claim.fetchedAt!);
    case "failed":
      throw new Error("the last scrape failed under a minute ago");
    case "busy": {
      // Another server is scraping this cell; use its result.
      const deadline = Date.now() + WAIT_FOR_OTHER_SCRAPE_MS;
      while (Date.now() < deadline) {
        await delay(POLL_MS);
        const row = await readPriceCell(cell);
        if (row.fetchedAt != null && Date.now() - row.fetchedAt < PRICES_FRESH_MS) {
          return readPrices(cell, row.fetchedAt);
        }
        if (row.claimedAt == null) throw new Error("another server's scrape failed");
      }
      throw new Error("timed out waiting for another server's scrape");
    }
    case "claimed":
      try {
        const prices = await scrape(cell);
        inBackground(`save prices for ${cell.key}`, saveGasBuddyStations(cell, prices.stations));
        return prices;
      } catch (error) {
        inBackground(`mark prices for ${cell.key} failed`, markPriceCellFailed(cell));
        throw error;
      }
  }
}

async function readPrices(cell: Cell, fetchedAt: number): Promise<CellPrices> {
  const stations = await readGasBuddyStations(cell.center, CELL_RADIUS_MILES, Date.now() - PRICES_FRESH_MS);
  return { stations, fetchedAt };
}

async function scrape(cell: Cell): Promise<CellPrices> {
  if (Date.now() - scraperFailedAt < PRICES_RETRY_MS) {
    throw new Error("skipped; the scraper failed less than a minute ago");
  }
  try {
    const stations = await getGasBuddyPrices(cell.center.lat, cell.center.lng);
    return { stations, fetchedAt: Date.now() };
  } catch (error) {
    scraperFailedAt = Date.now();
    throw error;
  }
}

// Sends the query to every server at once and uses the first good answer.
// The other requests are cancelled as soon as one succeeds.
async function fetchFromFastestServer({ lat, lng }: LatLng, radiusMiles: number): Promise<Station[]> {
  const radiusMeters = Math.round(radiusMiles * METERS_PER_MILE);
  const query = `[out:json][timeout:25];nwr["amenity"="fuel"](around:${radiusMeters},${lat},${lng});out center tags;`;
  const cancelOthers = new AbortController();

  try {
    return await Promise.any(
      OVERPASS_SERVERS.map(async (server) => {
        try {
          const res = await fetch(server, {
            method: "POST",
            headers: {
              "User-Agent": USER_AGENT,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.any([cancelOthers.signal, AbortSignal.timeout(SERVER_TIMEOUT_MS)]),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          // A busy server can answer 200 with no stations and a "runtime error" remark.
          const data: { elements: OverpassElement[]; remark?: string } = await res.json();
          if (data.remark?.includes("error")) throw new Error(data.remark);

          return data.elements
            .map(toStation)
            .filter((station): station is Station => station !== null);
        } catch (error) {
          if (!cancelOthers.signal.aborted) {
            console.warn(`Overpass ${new URL(server).host} failed: ${(error as Error).message}`);
          }
          throw error;
        }
      })
    );
  } finally {
    cancelOthers.abort();
  }
}

function toStation(element: OverpassElement): Station | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (lat === undefined || lng === undefined) return null;

  const tags = element.tags ?? {};
  const fuelTags = Object.entries(tags).filter(([key]) =>
    key.startsWith("fuel:")
  );

  return {
    id: `${element.type}/${element.id}`,
    name: tags.name ?? tags.brand ?? "Gas station",
    brand: tags.brand ?? null,
    lat,
    lng,
    address: formatStationAddress(tags),
    fuels: fuelTags
      .filter(([, value]) => value === "yes")
      .map(([key]) => key.slice("fuel:".length)),
    unavailableFuels: fuelTags
      .filter(([, value]) => value === "no")
      .map(([key]) => key.slice("fuel:".length)),
  };
}
