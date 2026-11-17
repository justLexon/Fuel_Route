import type {
  CoordinatorRequest,
  CoordinatorResponse,
  ProcessingMode,
  PricesByStationId,
} from "../../src/lib/processing";
import type { Station } from "../../src/lib/stations";
import type { WorkerFetch } from "../coordinator/dispatchBatch";

export type BenchmarkSample = {
  mode: ProcessingMode;
  clientTimeMs: number;
  coordinatorTimeMs: number;
  returnedStations: number;
};

export type BenchmarkStatistics = {
  runs: number;
  averageMs: number;
  medianMs: number;
  minimumMs: number;
  maximumMs: number;
  p95Ms: number;
};

export type BenchmarkModeReport = {
  samples: BenchmarkSample[];
  client: BenchmarkStatistics;
  coordinator: BenchmarkStatistics;
};

export type BenchmarkReport = {
  stationCount: number;
  iterations: number;
  warmupIterations: number;
  single: BenchmarkModeReport;
  distributed: BenchmarkModeReport;
  clientSpeedup: number | null;
  coordinatorSpeedup: number | null;
};

export type RunBenchmarkOptions = {
  coordinatorUrl: string;
  stationCount?: number;
  iterations?: number;
  warmupIterations?: number;
  fetchImpl?: WorkerFetch;
  clock?: () => number;
};

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function positiveInteger(
  name: string,
  value: number,
  maximum: number
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ` +
        `1 and ${maximum}.`
    );
  }
}

export function calculateStatistics(
  values: readonly number[]
): BenchmarkStatistics {
  if (values.length === 0) {
    throw new Error(
      "At least one benchmark value is required."
    );
  }

  const sorted = [...values].sort(
    (left, right) => left - right
  );

  const total = sorted.reduce(
    (sum, value) => sum + value,
    0
  );

  const middle = Math.floor(sorted.length / 2);

  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) /
        2
      : sorted[middle];

  const p95Index = Math.max(
    0,
    Math.ceil(sorted.length * 0.95) - 1
  );

  return {
    runs: sorted.length,
    averageMs: rounded(total / sorted.length),
    medianMs: rounded(median),
    minimumMs: rounded(sorted[0]),
    maximumMs: rounded(
      sorted[sorted.length - 1]
    ),
    p95Ms: rounded(sorted[p95Index]),
  };
}

export function createBenchmarkRequest(
  stationCount: number
): CoordinatorRequest {
  positiveInteger(
    "stationCount",
    stationCount,
    500
  );

  const stations: Station[] = [];
  const pricesByStationId:
    Record<string, PricesByStationId[string]> = {};

  for (
    let index = 0;
    index < stationCount;
    index += 1
  ) {
    const id = `benchmark-${index + 1}`;

    stations.push({
      id,
      name: `Benchmark Station ${index + 1}`,
      brand: null,
      lat: 30 + (index % 100) / 10_000,
      lng:
        -90 -
        Math.floor(index / 100) / 10_000,
      address: null,
      fuels: ["regular"],
    });

    pricesByStationId[id] = [
      {
        fuelType: "regular",
        centsPerGallon: 300 + (index % 50),
        source: "benchmark",
        observedAt: null,
      },
    ];
  }

  return {
    userLocation: {
      lat: 30,
      lng: -90,
    },
    requiredFuel: "regular",
    stations,
    pricesByStationId,
    sortBy: "best",
  };
}

function coordinatorEndpoint(
  coordinatorUrl: string
): URL {
  let endpoint: URL;

  try {
    endpoint = new URL(
      "/process",
      coordinatorUrl
    );
  } catch {
    throw new Error(
      "coordinatorUrl must be a valid URL."
    );
  }

  if (
    endpoint.protocol !== "http:" &&
    endpoint.protocol !== "https:"
  ) {
    throw new Error(
      "coordinatorUrl must use HTTP or HTTPS."
    );
  }

  return endpoint;
}

function isCoordinatorResponse(
  value: unknown,
  mode: ProcessingMode
): value is CoordinatorResponse {
  if (
    !isRecord(value) ||
    typeof value.jobId !== "string" ||
    !value.jobId.trim() ||
    !Array.isArray(value.stations) ||
    !isRecord(value.metrics)
  ) {
    return false;
  }

  const metrics = value.metrics;

  return (
    metrics.mode === mode &&
    typeof metrics.totalStations === "number" &&
    typeof metrics.workerCount === "number" &&
    typeof metrics.completedBatches === "number" &&
    typeof metrics.retriedBatches === "number" &&
    typeof metrics.failedBatches === "number" &&
    typeof metrics.totalTimeMs === "number" &&
    Number.isFinite(metrics.totalTimeMs) &&
    metrics.totalTimeMs >= 0
  );
}

async function runSample(
  endpoint: URL,
  request: CoordinatorRequest,
  mode: ProcessingMode,
  fetchImpl: WorkerFetch,
  clock: () => number
): Promise<BenchmarkSample> {
  const startedAt = clock();

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...request,
      mode,
    }),
  });


  if (!response.ok) {
    throw new Error(
      `Coordinator returned HTTP ${response.status}.`
    );
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new Error(
      "Coordinator returned invalid JSON."
    );
  }

  if (!isCoordinatorResponse(body, mode)) {
    throw new Error(
      "Coordinator returned an invalid response."
    );
  }

  const clientTimeMs = rounded(
    Math.max(0, clock() - startedAt)
  );

  return {
    mode,
    clientTimeMs,
    coordinatorTimeMs:
      body.metrics.totalTimeMs,
    returnedStations: body.stations.length,
  };
}

function speedup(
  singleAverage: number,
  distributedAverage: number
): number | null {
  if (distributedAverage <= 0) {
    return null;
  }

  return rounded(
    singleAverage / distributedAverage
  );
}

function createModeReport(
  samples: BenchmarkSample[]
): BenchmarkModeReport {
  return {
    samples,
    client: calculateStatistics(
      samples.map(
        (sample) => sample.clientTimeMs
      )
    ),
    coordinator: calculateStatistics(
      samples.map(
        (sample) => sample.coordinatorTimeMs
      )
    ),
  };
}

export async function runBenchmark(
  options: RunBenchmarkOptions
): Promise<BenchmarkReport> {
  const stationCount =
    options.stationCount ?? 500;

  const iterations =
    options.iterations ?? 10;

  const warmupIterations =
    options.warmupIterations ?? 1;

  positiveInteger(
    "stationCount",
    stationCount,
    500
  );

  positiveInteger(
    "iterations",
    iterations,
    100
  );

  if (
    !Number.isSafeInteger(warmupIterations) ||
    warmupIterations < 0 ||
    warmupIterations > 20
  ) {
    throw new Error(
      "warmupIterations must be an integer " +
        "between 0 and 20."
    );
  }

  const endpoint = coordinatorEndpoint(
    options.coordinatorUrl
  );

  const request =
    createBenchmarkRequest(stationCount);

  const fetchImpl = options.fetchImpl ?? fetch;
  const clock =
    options.clock ?? (() => performance.now());

  for (
    let index = 0;
    index < warmupIterations;
    index += 1
  ) {
    await runSample(
      endpoint,
      request,
      "single",
      fetchImpl,
      clock
    );

    await runSample(
      endpoint,
      request,
      "distributed",
      fetchImpl,
      clock
    );
  }

  const singleSamples: BenchmarkSample[] = [];
  const distributedSamples: BenchmarkSample[] = [];

  for (
    let index = 0;
    index < iterations;
    index += 1
  ) {
    const modes: ProcessingMode[] =
      index % 2 === 0
        ? ["single", "distributed"]
        : ["distributed", "single"];

    for (const mode of modes) {
      const sample = await runSample(
        endpoint,
        request,
        mode,
        fetchImpl,
        clock
      );

      if (mode === "single") {
        singleSamples.push(sample);
      } else {
        distributedSamples.push(sample);
      }
    }
  }

  const single = createModeReport(
    singleSamples
  );

  const distributed = createModeReport(
    distributedSamples
  );

  return {
    stationCount,
    iterations,
    warmupIterations,
    single,
    distributed,
    clientSpeedup: speedup(
      single.client.averageMs,
      distributed.client.averageMs
    ),
    coordinatorSpeedup: speedup(
      single.coordinator.averageMs,
      distributed.coordinator.averageMs
    ),
  };
}