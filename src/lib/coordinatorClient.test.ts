import { describe, expect, it } from "vitest";
import {
  CoordinatorClientError,
  sendCoordinatorRequest,
  type CoordinatorFetch,
} from "./coordinatorClient";
import type {
  CoordinatorRequest,
  CoordinatorResponse,
} from "./processing";

function request(): CoordinatorRequest {
  return {
    userLocation: {
      lat: 30.2,
      lng: -92,
    },
    requiredFuel: "regular",
    stations: [],
    sortBy: "best",
    mode: "distributed",
  };
}

function coordinatorResponse(): CoordinatorResponse {
  return {
    jobId: "job-1",
    stations: [],
    metrics: {
      mode: "distributed",
      totalStations: 0,
      workerCount: 0,
      completedBatches: 0,
      retriedBatches: 0,
      failedBatches: 0,
      totalTimeMs: 1.25,
    },
  };
}

describe("sendCoordinatorRequest", () => {
  it("posts the request to the coordinator process endpoint", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const fetchImpl: CoordinatorFetch = async (
      input,
      init
    ) => {
      capturedUrl = input.toString();
      capturedInit = init;

      return Response.json(
        coordinatorResponse()
      );
    };

    const input = request();

    const result = await sendCoordinatorRequest(
      input,
      {
        coordinatorUrl:
          "http://127.0.0.1:4000/",
        fetchImpl,
      }
    );

    expect(result).toEqual(
      coordinatorResponse()
    );
    expect(capturedUrl).toBe(
      "http://127.0.0.1:4000/process"
    );
    expect(capturedInit?.method).toBe("POST");
    expect(
      new Headers(capturedInit?.headers).get(
        "Content-Type"
      )
    ).toBe("application/json");
    expect(
      JSON.parse(String(capturedInit?.body))
    ).toEqual(input);
  });

  it.each([
    "",
    "not-a-url",
    "ftp://coordinator.example",
    "http://user:password@coordinator.example",
    "http://coordinator.example/some-path",
    "http://coordinator.example?query=yes",
  ])(
    "rejects invalid coordinator URL %j",
    async (coordinatorUrl) => {
      await expect(
        sendCoordinatorRequest(request(), {
          coordinatorUrl,
        })
      ).rejects.toMatchObject({
        name: "CoordinatorClientError",
        status: 503,
      });
    }
  );

  it("reports coordinator HTTP errors", async () => {
    const fetchImpl: CoordinatorFetch =
      async () =>
        Response.json(
          {
            error:
              "No processing workers are available.",
          },
          {
            status: 503,
          }
        );

    await expect(
      sendCoordinatorRequest(request(), {
        coordinatorUrl:
          "http://coordinator:4000",
        fetchImpl,
      })
    ).rejects.toEqual(
      new CoordinatorClientError(
        "No processing workers are available.",
        503
      )
    );
  });

  it("rejects invalid coordinator JSON", async () => {
    const fetchImpl: CoordinatorFetch =
      async () =>
        new Response("not JSON", {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
          },
        });

    await expect(
      sendCoordinatorRequest(request(), {
        coordinatorUrl:
          "http://coordinator:4000",
        fetchImpl,
      })
    ).rejects.toEqual(
      new CoordinatorClientError(
        "Coordinator returned invalid JSON.",
        502
      )
    );
  });

  it("rejects an invalid success response", async () => {
    const fetchImpl: CoordinatorFetch =
      async () =>
        Response.json({
          jobId: "job-1",
          stations: [],
        });

    await expect(
      sendCoordinatorRequest(request(), {
        coordinatorUrl:
          "http://coordinator:4000",
        fetchImpl,
      })
    ).rejects.toEqual(
      new CoordinatorClientError(
        "Coordinator returned an invalid response.",
        502
      )
    );
  });

  it("reports coordinator timeouts", async () => {
    const fetchImpl: CoordinatorFetch =
      async () => {
        const error = new Error(
          "The operation timed out."
        );
        error.name = "TimeoutError";
        throw error;
      };

    await expect(
      sendCoordinatorRequest(request(), {
        coordinatorUrl:
          "http://coordinator:4000",
        fetchImpl,
      })
    ).rejects.toEqual(
      new CoordinatorClientError(
        "Coordinator request timed out.",
        504
      )
    );
  });

  it("reports other connection failures", async () => {
    const fetchImpl: CoordinatorFetch =
      async () => {
        throw new Error("Connection refused.");
      };

    await expect(
      sendCoordinatorRequest(request(), {
        coordinatorUrl:
          "http://coordinator:4000",
        fetchImpl,
      })
    ).rejects.toEqual(
      new CoordinatorClientError(
        "Coordinator is unavailable.",
        502
      )
    );
  });
});