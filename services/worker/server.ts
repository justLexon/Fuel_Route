import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { ServiceErrorResponse } from "../../src/lib/processing";
import { processWorkerBatch } from "./processBatch";
import { validateWorkerBatchRequest } from "./validateRequest";

export const MAX_REQUEST_BODY_BYTES = 1_000_000;

type WorkerServerOptions = {
  workerId?: string;
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

      if (byteCount > MAX_REQUEST_BODY_BYTES) {
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

      const text = Buffer.concat(chunks).toString("utf8");

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

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workerId: string
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
      workerId,
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
      error: "Content-Type must be application/json.",
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const validation =
      validateWorkerBatchRequest(body);

    if (!validation.success) {
      sendJson(response, 400, {
        error: validation.error,
      });
      return;
    }

    sendJson(
      response,
      200,
      processWorkerBatch(
        validation.data,
        workerId
      )
    );
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, {
        error: error.message,
      });
      return;
    }

    console.error("Worker request failed:", error);

    const body: ServiceErrorResponse = {
      error: "Worker processing failed.",
    };

    sendJson(response, 500, body);
  }
}

export function createWorkerServer(
  options: WorkerServerOptions = {}
) {
  const workerId =
    options.workerId?.trim() ||
    process.env.WORKER_ID?.trim() ||
    "worker-local";

  return createServer((request, response) => {
    void handleRequest(
      request,
      response,
      workerId
    );
  });
}