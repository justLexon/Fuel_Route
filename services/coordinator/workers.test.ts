import { describe, expect, it } from "vitest";
import type { WorkerFetch } from "./dispatchBatch";
import {
  discoverWorkers,
  parseWorkerUrls,
} from "./workers";

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

describe("parseWorkerUrls", () => {
  it("normalizes and removes duplicate URLs", () => {
    expect(
      parseWorkerUrls(
        [
          " http://worker-a:4001/ ",
          "https://worker-b.example",
          "http://worker-a:4001",
        ].join(",")
      )
    ).toEqual([
      "http://worker-a:4001",
      "https://worker-b.example",
    ]);
  });

  it("rejects missing worker configuration", () => {
    for (const value of [undefined, "", "   "]) {
      expect(() => parseWorkerUrls(value)).toThrow(
        "WORKER_URLS must contain at least one worker URL."
      );
    }
  });

  it("rejects unsafe or invalid worker URLs", () => {
    for (const value of [
      "not-a-url",
      "ftp://worker.example",
      "http://user:password@worker.example",
      "http://worker.example/some-path",
      "http://worker.example?query=yes",
      "http://worker.example#section",
    ]) {
      expect(() => parseWorkerUrls(value)).toThrow();
    }
  });
});

describe("discoverWorkers", () => {
  it("separates available and unavailable workers", async () => {
    const fetchImpl: WorkerFetch = async (input) => {
      const url = String(input);

      if (url.startsWith("http://worker-a:4001")) {
        return jsonResponse({
          status: "ok",
          workerId: "worker-a",
        });
      }

      if (url.startsWith("http://worker-b:4002")) {
        return jsonResponse(
          { error: "Unavailable" },
          503
        );
      }

      return new Response("{invalid", {
        status: 200,
      });
    };

    const result = await discoverWorkers(
      [
        "http://worker-a:4001",
        "http://worker-b:4002",
        "http://worker-c:4003",
      ],
      {
        fetchImpl,
        clock: () => 10,
      }
    );

    expect(result.available).toEqual([
      {
        url: "http://worker-a:4001",
        workerId: "worker-a",
        healthCheckTimeMs: 0,
      },
    ]);

    expect(result.unavailable).toEqual([
      {
        url: "http://worker-b:4002",
        error: "Health check returned HTTP 503.",
        healthCheckTimeMs: 0,
      },
      {
        url: "http://worker-c:4003",
        error: "Health check returned invalid JSON.",
        healthCheckTimeMs: 0,
      },
    ]);
  });

  it("rejects an invalid health response", async () => {
    const fetchImpl: WorkerFetch = async () =>
      jsonResponse({
        status: "wrong",
        workerId: "",
      });

    const result = await discoverWorkers(
      ["http://worker-a:4001"],
      {
        fetchImpl,
        clock: () => 20,
      }
    );

    expect(result.available).toEqual([]);
    expect(result.unavailable[0]).toMatchObject({
      url: "http://worker-a:4001",
      error:
        "Health check returned an invalid response.",
      healthCheckTimeMs: 0,
    });
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

    const result = await discoverWorkers(
      ["http://worker-a:4001"],
      {
        fetchImpl,
        timeoutMs: 5,
      }
    );

    expect(result.available).toEqual([]);
    expect(result.unavailable[0]).toMatchObject({
      url: "http://worker-a:4001",
      error: "Health check timed out after 5 ms.",
    });
  });

  it("normalizes and checks duplicate URLs once", async () => {
    let requestCount = 0;

    const fetchImpl: WorkerFetch = async () => {
      requestCount += 1;

      return jsonResponse({
        status: "ok",
        workerId: "worker-a",
      });
    };

    const result = await discoverWorkers(
      [
        "http://worker-a:4001/",
        "http://worker-a:4001",
      ],
      {
        fetchImpl,
        clock: () => 30,
      }
    );

    expect(requestCount).toBe(1);
    expect(result.available).toHaveLength(1);
  });

  it("records network failures", async () => {
    const fetchImpl: WorkerFetch = async () => {
      throw new TypeError("connection refused");
    };

    const result = await discoverWorkers(
      ["http://worker-a:4001"],
      {
        fetchImpl,
        clock: () => 40,
      }
    );

    expect(result.available).toEqual([]);
    expect(result.unavailable[0]).toMatchObject({
      url: "http://worker-a:4001",
      error: "connection refused",
      healthCheckTimeMs: 0,
    });
  });

  it("rejects invalid timeout configuration", async () => {
    await expect(
      discoverWorkers(["http://worker-a:4001"], {
        timeoutMs: 0,
      })
    ).rejects.toThrow(
      "timeoutMs must be a positive integer."
    );
  });

  it("handles an empty worker list", async () => {
    await expect(
      discoverWorkers([])
    ).resolves.toEqual({
      available: [],
      unavailable: [],
    });
  });
});