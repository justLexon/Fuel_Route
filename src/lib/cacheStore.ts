// Reads and writes the Supabase cache tables (supabase/schema.sql).
// Server-only. Callers decide what's fresh; see src/app/api/stations/route.ts.

import { boundsAround, type Cell } from "./cells";
import type { GasBuddyStation } from "./gasbuddy";
import type { LatLng } from "./location";
import { straightLineMiles } from "./distance";
import type { Station, StationPrices } from "./stations";
import { inList, supabaseRest } from "./supabase";

const MAX_IDS_PER_REQUEST = 100; // keeps `in.(…)` URLs short
const MAX_ROWS = 2000;

const UPSERT = "resolution=merge-duplicates,return=minimal";

function boxFilter(center: LatLng, radiusMiles: number) {
  const box = boundsAround(center, radiusMiles);
  const f = (n: number) => n.toFixed(6);
  return `and=(lat.gte.${f(box.minLat)},lat.lte.${f(box.maxLat)},lng.gte.${f(box.minLng)},lng.lte.${f(box.maxLng)})`;
}

function chunks<T>(items: T[], size = MAX_IDS_PER_REQUEST): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export type CellRow = { fetchedAt: number | null; failedAt: number | null };

const toTime = (value: string | null | undefined) => (value ? Date.parse(value) : null);

// ---- OSM stations -----------------------------------------------------------

type OsmStationRow = {
  id: string;
  name: string;
  brand: string | null;
  address: string | null;
  lat: number;
  lng: number;
  fuels: string[];
  unavailable_fuels: string[];
};

export async function readStationCell(cell: Cell): Promise<CellRow | null> {
  const rows = await supabaseRest<{ fetched_at: string | null; failed_at: string | null }[]>(
    `station_cells?select=fetched_at,failed_at&cell=eq.${encodeURIComponent(cell.key)}`
  );
  if (rows.length === 0) return null;
  return { fetchedAt: toTime(rows[0].fetched_at), failedAt: toTime(rows[0].failed_at) };
}

export async function readOsmStations(center: LatLng, radiusMiles: number): Promise<Station[]> {
  const rows = await supabaseRest<OsmStationRow[]>(
    `osm_stations?select=id,name,brand,address,lat,lng,fuels,unavailable_fuels&${boxFilter(center, radiusMiles)}&limit=${MAX_ROWS}`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    lat: row.lat,
    lng: row.lng,
    address: row.address,
    fuels: row.fuels,
    unavailableFuels: row.unavailable_fuels,
  }));
}

// Replaces what's stored for a cell's area with a fresh Overpass result: stations
// in the area that Overpass no longer has (closed) are deleted, the rest upserted.
export async function saveOsmStations(cell: Cell, radiusMiles: number, stations: Station[]) {
  const now = new Date().toISOString();
  const newIds = new Set(stations.map((station) => station.id));

  // Only delete well inside the queried circle, in case distances differ slightly.
  const stored = await readOsmStations(cell.center, radiusMiles);
  const closed = stored
    .filter((station) => !newIds.has(station.id))
    .filter((station) => (straightLineMiles(cell.center, station) ?? Infinity) < radiusMiles - 0.1)
    .map((station) => station.id);
  for (const ids of chunks(closed)) {
    await supabaseRest(`osm_stations?id=${encodeURIComponent(inList(ids))}`, { method: "DELETE" });
  }

  if (stations.length > 0) {
    await supabaseRest("osm_stations", {
      method: "POST",
      prefer: UPSERT,
      body: stations.map((station) => ({
        id: station.id,
        name: station.name,
        brand: station.brand,
        address: station.address,
        lat: station.lat,
        lng: station.lng,
        fuels: station.fuels,
        unavailable_fuels: station.unavailableFuels ?? [],
        updated_at: now,
      })),
    });
  }
  await supabaseRest("station_cells", {
    method: "POST",
    prefer: UPSERT,
    body: { cell: cell.key, fetched_at: now, failed_at: null },
  });
}

export async function markStationCellFailed(cell: Cell) {
  await supabaseRest("station_cells", {
    method: "POST",
    prefer: UPSERT,
    body: { cell: cell.key, failed_at: new Date().toISOString() },
  });
}

// ---- GasBuddy prices --------------------------------------------------------

export type ClaimStatus = "fresh" | "busy" | "failed" | "claimed";

export async function claimPriceCell(cell: Cell, freshMs: number) {
  const result = await supabaseRest<{ status: ClaimStatus; fetched_at: string | null }>(
    "rpc/claim_price_cell",
    { method: "POST", body: { p_cell: cell.key, p_fresh_seconds: Math.round(freshMs / 1000) } }
  );
  return { status: result.status, fetchedAt: toTime(result.fetched_at) };
}

export async function readPriceCell(cell: Cell): Promise<CellRow & { claimedAt: number | null }> {
  const rows = await supabaseRest<{ fetched_at: string | null; failed_at: string | null; claimed_at: string | null }[]>(
    `price_cells?select=fetched_at,failed_at,claimed_at&cell=eq.${encodeURIComponent(cell.key)}`
  );
  const row = rows[0];
  return {
    fetchedAt: toTime(row?.fetched_at),
    failedAt: toTime(row?.failed_at),
    claimedAt: toTime(row?.claimed_at),
  };
}

export async function readGasBuddyStations(
  center: LatLng,
  radiusMiles: number,
  since: number // only prices scraped after this time
): Promise<GasBuddyStation[]> {
  const rows = await supabaseRest<{ id: number; lat: number; lng: number; prices: StationPrices }[]>(
    `gasbuddy_stations?select=id,lat,lng,prices&${boxFilter(center, radiusMiles)}` +
      `&fetched_at=gte.${encodeURIComponent(new Date(since).toISOString())}&limit=${MAX_ROWS}`
  );
  return rows;
}

export async function saveGasBuddyStations(cell: Cell, stations: GasBuddyStation[]) {
  const now = new Date().toISOString();
  if (stations.length > 0) {
    await supabaseRest("gasbuddy_stations", {
      method: "POST",
      prefer: UPSERT,
      body: stations.map(({ id, lat, lng, prices }) => ({ id, lat, lng, prices, fetched_at: now })),
    });
  }
  await supabaseRest("price_cells", {
    method: "POST",
    prefer: UPSERT,
    body: { cell: cell.key, fetched_at: now, claimed_at: null, failed_at: null },
  });
}

export async function markPriceCellFailed(cell: Cell) {
  await supabaseRest("price_cells", {
    method: "POST",
    prefer: UPSERT,
    body: { cell: cell.key, claimed_at: null, failed_at: new Date().toISOString() },
  });
}

// ---- Looked-up addresses ----------------------------------------------------

// Saved lookups for these points (see pointKey). A point that's missing hasn't
// been looked up; null means Nominatim had no address there.
export async function readAddresses(points: string[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  for (const batch of chunks([...new Set(points)])) {
    const rows = await supabaseRest<{ point: string; address: string | null }[]>(
      `addresses?select=point,address&point=${encodeURIComponent(inList(batch))}`
    );
    for (const row of rows) found.set(row.point, row.address);
  }
  return found;
}

export async function saveAddresses(addresses: Map<string, string | null>) {
  if (addresses.size === 0) return;
  await supabaseRest("addresses", {
    method: "POST",
    prefer: UPSERT,
    body: [...addresses].map(([point, address]) => ({ point, address })),
  });
}
