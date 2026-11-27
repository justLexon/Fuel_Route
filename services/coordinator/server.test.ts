import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type {
  CoordinatorRequest,
} from "../../src/lib/processing";
import {
  NoAvailableWorkersError,
  type CoordinatorExecution,
  type ProcessCoordinatorOptions,
} from "./processRequest";
import {
  createCoordinatorServer,
  MAX_COORDINATOR_BODY_BYTES,
  type CoordinatorLogger,
  type CoordinatorServerOptions,
} from "./server";

async function listen(
  server: Server
): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) =>
      error ? reject(error) : resolve()
    );
  });
}

async function withServer(
  options: CoordinatorServerOptions,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createCoordinatorServer(options);
  const baseUrl = await listen(server);

  try {
    await run(baseUrl);
  } finally {
    await close(server);
  }
}

function validRequestBody(): CoordinatorRequest {
  return {
    userLocation: {
      lat: 30,
      lng: -90,
    },
    requiredFuel: "regular",
    stations: [
      {
        id: "node/1",
        name: "Station",
        brand: null,
        lat: 30.1,
        lng: -90.1,
        address: null,
        fuels: ["regular"],
      },
    ],
    sortBy: "best",
    mode: "distributed",
  };
}

function emptyExecution(
  jobId = "job-test"
): CoordinatorExecution {
  return {
    response: {
      jobId,
      stations: [],
      metrics: {
        mode: "distributed",
        totalStations: 1,
        workerCount: 2,
        completedBatches: 1,
        retriedBatches: 0,
        failedBatches: 0,
        totalTimeMs: 5,
      },
    },
    diagnostics: {
      unavailableWorkers: [],
      failedBatches: [],
      batchTimings: [],
      invalidResultCount: 0,
      incompatibleResultCount: 0,
      duplicateStationIds: [],
      missingStationIds: [],
    },
  };
}

function createRecordingLogger() {
  const infos: string[] = [];
  const warnings: string[] = [];
  const errors: Array<{
    message: string;
    error?: unknown;
  }> = [];

  const logger: CoordinatorLogger = {
    info(message) {
      infos.push(message);
    },
    warn(message) {
      warnings.push(message);
    },
    error(message, error) {
      errors.push({
        message,
        error,
      });
    },
  };

  return {
    logger,
    infos,
    warnings,
    errors,
  };
}

function testOptions(
  overrides: Partial<CoordinatorServerOptions> = {}
): CoordinatorServerOptions {
  return {
    workerUrls: [
      "http://worker-1:4001",
      "http://worker-2:4002",
    ],
    processImpl: async () => emptyExecution(),
    logger: createRecordingLogger().logger,
    ...overrides,
  };
}

describe("coordinator server", () => {
  it("reports coordinator health", async () => {
    await withServer(
      testOptions(),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/health`
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          status: "ok",
          service: "coordinator",
          configuredWorkers: 2,
        });
      }
    );
  });

  it("validates and processes a request", async () => {
    let capturedRequest:
      | CoordinatorRequest
      | undefined;

    let capturedWorkerUrls:
      | readonly string[]
      | undefined;

    let capturedOptions:
      | ProcessCoordinatorOptions
      | undefined;

    const execution = emptyExecution(
      "job-success"
    );

    await withServer(
      testOptions({
        healthTimeoutMs: 100,
        workerTimeoutMs: 200,
        processImpl: async (
          request,
          workerUrls,
          options
        ) => {
          capturedRequest = request;
          capturedWorkerUrls = workerUrls;
          capturedOptions = options;

          return execution;
        },
      }),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json; charset=utf-8",
            },
            body: JSON.stringify(
              validRequestBody()
            ),
          }
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(
          execution.response
        );
      }
    );

    expect(capturedRequest).toEqual(
      validRequestBody()
    );

    expect(capturedWorkerUrls).toEqual([
      "http://worker-1:4001",
      "http://worker-2:4002",
    ]);

    expect(capturedOptions).toEqual({
      healthTimeoutMs: 100,
      workerTimeoutMs: 200,
    });
  });

  it("rejects empty or malformed JSON", async () => {
    await withServer(
      testOptions(),
      async (baseUrl) => {
        const emptyResponse = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: "",
          }
        );

        expect(emptyResponse.status).toBe(400);
        expect(await emptyResponse.json()).toEqual({
          error: "Request body is required.",
        });

        const malformedResponse = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: "{invalid",
          }
        );

        expect(malformedResponse.status).toBe(400);
        expect(
          await malformedResponse.json()
        ).toEqual({
          error:
            "Request body must be valid JSON.",
        });
      }
    );
  });

  it("returns coordinator validation errors", async () => {
    await withServer(
      testOptions(),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...validRequestBody(),
              requiredFuel: "rocket-fuel",
            }),
          }
        );

        expect(response.status).toBe(400);

        const body = await response.json() as {
          error: string;
        };

        expect(body.error).toContain(
          "requiredFuel"
        );
      }
    );
  });

  it("requires a JSON content type", async () => {
    await withServer(
      testOptions(),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            body: JSON.stringify(
              validRequestBody()
            ),
          }
        );

        expect(response.status).toBe(415);
        expect(await response.json()).toEqual({
          error:
            "Content-Type must be application/json.",
        });
      }
    );
  });

  it("distinguishes unsupported methods and paths", async () => {
    await withServer(
      testOptions(),
      async (baseUrl) => {
        const healthMethodResponse =
          await fetch(`${baseUrl}/health`, {
            method: "POST",
          });

        expect(
          healthMethodResponse.status
        ).toBe(405);

        expect(
          healthMethodResponse.headers.get(
            "allow"
          )
        ).toBe("GET");

        const processMethodResponse =
          await fetch(`${baseUrl}/process`);

        expect(
          processMethodResponse.status
        ).toBe(405);

        expect(
          processMethodResponse.headers.get(
            "allow"
          )
        ).toBe("POST");

        const missingResponse = await fetch(
          `${baseUrl}/missing`
        );

        expect(missingResponse.status).toBe(404);
      }
    );
  });

  it("rejects oversized request bodies", async () => {
    await withServer(
      testOptions(),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              padding: "x".repeat(
                MAX_COORDINATOR_BODY_BYTES
              ),
            }),
          }
        );

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
          error: "Request body is too large.",
        });
      }
    );
  });

  it("returns 503 when no workers are available", async () => {
    const recording =
      createRecordingLogger();

    await withServer(
      testOptions({
        logger: recording.logger,
        processImpl: async () => {
          throw new NoAvailableWorkersError(
            "job-unavailable",
            [
              {
                url: "http://worker-1:4001",
                error: "Connection refused.",
                healthCheckTimeMs: 5,
              },
            ]
          );
        },
      }),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              validRequestBody()
            ),
          }
        );

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error:
            "No processing workers are available.",
          jobId: "job-unavailable",
        });
      }
    );

    expect(recording.warnings).toHaveLength(1);
  });

  it("hides unexpected internal errors", async () => {
    const recording =
      createRecordingLogger();

    await withServer(
      testOptions({
        logger: recording.logger,
        processImpl: async () => {
          throw new Error(
            "Sensitive internal details."
          );
        },
      }),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              validRequestBody()
            ),
          }
        );

        expect(response.status).toBe(500);

        const body = await response.json() as {
          error: string;
        };

        expect(body).toEqual({
          error:
            "Coordinator processing failed.",
        });

        expect(body.error).not.toContain(
          "Sensitive"
        );
      }
    );

    expect(recording.errors).toHaveLength(1);
    expect(recording.errors[0].message).toBe(
      "Coordinator request failed."
    );
  });

  it("logs processing diagnostics", async () => {
    const recording =
      createRecordingLogger();

    const execution = emptyExecution(
      "job-diagnostics"
    );

    execution.diagnostics = {
      unavailableWorkers: [
        {
          url: "http://worker-3:4003",
          error: "Health check failed.",
          healthCheckTimeMs: 5,
        },
      ],
      failedBatches: [
        {
          batchId: "job-diagnostics-batch-2",
          attemptCount: 1,
          totalTimeMs: 10,
          failures: [
            {
              batchId:
                "job-diagnostics-batch-2",
              workerUrl:
                "http://worker-2:4002",
              message: "Worker timed out.",
              retryable: true,
              attemptTimeMs: 10,
            },
          ],
        },
      ],
      batchTimings: [
        {
          batchId:
            "job-diagnostics-batch-1",
          workerId: "worker-1",
          workerUrl:
            "http://worker-1:4001",
          workerProcessingTimeMs: 2,
          totalTimeMs: 3,
          attemptCount: 1,
        },
      ],
      invalidResultCount: 1,
      incompatibleResultCount: 1,
      duplicateStationIds: ["station-1"],
      missingStationIds: ["station-2"],
    };

    await withServer(
      testOptions({
        logger: recording.logger,
        processImpl: async () => execution,
      }),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/process`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              validRequestBody()
            ),
          }
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(
          execution.response
        );
      }
    );

    expect(recording.infos).toHaveLength(1);
    expect(recording.warnings).toHaveLength(6);

    expect(recording.infos[0]).toContain(
      "completed by worker-1"
    );

    expect(
      recording.warnings.join("\n")
    ).toContain("Worker unavailable");

    expect(
      recording.warnings.join("\n")
    ).toContain("invalid result");

    expect(
      recording.warnings.join("\n")
    ).toContain("duplicate station");

    expect(
      recording.warnings.join("\n")
    ).toContain("Missing");
  });
});