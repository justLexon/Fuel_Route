import { describe, expect, it } from "vitest";
import type {
  CoordinatorRequest,
} from "../../src/lib/processing";
import {
  MAX_COORDINATOR_STATIONS,
  validateCoordinatorRequest,
} from "./validateRequest";

function makeRequest(
  stationCount: number
): CoordinatorRequest {
  return {
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
        lat: 30 + index / 10_000,
        lng: -90,
        address: null,
        fuels: ["regular"],
      })
    ),
  };
}

function failureMessage(value: unknown): string {
  const result = validateCoordinatorRequest(value);

  expect(result.success).toBe(false);

  return result.success ? "" : result.error;
}

describe("validateCoordinatorRequest", () => {
  it("accepts a valid minimal request", () => {
    const request = makeRequest(2);
    const result =
      validateCoordinatorRequest(request);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).toEqual(request);
    }
  });

  it("accepts valid optional settings and prices", () => {
    const request: CoordinatorRequest = {
      ...makeRequest(1),
      sortBy: "cheapest",
      mode: "single",
      pricesByStationId: {
        "station-1": [
          {
            fuelType: "regular",
            centsPerGallon: 300,
            source: "test",
            observedAt: null,
          },
        ],
      },
    };

    const result =
      validateCoordinatorRequest(request);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).toEqual(request);
    }
  });

  it("accepts a request with no stations", () => {
    const request = makeRequest(0);
    const result =
      validateCoordinatorRequest(request);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.stations).toEqual([]);
    }
  });

  it("rejects a non-object request body", () => {
    for (const value of [
      null,
      undefined,
      "request",
      42,
      [],
    ]) {
      expect(failureMessage(value)).toBe(
        "Request body must be an object."
      );
    }
  });

  it("requires stations to be an array", () => {
    expect(
      failureMessage({
        ...makeRequest(1),
        stations: "invalid",
      })
    ).toBe("stations must be an array.");
  });

  it("limits the total number of stations", () => {
    const request = makeRequest(
      MAX_COORDINATOR_STATIONS + 1
    );

    expect(
      failureMessage(request)
    ).toBe(
      `stations cannot contain more than ` +
        `${MAX_COORDINATOR_STATIONS} entries.`
    );
  });

  it("rejects invalid sort and processing modes", () => {
    expect(
      failureMessage({
        ...makeRequest(1),
        sortBy: "price",
      })
    ).toBe(
      "sortBy must be best, cheapest, or closest."
    );

    expect(
      failureMessage({
        ...makeRequest(1),
        mode: "parallel",
      })
    ).toBe(
      "mode must be single or distributed."
    );
  });

  it("reuses worker validation for shared fields", () => {
    expect(
      failureMessage({
        ...makeRequest(1),
        userLocation: {
          lat: 200,
          lng: -90,
        },
      })
    ).toContain("userLocation");

    expect(
      failureMessage({
        ...makeRequest(1),
        requiredFuel: "rocket-fuel",
      })
    ).toContain("requiredFuel");

    expect(
      failureMessage({
        ...makeRequest(1),
        stations: [
          {
            ...makeRequest(1).stations[0],
            id: "",
          },
        ],
      })
    ).toContain("stations[0].id");
  });

  it("adjusts station indexes after the first batch", () => {
    const request = makeRequest(501);
    request.stations[500].lat = 200;

    expect(
      failureMessage(request)
    ).toContain("stations[500]");
  });

  it("rejects duplicate IDs across worker batches", () => {
    const request = makeRequest(501);

    request.stations[500].id =
      request.stations[0].id;

    expect(
      failureMessage(request)
    ).toBe(
      "stations must not contain duplicate station IDs."
    );
  });

  it("rejects prices for an unknown station", () => {
    const request: CoordinatorRequest = {
      ...makeRequest(1),
      pricesByStationId: {
        unknown: [
          {
            fuelType: "regular",
            centsPerGallon: 300,
            source: "test",
            observedAt: null,
          },
        ],
      },
    };

    expect(
      failureMessage(request)
    ).toBe(
      "pricesByStationId contains unknown " +
        "station ID: unknown."
    );
  });

  it("limits the number of station price entries", () => {
    const pricesByStationId =
      Object.fromEntries(
        Array.from(
          {
            length:
              MAX_COORDINATOR_STATIONS + 1,
          },
          (_, index) => [
            `station-${index + 1}`,
            [],
          ]
        )
      );

    expect(
      failureMessage({
        ...makeRequest(0),
        pricesByStationId,
      })
    ).toBe(
      `pricesByStationId cannot contain more than ` +
        `${MAX_COORDINATOR_STATIONS} station entries.`
    );
  });

  it("rejects invalid station prices", () => {
    expect(
      failureMessage({
        ...makeRequest(1),
        pricesByStationId: {
          "station-1": [
            {
              fuelType: "regular",
              centsPerGallon: 0,
              source: "test",
              observedAt: null,
            },
          ],
        },
      })
    ).toContain("centsPerGallon");
  });

  it("does not modify the request", () => {
    const request: CoordinatorRequest = {
      ...makeRequest(2),
      mode: "distributed",
      sortBy: "best",
    };

    const before = JSON.stringify(request);

    validateCoordinatorRequest(request);

    expect(JSON.stringify(request)).toBe(before);
  });
});