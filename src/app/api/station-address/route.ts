// Looks up street addresses for stations whose OSM data has none.
//   POST /api/station-address   { points: [{ id, lat, lng }, ...] }   (at most 24)
//   -> { addresses: { [id]: string | null } }   null: no address found, or the lookup failed
// Answers once every point is done, so the page can show a whole page of cards at once.
// Uses Nominatim reverse geocoding. Its rules allow at most 1 request/second,
// so lookups wait in a queue here, and answers are cached since stations don't move.
// Lookups are also saved in Supabase (the addresses table), so each station is
// looked up once, ever, by any server.
// https://operations.osmfoundation.org/policies/nominatim/

import { after } from "next/server";
import { formatReverseAddress, type NominatimAddress } from "@/lib/reverseAddress";
import { pointKey } from "@/lib/cells";
import { supabaseConfigured } from "@/lib/supabase";
import { readAddresses, saveAddresses } from "@/lib/cacheStore";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "FuelRoute/0.1 (CMPS 432 class project)";
const MIN_GAP_MS = 1100; // a little over 1 second between requests
const MAX_CACHE_ENTRIES = 5000;
const MAX_POINTS = 24;

type Point = { id: string; lat: number; lng: number };

// Keyed by coordinates rounded to ~1 m. null = Nominatim had no street here.
const cache = new Map<string, string | null>();
// Each Nominatim request waits for the one before it, plus the gap.
let queue: Promise<unknown> = Promise.resolve();

export async function POST(request: Request) {
  const body: { points?: unknown } | null = await request.json().catch(() => null);
  const points = Array.isArray(body?.points) ? body.points : null;
  if (!points || points.length > MAX_POINTS || !points.every(isPoint)) {
    return Response.json(
      { error: `Send { points: [{ id, lat, lng }] }, at most ${MAX_POINTS}.` },
      { status: 400 }
    );
  }

  await loadSaved(points);
  const looked: Map<string, string | null> = new Map();
  // A failed lookup is null here but isn't cached, so it's tried again next time.
  const results = await Promise.all(
    points.map((point) =>
      lookUpAddress(point.lat, point.lng, request.signal, looked).catch(() => null)
    )
  );
  if (supabaseConfigured && looked.size > 0) {
    after(() =>
      saveAddresses(looked).catch((error: Error) =>
        console.warn(`Supabase: couldn't save addresses: ${error.message}`)
      )
    );
  }
  const addresses = Object.fromEntries(points.map((point, i) => [point.id, results[i]]));
  return Response.json({ addresses });
}

function isPoint(value: unknown): value is Point {
  const point = value as Partial<Point> | null;
  return typeof point?.id === "string" &&
    typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    typeof point.lng === "number" && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

// Copies saved Supabase lookups for these points into the memory cache.
async function loadSaved(points: Point[]) {
  const unknown = points.map(pointKey).filter((key) => !cache.has(key));
  if (!supabaseConfigured || unknown.length === 0) return;
  try {
    for (const [key, address] of await readAddresses(unknown)) remember(key, address);
  } catch (error) {
    console.warn(`Supabase: couldn't read addresses: ${(error as Error).message}`);
  }
}

function remember(key: string, address: string | null) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, address);
}

// `looked` collects answers from Nominatim, to save to Supabase.
function lookUpAddress(
  lat: number,
  lng: number,
  signal: AbortSignal,
  looked: Map<string, string | null>
): Promise<string | null> {
  const key = pointKey({ lat, lng });
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);

  let askedNominatim = false;
  const lookup = queue.then(async () => {
    // The user may have moved on (new search, closed tab) while this waited.
    if (signal.aborted) return null;
    if (cache.has(key)) return cache.get(key) ?? null;
    askedNominatim = true;
    const address = await reverseLookup(lat, lng);
    remember(key, address);
    looked.set(key, address);
    return address;
  });
  // The next lookup waits for the gap, but this one answers right away.
  queue = lookup
    .catch(() => {})
    .then(() => (askedNominatim ? new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS)) : undefined));
  return lookup;
}

async function reverseLookup(lat: number, lng: number): Promise<string | null> {
  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18"); // building level

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);

  const result: { lat?: string; lon?: string; address?: NominatimAddress; error?: string } = await res.json();
  // { error: "Unable to geocode" } means there's nothing here, which is a real answer.
  if (result.error || !result.address) return null;

  return formatReverseAddress(
    result.address,
    { lat, lng },
    { lat: Number(result.lat), lng: Number(result.lon) }
  );
}
