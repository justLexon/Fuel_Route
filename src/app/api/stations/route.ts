// Finds gas stations near a point using the Overpass API (OpenStreetMap data).
// Usage: GET /api/stations?lat=30.50&lng=-90.46
// The public Overpass servers are often busy, so this tries several in order.
// https://wiki.openstreetmap.org/wiki/Overpass_API

import { SEARCH_RADIUS_MILES, type Station } from "@/lib/stations";

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "FuelRoute/0.1 (CMPS 432 class project)";
const METERS_PER_MILE = 1609.34;
const SERVER_TIMEOUT_MS = 50_000;

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

  const radiusMeters = Math.round(SEARCH_RADIUS_MILES * METERS_PER_MILE);
  const query = `[out:json][timeout:25];nwr["amenity"="fuel"](around:${radiusMeters},${lat},${lng});out center tags;`;

  for (const server of OVERPASS_SERVERS) {
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
      });

      if (!res.ok) {
        console.warn(`Overpass ${server} returned ${res.status}, trying next server`);
        continue;
      }

      const data: { elements: OverpassElement[] } = await res.json();
      const stations = data.elements
        .map(toStation)
        .filter((station): station is Station => station !== null);

      return Response.json({ stations });
    } catch (error) {
      console.warn(`Overpass ${server} failed, trying next server:`, error);
    }
  }

  return Response.json(
    { error: "Gas station servers are busy. Try again in a minute." },
    { status: 503 }
  );
}

function toStation(element: OverpassElement): Station | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (lat === undefined || lng === undefined) return null;

  const tags = element.tags ?? {};
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const address = [street, tags["addr:city"]].filter(Boolean).join(", ");

  return {
    id: `${element.type}/${element.id}`,
    name: tags.name ?? tags.brand ?? "Gas station",
    brand: tags.brand ?? null,
    lat,
    lng,
    address: address || null,
    fuels: Object.entries(tags)
      .filter(([key, value]) => key.startsWith("fuel:") && value === "yes")
      .map(([key]) => key.slice("fuel:".length)),
  };
}
