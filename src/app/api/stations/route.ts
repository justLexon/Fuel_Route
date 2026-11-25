// Finds gas stations near a point using the Overpass API (OpenStreetMap data),
// with fuel prices from GasBuddy where available.
// Usage: GET /api/stations?lat=30.50&lng=-90.46&fuel=regular
// The public Overpass servers are often busy, so this asks several at once,
// and caches results so repeat searches are instant and survive outages.
// https://wiki.openstreetmap.org/wiki/Overpass_API

import { sendCoordinatorRequest } from "@/lib/coordinatorClient";
import { createCoordinatorRequest } from "@/lib/coordinatorRequest";
import { getGasBuddyPrices } from "@/lib/gasbuddy";
import { attachPrices } from "@/lib/matchPrices";
import { FUEL_TYPES, type FuelType } from "@/lib/processing";
import { formatStationAddress } from "@/lib/stationAddress";
import { SEARCH_RADIUS_MILES, type Station } from "@/lib/stations";

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const USER_AGENT = "FuelRoute/0.1 (CMPS 432 class project)";
const METERS_PER_MILE = 1609.34;
const SERVER_TIMEOUT_MS = 30_000;

function isFuelType(value: string): value is FuelType {
  return FUEL_TYPES.some((fuelType) => fuelType === value);
}

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const requestedFuel = params.get("fuel") ?? "regular";

  if (
    !params.get("lat") ||
    !params.get("lng") ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return Response.json(
      { error: "Missing or invalid lat/lng." },
      { status: 400 }
    );
  }

  if (!isFuelType(requestedFuel)) {
    return Response.json(
      { error: "Invalid fuel type." },
      { status: 400 }
    );
  }

  const requiredFuel: FuelType = requestedFuel;

  // Round to 3 decimals (~110 m) so tiny GPS differences share a cache entry.
  const roundedLat = lat.toFixed(3);
  const roundedLng = lng.toFixed(3);
  const key = `${roundedLat},${roundedLng},${SEARCH_RADIUS_MILES}`;

  const cached = cache.get(key);
  if (cached && Date.now() < cached.freshUntil) {
    return createStationsResponse(
      cached.stations,
      { lat, lng },
      requiredFuel
    );
  }

  try {
    // If the same search is already running, wait for it instead of asking again.
    let stationRequest = inFlight.get(key);

    if (!stationRequest) {
      stationRequest = fetchStationsWithPrices(
        roundedLat,
        roundedLng
      ).finally(() => inFlight.delete(key));

      inFlight.set(key, stationRequest);
    }

    const { stations, pricesLoaded } = await stationRequest;

    // If GasBuddy failed, keep the result briefly so prices retry soon.
    const freshMs = pricesLoaded
      ? CACHE_FRESH_MS
      : NO_PRICES_FRESH_MS;

    cache.set(key, {
      stations,
      freshUntil: Date.now() + freshMs,
    });

    return createStationsResponse(
      stations,
      { lat, lng },
      requiredFuel
    );
  } catch {
    // Every server failed. Old results are better than none.
    if (cached) {
      console.warn(
        `All Overpass servers failed; using cached stations for ${key}`
      );

      return createStationsResponse(
        cached.stations,
        { lat, lng },
        requiredFuel
      );
    }

    return Response.json(
      { error: "Gas station servers are busy. Try again in a minute." },
      { status: 503 }
    );
  }
}

async function createStationsResponse(
  stations: Station[],
  userLocation: { lat: number; lng: number },
  requiredFuel: FuelType
): Promise<Response> {
  const coordinatorUrl = process.env.COORDINATOR_URL?.trim();

  // Local development still works when the coordinator is not running.
  if (!coordinatorUrl) {
    return Response.json({
      stations,
      processing: null,
    });
  }

  try {
    const coordinatorResponse = await sendCoordinatorRequest(
      createCoordinatorRequest({
        userLocation,
        requiredFuel,
        stations,
      }),
      { coordinatorUrl }
    );

    return Response.json({
      stations: coordinatorResponse.stations,
      processing: {
        jobId: coordinatorResponse.jobId,
        ...coordinatorResponse.metrics,
      },
    });
  } catch (error) {
    // Station search remains usable if distributed services are unavailable.
    console.warn(
      "Distributed processing failed; returning unprocessed stations:",
      error instanceof Error ? error.message : error
    );

    return Response.json({
      stations,
      processing: null,
      processingError:
        "Distributed processing is temporarily unavailable.",
    });
  }
}

// In-memory cache. It is cleared when the server restarts, and each Vercel
// instance has its own copy.
const CACHE_FRESH_MS = 30 * 60 * 1000;
const NO_PRICES_FRESH_MS = 60 * 1000;

type StationsWithPrices = {
  stations: Station[];
  pricesLoaded: boolean;
};

const cache = new Map<
  string,
  { stations: Station[]; freshUntil: number }
>();

const inFlight = new Map<
  string,
  Promise<StationsWithPrices>
>();

// Gets stations from Overpass and prices from GasBuddy at the same time, then
// matches them. If GasBuddy fails, stations still load without prices.
async function fetchStationsWithPrices(
  lat: string,
  lng: string
): Promise<StationsWithPrices> {
  const [stations, prices] = await Promise.all([
    fetchFromFastestServer(lat, lng),
    getGasBuddyPrices(Number(lat), Number(lng)).catch(
      (error: Error) => {
        console.warn(`GasBuddy prices failed: ${error.message}`);
        return null;
      }
    ),
  ]);

  return {
    stations: attachPrices(stations, prices ?? []),
    pricesLoaded: prices !== null,
  };
}

// Sends the query to every server at once and uses the first good answer.
// The other requests are cancelled as soon as one succeeds.
async function fetchFromFastestServer(
  lat: string,
  lng: string
): Promise<Station[]> {
  const radiusMeters = Math.round(
    SEARCH_RADIUS_MILES * METERS_PER_MILE
  );

  const query =
    `[out:json][timeout:25];` +
    `nwr["amenity"="fuel"]` +
    `(around:${radiusMeters},${lat},${lng});` +
    "out center tags;";

  const cancelOthers = new AbortController();

  try {
    return await Promise.any(
      OVERPASS_SERVERS.map(async (server) => {
        try {
          const response = await fetch(server, {
            method: "POST",
            headers: {
              "User-Agent": USER_AGENT,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.any([
              cancelOthers.signal,
              AbortSignal.timeout(SERVER_TIMEOUT_MS),
            ]),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data: {
            elements: OverpassElement[];
            remark?: string;
          } = await response.json();

          if (data.remark?.includes("error")) {
            throw new Error(data.remark);
          }

          return data.elements
            .map(toStation)
            .filter(
              (station): station is Station => station !== null
            );
        } catch (error) {
          if (!cancelOthers.signal.aborted) {
            console.warn(
              `Overpass ${new URL(server).host} failed: ${
                (error as Error).message
              }`
            );
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