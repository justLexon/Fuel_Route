import type {
  CoordinatorRequest,
  CoordinatorResponse,
} from "./processing";

export const DEFAULT_COORDINATOR_TIMEOUT_MS = 20_000;

export type CoordinatorFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type CoordinatorClientOptions = {
  coordinatorUrl: string;
  timeoutMs?: number;
  fetchImpl?: CoordinatorFetch;
};

export class CoordinatorClientError extends Error {
  readonly name = "CoordinatorClientError";

  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
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

function isNonNegativeNumber(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isCoordinatorResponse(
  value: unknown
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
    (metrics.mode === "single" ||
      metrics.mode === "distributed") &&
    isNonNegativeNumber(metrics.totalStations) &&
    isNonNegativeNumber(metrics.workerCount) &&
    isNonNegativeNumber(metrics.completedBatches) &&
    isNonNegativeNumber(metrics.retriedBatches) &&
    isNonNegativeNumber(metrics.failedBatches) &&
    isNonNegativeNumber(metrics.totalTimeMs)
  );
}

function createCoordinatorEndpoint(
  coordinatorUrl: string
): URL {
  const trimmed = coordinatorUrl.trim();

  if (!trimmed) {
    throw new CoordinatorClientError(
      "COORDINATOR_URL is not configured.",
      503
    );
  }

  let endpoint: URL;

  try {
    endpoint = new URL(trimmed);
  } catch {
    throw new CoordinatorClientError(
      "COORDINATOR_URL is invalid.",
      503
    );
  }

  if (
    endpoint.protocol !== "http:" &&
    endpoint.protocol !== "https:"
  ) {
    throw new CoordinatorClientError(
      "COORDINATOR_URL must use HTTP or HTTPS.",
      503
    );
  }

  if (endpoint.username || endpoint.password) {
    throw new CoordinatorClientError(
      "COORDINATOR_URL cannot contain credentials.",
      503
    );
  }

  if (
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new CoordinatorClientError(
      "COORDINATOR_URL must be a base URL.",
      503
    );
  }

  endpoint.pathname = "/process";

  return endpoint;
}

function errorMessage(
  body: unknown,
  fallback: string
): string {
  if (
    isRecord(body) &&
    typeof body.error === "string" &&
    body.error.trim()
  ) {
    return body.error;
  }

  return fallback;
}

export async function sendCoordinatorRequest(
  request: CoordinatorRequest,
  options: CoordinatorClientOptions
): Promise<CoordinatorResponse> {
  const endpoint = createCoordinatorEndpoint(
    options.coordinatorUrl
  );

  const timeoutMs =
    options.timeoutMs ??
    DEFAULT_COORDINATOR_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new CoordinatorClientError(
      "Coordinator timeout must be a positive integer.",
      500
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;

  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        error.name === "AbortError");

    throw new CoordinatorClientError(
      timedOut
        ? "Coordinator request timed out."
        : "Coordinator is unavailable.",
      timedOut ? 504 : 502
    );
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new CoordinatorClientError(
      response.ok
        ? "Coordinator returned invalid JSON."
        : `Coordinator returned HTTP ${response.status}.`,
      response.ok ? 502 : response.status
    );
  }

  if (!response.ok) {
    throw new CoordinatorClientError(
      errorMessage(
        body,
        `Coordinator returned HTTP ${response.status}.`
      ),
      response.status
    );
  }

  if (!isCoordinatorResponse(body)) {
    throw new CoordinatorClientError(
      "Coordinator returned an invalid response.",
      502
    );
  }

  return body;
}