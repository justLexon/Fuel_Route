import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  CoordinatorRequest,
  ServiceErrorResponse,
} from "../../src/lib/processing";
import {
  NoAvailableWorkersError,
  processCoordinatorRequest,
  type CoordinatorDiagnostics,
  type CoordinatorExecution,
  type ProcessCoordinatorOptions,
} from "./processRequest";
import {
  validateCoordinatorRequest,
} from "./validateRequest";

export const MAX_COORDINATOR_BODY_BYTES =
  5_000_000;

type CoordinatorProcessor = (
  request: CoordinatorRequest,
  workerUrls: readonly string[],
  options?: ProcessCoordinatorOptions
) => Promise<CoordinatorExecution>;

export type CoordinatorLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
};

export type CoordinatorServerOptions = {
  workerUrls: readonly string[];
  healthTimeoutMs?: number;
  workerTimeoutMs?: number;
  processImpl?: CoordinatorProcessor;
  logger?: CoordinatorLogger;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });

  response.end(JSON.stringify(body));
}

function readJsonBody(
  request: IncomingMessage
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let tooLarge = false;

    request.on("data", (chunk: Buffer) => {
      byteCount += chunk.length;

      if (
        byteCount >
        MAX_COORDINATOR_BODY_BYTES
      ) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) {
        chunks.push(chunk);
      }
    });

    request.on("end", () => {
      if (tooLarge) {
        reject(
          new HttpError(
            413,
            "Request body is too large."
          )
        );
        return;
      }

      const text = Buffer.concat(chunks).toString(
        "utf8"
      );

      if (!text.trim()) {
        reject(
          new HttpError(
            400,
            "Request body is required."
          )
        );
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch {
        reject(
          new HttpError(
            400,
            "Request body must be valid JSON."
          )
        );
      }
    });

    request.on("error", reject);
  });
}

function logDiagnostics(
  jobId: string,
  diagnostics: CoordinatorDiagnostics,
  logger: CoordinatorLogger
) {
  for (
    const worker of diagnostics.unavailableWorkers
  ) {
    logger.warn(
      `[${jobId}] Worker unavailable: ` +
        `${worker.url} - ${worker.error}`
    );
  }

  for (const timing of diagnostics.batchTimings) {
    logger.info(
      `[${jobId}] ${timing.batchId} completed by ` +
        `${timing.workerId} in ` +
        `${timing.workerProcessingTimeMs} ms ` +
        `(coordinator ${timing.totalTimeMs} ms, ` +
        `${timing.attemptCount} attempt(s)).`
    );
  }

  for (
    const failedBatch of diagnostics.failedBatches
  ) {
    logger.warn(
      `[${jobId}] ${failedBatch.batchId} failed ` +
        `after ${failedBatch.attemptCount} attempt(s).`
    );

    for (const failure of failedBatch.failures) {
      logger.warn(
        `[${jobId}] ${failure.batchId} failed on ` +
          `${failure.workerUrl}: ${failure.message}`
      );
    }
  }

  if (diagnostics.invalidResultCount > 0) {
    logger.warn(
      `[${jobId}] Rejected ` +
        `${diagnostics.invalidResultCount} invalid result(s).`
    );
  }

  if (
    diagnostics.duplicateStationIds.length > 0
  ) {
    logger.warn(
      `[${jobId}] Removed ` +
        `${diagnostics.duplicateStationIds.length} ` +
        `duplicate station result(s).`
    );
  }

  if (diagnostics.missingStationIds.length > 0) {
    logger.warn(
      `[${jobId}] Missing ` +
        `${diagnostics.missingStationIds.length} ` +
        `station result(s).`
    );
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<CoordinatorServerOptions>
) {
  const pathname = new URL(
    request.url ?? "/",
    "http://localhost"
  ).pathname;

  if (pathname === "/health") {
    if (request.method !== "GET") {
      sendJson(
        response,
        405,
        { error: "Method not allowed." },
        { Allow: "GET" }
      );
      return;
    }

    sendJson(response, 200, {
      status: "ok",
      service: "coordinator",
      configuredWorkers:
        options.workerUrls.length,
    });
    return;
  }

  if (pathname !== "/process") {
    sendJson(response, 404, {
      error: "Not found.",
    });
    return;
  }

  if (request.method !== "POST") {
    sendJson(
      response,
      405,
      { error: "Method not allowed." },
      { Allow: "POST" }
    );
    return;
  }

  const contentType =
    request.headers["content-type"] ?? "";

  if (
    !contentType
      .toLowerCase()
      .startsWith("application/json")
  ) {
    sendJson(response, 415, {
      error:
        "Content-Type must be application/json.",
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const validation =
      validateCoordinatorRequest(body);

    if (!validation.success) {
      sendJson(response, 400, {
        error: validation.error,
      });
      return;
    }

    const execution = await options.processImpl(
      validation.data,
      options.workerUrls,
      {
        healthTimeoutMs:
          options.healthTimeoutMs,
        workerTimeoutMs:
          options.workerTimeoutMs,
      }
    );

    logDiagnostics(
      execution.response.jobId,
      execution.diagnostics,
      options.logger
    );

    sendJson(
      response,
      200,
      execution.response
    );
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, {
        error: error.message,
      });
      return;
    }

    if (error instanceof NoAvailableWorkersError) {
      options.logger.warn(
        `[${error.jobId}] No processing workers are available.`
      );

      const body: ServiceErrorResponse = {
        error: error.message,
        jobId: error.jobId,
      };

      sendJson(response, 503, body);
      return;
    }

    options.logger.error(
      "Coordinator request failed.",
      error
    );

    const body: ServiceErrorResponse = {
      error: "Coordinator processing failed.",
    };

    sendJson(response, 500, body);
  }
}

export function createCoordinatorServer(
  options: CoordinatorServerOptions
) {
  const completeOptions:
    Required<CoordinatorServerOptions> = {
    workerUrls: [...options.workerUrls],
    healthTimeoutMs:
      options.healthTimeoutMs ?? 2_000,
    workerTimeoutMs:
      options.workerTimeoutMs ?? 5_000,
    processImpl:
      options.processImpl ??
      processCoordinatorRequest,
    logger: options.logger ?? console,
  };

  return createServer((request, response) => {
    void handleRequest(
      request,
      response,
      completeOptions
    );
  });
}