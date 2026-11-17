import type {
  WorkerBatchRequest,
  WorkerBatchResponse,
} from "../../src/lib/processing";

export const DEFAULT_WORKER_TIMEOUT_MS = 5_000;

export type WorkerFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type DispatchBatchOptions = {
  timeoutMs?: number;
  fetchImpl?: WorkerFetch;
};

export class WorkerDispatchError extends Error {
  readonly name = "WorkerDispatchError";

  constructor(
    message: string,
    readonly workerUrl: string,
    readonly retryable: boolean,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

function processEndpoint(workerUrl: string): URL {
  let endpoint: URL;

  try {
    endpoint = new URL("/process", workerUrl);
  } catch {
    throw new WorkerDispatchError(
      "Worker URL is invalid.",
      workerUrl,
      false
    );
  }

  if (
    endpoint.protocol !== "http:" &&
    endpoint.protocol !== "https:"
  ) {
    throw new WorkerDispatchError(
      "Worker URL must use HTTP or HTTPS.",
      workerUrl,
      false
    );
  }

  return endpoint;
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

function isMatchingResponse(
  value: unknown,
  request: WorkerBatchRequest
): value is WorkerBatchResponse {
  if (
    !isRecord(value) ||
    value.jobId !== request.jobId ||
    value.batchId !== request.batchId ||
    typeof value.workerId !== "string" ||
    !value.workerId.trim() ||
    !Array.isArray(value.stations) ||
    typeof value.processingTimeMs !== "number" ||
    !Number.isFinite(value.processingTimeMs) ||
    value.processingTimeMs < 0
  ) {
    return false;
  }

  if (
    value.stations.length !== request.stations.length
  ) {
    return false;
  }

  const expectedIds = new Set(
    request.stations.map((station) => station.id)
  );
  const returnedIds = new Set<string>();

  if (expectedIds.size !== request.stations.length) {
    return false;
  }

  for (const station of value.stations) {
    if (
      !isRecord(station) ||
      typeof station.id !== "string" ||
      !expectedIds.has(station.id) ||
      returnedIds.has(station.id)
    ) {
      return false;
    }

    returnedIds.add(station.id);
  }

  return returnedIds.size === expectedIds.size;
}

function retryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

export async function dispatchBatch(
  workerUrl: string,
  request: WorkerBatchRequest,
  options: DispatchBatchOptions = {}
): Promise<WorkerBatchResponse> {
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error(
      "timeoutMs must be a positive integer."
    );
  }

  const endpoint = processEndpoint(workerUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new WorkerDispatchError(
        `Worker returned HTTP ${response.status}.`,
        workerUrl,
        retryableStatus(response.status),
        response.status
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch (error) {
      throw new WorkerDispatchError(
        "Worker returned invalid JSON.",
        workerUrl,
        true,
        response.status,
        { cause: error }
      );
    }

    if (!isMatchingResponse(body, request)) {
      throw new WorkerDispatchError(
        "Worker returned an invalid batch response.",
        workerUrl,
        true,
        response.status
      );
    }

    return body;
  } catch (error) {
    if (error instanceof WorkerDispatchError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new WorkerDispatchError(
        `Worker request timed out after ${timeoutMs} ms.`,
        workerUrl,
        true,
        undefined,
        { cause: error }
      );
    }

    throw new WorkerDispatchError(
      "Worker request failed.",
      workerUrl,
      true,
      undefined,
      { cause: error }
    );
  } finally {
    clearTimeout(timeout);
  }
}