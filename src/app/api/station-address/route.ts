// Looks up a street address for a station whose OSM data has none.
//   GET /api/station-address?lat=30.20&lng=-92.07  ->  { address: string | null }
// Uses Nominatim reverse geocoding. Its rules allow at most 1 request/second,
// so lookups wait in a queue here, and answers are cached since stations don't move.
// https://operations.osmfoundation.org/policies/nominatim/
// TODO: once stations are stored in Supabase, save the address there instead
// (see _docs/supabase-cache.md) so each station is looked up only once, ever.

import { formatReverseAddress, type NominatimAddress } from "@/lib/reverseAddress";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "FuelRoute/0.1 (CMPS 432 class project)";
const MIN_GAP_MS = 1100; // a little over 1 second between requests
const MAX_CACHE_ENTRIES = 5000;

// Keyed by coordinates rounded to ~1 m. null = Nominatim had no street here.
const cache = new Map<string, string | null>();
// Each lookup waits for the one before it, then for the gap.
let queue: Promise<unknown> = Promise.resolve();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!params.get("lat") || !params.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Missing or invalid lat/lng." }, { status: 400 });
  }

  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return Response.json({ address: cache.get(key) });

  const lookup = queue.then(async () => {
    // The user may have moved on (new search, closed tab) while this waited.
    if (request.signal.aborted) return undefined;
    if (cache.has(key)) return cache.get(key);
    try {
      return await reverseLookup(lat, lng);
    } finally {
      await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS));
    }
  });
  queue = lookup.catch(() => {});

  try {
    const address = await lookup;
    if (address === undefined) return Response.json({ address: null });
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, address);
    return Response.json({ address });
  } catch {
    // Not cached, so it's tried again next time.
    return Response.json({ error: "Address lookup failed." }, { status: 502 });
  }
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
