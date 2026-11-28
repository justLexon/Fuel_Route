// Sends a search's stations to the distributed coordinator (services/coordinator),
// which splits them into batches, has the worker services process the batches
// in parallel (distance, fuel compatibility, price), then merges and ranks them.
// Server only. Set COORDINATOR_URL (and COORDINATOR_SECRET when it's behind the
// EC2 proxy) to use it; see _docs/coordinator-ec2.md.

import type { LatLng } from "./location";
import type {
  CoordinatorRequest,
  CoordinatorResponse,
  ProcessingMetrics,
  StationPrice,
} from "./processing";
import type { GasFuel, Station } from "./stations";

const TIMEOUT_MS = 5_000;

export type DistributedResult = {
  stations: Station[]; // incompatible stations removed, in the coordinator's ranking order
  metrics: ProcessingMetrics;
};

// What the page shows about how a search's list was processed.
export type Processing =
  | ({ distributed: true } & ProcessingMetrics)
  | { distributed: false };

export function coordinatorConfigured() {
  return Boolean(process.env.COORDINATOR_URL?.trim());
}

// Throws if the coordinator is down, slow, or answers with an error; the caller
// then ranks the stations itself.
export async function processWithCoordinator(
  stations: Station[],
  userLocation: LatLng,
  fuel: GasFuel
): Promise<DistributedResult> {
  const baseUrl = process.env.COORDINATOR_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("COORDINATOR_URL is not set");

  const pricesByStationId: Record<string, StationPrice[]> = {};
  for (const station of stations) {
    const prices = Object.entries(station.prices ?? {}).map(([fuelType, entry]) => ({
      fuelType: fuelType as GasFuel,
      centsPerGallon: Math.round(entry!.price * 1000) / 10,
      source: entry!.cash ? "gasbuddy-cash" : "gasbuddy",
      observedAt: null,
    }));
    if (prices.length > 0) pricesByStationId[station.id] = prices;
  }

  const request: CoordinatorRequest = {
    userLocation,
    requiredFuel: fuel,
    // The workers' protocol has no `prices` field; prices go in pricesByStationId.
    stations: stations.map((station) => {
      const copy = { ...station };
      delete copy.prices;
      return copy;
    }),
    pricesByStationId,
    sortBy: "best",
    mode: "distributed",
  };

  const res = await fetch(`${baseUrl}/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-coordinator-secret": process.env.COORDINATOR_SECRET ?? "",
    },
    body: JSON.stringify(request),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => null)) as (CoordinatorResponse & { error?: string }) | null;
  if (!res.ok || !data?.stations) {
    throw new Error(`coordinator HTTP ${res.status}${data?.error ? `: ${data.error}` : ""}`);
  }
  if (data.metrics.failedBatches > 0) {
    throw new Error(`${data.metrics.failedBatches} batch(es) failed on every worker`);
  }

  // Keep our own station objects (with all prices), in the coordinator's order.
  const byId = new Map(stations.map((station) => [station.id, station]));
  const ranked = data.stations
    .map((processed) => byId.get(processed.id))
    .filter((station): station is Station => station !== undefined);
  return { stations: ranked, metrics: data.metrics };
}
