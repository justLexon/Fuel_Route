import type { WorkerFetch } from "./dispatchBatch";

export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

type Clock = () => number;

export type AvailableWorker = {
  url: string;
  workerId: string;
  healthCheckTimeMs: number;
};

export type UnavailableWorker = {
  url: string;
  error: string;
  healthCheckTimeMs: number;
};

export type WorkerDiscoveryResult = {
  available: AvailableWorker[];
  unavailable: UnavailableWorker[];
};

export type WorkerDiscoveryOptions = {
  timeoutMs?: number;
  fetchImpl?: WorkerFetch;
  clock?: Clock;
};

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function normalizeWorkerUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Worker URL cannot be empty.");
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid worker URL: ${trimmed}`);
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      `Worker URL must use HTTP or HTTPS: ${trimmed}`
    );
  }

  if (url.username || url.password) {
    throw new Error(
      `Worker URL cannot contain credentials: ${trimmed}`
    );
  }

  if (
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Worker URL must be a base URL: ${trimmed}`
    );
  }

  return url.origin;
}

export function parseWorkerUrls(
  value: string | undefined
): string[] {
  if (!value?.trim()) {
    throw new Error(
      "WORKER_URLS must contain at least one worker URL."
    );
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((workerUrl) =>
          normalizeWorkerUrl(workerUrl)
        )
    ),
  ];
}

function elapsedMilliseconds(
  startedAt: number,
  finishedAt: number
): number {
  const elapsed = finishedAt - startedAt;

  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return 0;
  }

  return Number(elapsed.toFixed(3));
}

async function checkWorker(
  workerUrl: string,
  options: Required<WorkerDiscoveryOptions>
): Promise<
  | { available: true; worker: AvailableWorker }
  | { available: false; worker: UnavailableWorker }
> {
  const controller = new AbortController();
  const startedAt = options.clock();

  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await options.fetchImpl(
      new URL("/health", workerUrl),
      {
        method: "GET",
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Health check returned HTTP ${response.status}.`
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new Error(
        "Health check returned invalid JSON."
      );
    }

    if (
        !isRecord(body) ||
        body.status !== "ok" ||
        typeof body.workerId !== "string" ||
        !body.workerId.trim()
    ) {
      throw new Error(
        "Health check returned an invalid response."
      );
    }

    return {
      available: true,
      worker: {
        url: workerUrl,
        workerId: body.workerId,
        healthCheckTimeMs: elapsedMilliseconds(
          startedAt,
          options.clock()
        ),
      },
    };
  } catch (error) {
    const message = controller.signal.aborted
      ? `Health check timed out after ${options.timeoutMs} ms.`
      : error instanceof Error
        ? error.message
        : "Health check failed.";

    return {
      available: false,
      worker: {
        url: workerUrl,
        error: message,
        healthCheckTimeMs: elapsedMilliseconds(
          startedAt,
          options.clock()
        ),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverWorkers(
  workerUrls: readonly string[],
  options: WorkerDiscoveryOptions = {}
): Promise<WorkerDiscoveryResult> {
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error(
      "timeoutMs must be a positive integer."
    );
  }

  const normalizedUrls = [
    ...new Set(
      workerUrls.map((workerUrl) =>
        normalizeWorkerUrl(workerUrl)
      )
    ),
  ];

  const completeOptions: Required<WorkerDiscoveryOptions> =
    {
      timeoutMs,
      fetchImpl: options.fetchImpl ?? fetch,
      clock: options.clock ?? (() => performance.now()),
    };

  const results = await Promise.all(
    normalizedUrls.map((workerUrl) =>
      checkWorker(workerUrl, completeOptions)
    )
  );

  const available: AvailableWorker[] = [];
  const unavailable: UnavailableWorker[] = [];

  for (const result of results) {
    if (result.available) {
      available.push(result.worker);
    } else {
      unavailable.push(result.worker);
    }
  }

  return {
    available,
    unavailable,
  };
}