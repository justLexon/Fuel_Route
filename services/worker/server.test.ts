import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "vitest";
import type { WorkerBatchResponse } from "../../src/lib/processing";
import {
  createWorkerServer,
  MAX_REQUEST_BODY_BYTES,
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
  run: (baseUrl: string) => Promise<void>
) {
  const server = createWorkerServer({
    workerId: "worker-test",
  });

  const baseUrl = await listen(server);

  try {
    await run(baseUrl);
  } finally {
    await close(server);
  }
}

function validRequestBody() {
  return {
    jobId: "job-1",
    batchId: "batch-1",
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
        fuels: ["octane_87"],
      },
    ],
  };
}

test("health endpoint identifies the worker", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/health`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      workerId: "worker-test",
    });
  });
});

test("process endpoint returns processed stations", async () => {
  await withServer(async (baseUrl) => {
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

    assert.equal(response.status, 200);

    const body =
      await response.json() as WorkerBatchResponse;

    assert.equal(body.jobId, "job-1");
    assert.equal(body.batchId, "batch-1");
    assert.equal(body.workerId, "worker-test");
    assert.equal(body.stations.length, 1);
    assert.equal(
      body.stations[0].fuelCompatibility,
      "compatible"
    );
    assert.ok(
      body.stations[0].distanceMiles !== null
    );
    assert.ok(body.processingTimeMs >= 0);
  });
});

test("process endpoint rejects malformed JSON", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/process`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{not-json",
      }
    );

    assert.equal(response.status, 400);
    assert.match(
      JSON.stringify(await response.json()),
      /valid JSON/
    );
  });
});

test("process endpoint reports validation errors", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/process`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validRequestBody(),
          jobId: "",
        }),
      }
    );

    assert.equal(response.status, 400);
    assert.match(
      JSON.stringify(await response.json()),
      /jobId/
    );
  });
});

test("process endpoint requires JSON content type", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/process`,
      {
        method: "POST",
        body: JSON.stringify(
          validRequestBody()
        ),
      }
    );

    assert.equal(response.status, 415);
  });
});

test("server distinguishes unsupported methods and paths", async () => {
  await withServer(async (baseUrl) => {
    const methodResponse = await fetch(
      `${baseUrl}/process`
    );

    assert.equal(methodResponse.status, 405);
    assert.equal(
      methodResponse.headers.get("allow"),
      "POST"
    );

    const pathResponse = await fetch(
      `${baseUrl}/missing`
    );

    assert.equal(pathResponse.status, 404);
  });
});

test("process endpoint rejects oversized request bodies", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/process`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: "x".repeat(
            MAX_REQUEST_BODY_BYTES
          ),
        }),
      }
    );

    assert.equal(response.status, 413);
  });
});