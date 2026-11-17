import { describe, expect, it } from "vitest";
import type {
  WorkerBatchRequest,
  WorkerBatchResponse,
} from "../../src/lib/processing";
import {
  dispatchBatch,
  type WorkerFetch,
} from "./dispatchBatch";

function makeRequest(
  stationCount = 1
): WorkerBatchRequest {
  return {
    jobId: "job-1",
    batchId: "job-1-batch-1",
    userLocation: {
      lat: 30,
      lng: -90,
    },
    requiredFuel: "regular",
    stations: Array.from(
      { length: stationCount },
      (_, index) => ({
        id: `station-${index + 1}`,
        name: `Station ${index + 1}`,
        brand: null,
        lat: 30 + index / 100,
        lng: -90 - index / 100,
        address: null,
        fuels: ["regular"],
      })
    ),
  };
}

function makeWorkerResponse(
  request: WorkerBatchRequest
): WorkerBatchResponse {
  return {
    jobId: request.jobId,
    batchId: request.batchId,
    workerId: "worker-1",
    stations: request.stations.map((station) => ({
      ...station,
      distanceMiles: 1,
      fuelCompatibility: "compatible",
      price: null,
    })),
    processingTimeMs: 2.5,
  };
}

function jsonResponse(
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("dispatchBatch", () => {
  it("posts the batch and returns its matching response", async () => {
    const request = makeRequest();
    const workerResponse = makeWorkerResponse(request);

    let capturedInput: string | URL | undefined;
    let capturedInit: RequestInit | undefined;

    const fetchImpl: WorkerFetch = async (
      input,
      init
    ) => {
      capturedInput = input;
      capturedInit = init;
      return jsonResponse(workerResponse);
    };

    const result = await dispatchBatch(
      "http://worker.example:4001",
      request,
      { fetchImpl }
    );

    expect(result).toEqual(workerResponse);
    expect(String(capturedInput)).toBe(
      "http://worker.example:4001/process"
    );
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(
      JSON.parse(String(capturedInit?.body))
    ).toEqual(request);
  });

  it("rejects invalid or unsupported worker URLs", async () => {
    for (const workerUrl of [
      "not-a-url",
      "ftp://worker.example",
    ]) {
      await expect(
        dispatchBatch(workerUrl, makeRequest())
      ).rejects.toMatchObject({
        name: "WorkerDispatchError",
        workerUrl,
        retryable: false,
      });
    }
  });

  it.each([
    { status: 400, retryable: false },
    { status: 408, retryable: true },
    { status: 429, retryable: true },
    { status: 503, retryable: true },
  ])(
    "classifies HTTP $status correctly",
    async ({ status, retryable }) => {
      const fetchImpl: WorkerFetch = async () =>
        jsonResponse(
          { error: "Worker error." },
          status
        );

      await expect(
        dispatchBatch(
          "http://worker.example:4001",
          makeRequest(),
          { fetchImpl }
        )
      ).rejects.toMatchObject({
        name: "WorkerDispatchError",
        status,
        retryable,
      });
    }
  );

  it("rejects invalid JSON returned by a worker", async () => {
    const fetchImpl: WorkerFetch = async () =>
      new Response("{invalid", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });

    await expect(
      dispatchBatch(
        "http://worker.example:4001",
        makeRequest(),
        { fetchImpl }
      )
    ).rejects.toMatchObject({
      name: "WorkerDispatchError",
      retryable: true,
    });
  });

  it("rejects mismatched job or batch identifiers", async () => {
    const request = makeRequest();
    const response = makeWorkerResponse(request);
    response.batchId = "wrong-batch";

    const fetchImpl: WorkerFetch = async () =>
      jsonResponse(response);

    await expect(
      dispatchBatch(
        "http://worker.example:4001",
        request,
        { fetchImpl }
      )
    ).rejects.toThrow(
      "Worker returned an invalid batch response."
    );
  });

  it("rejects missing or duplicate station results", async () => {
    const request = makeRequest(2);
    const response = makeWorkerResponse(request);

    response.stations = [
      response.stations[0],
      response.stations[0],
    ];

    const fetchImpl: WorkerFetch = async () =>
      jsonResponse(response);

    await expect(
      dispatchBatch(
        "http://worker.example:4001",
        request,
        { fetchImpl }
      )
    ).rejects.toThrow(
      "Worker returned an invalid batch response."
    );
  });

  it("times out an unresponsive worker", async () => {
    const fetchImpl: WorkerFetch = (
      _input,
      init
    ) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        );
      });

    await expect(
      dispatchBatch(
        "http://worker.example:4001",
        makeRequest(),
        {
          fetchImpl,
          timeoutMs: 5,
        }
      )
    ).rejects.toMatchObject({
      name: "WorkerDispatchError",
      retryable: true,
      message:
        "Worker request timed out after 5 ms.",
    });
  });

  it("marks network failures as retryable", async () => {
    const fetchImpl: WorkerFetch = async () => {
      throw new TypeError("connection refused");
    };

    await expect(
      dispatchBatch(
        "http://worker.example:4001",
        makeRequest(),
        { fetchImpl }
      )
    ).rejects.toMatchObject({
      name: "WorkerDispatchError",
      retryable: true,
      message: "Worker request failed.",
    });
  });

  it("rejects invalid timeout configuration", async () => {
    for (const timeoutMs of [
      0,
      -1,
      1.5,
      Number.NaN,
    ]) {
      await expect(
        dispatchBatch(
          "http://worker.example:4001",
          makeRequest(),
          { timeoutMs }
        )
      ).rejects.toThrow(
        "timeoutMs must be a positive integer."
      );
    }
  });
});