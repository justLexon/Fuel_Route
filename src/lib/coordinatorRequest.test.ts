import { describe, expect, it } from "vitest";
import {
  createCoordinatorRequest,
  createPricesByStationId,
} from "./coordinatorRequest";
import type {
  Station,
  StationPrices,
} from "./stations";

function station(
  id: string,
  prices?: StationPrices
): Station {
  return {
    id,
    name: `Station ${id}`,
    brand: null,
    lat: 30.2,
    lng: -92,
    address: null,
    fuels: [],
    ...(prices ? { prices } : {}),
  };
}

describe("createPricesByStationId", () => {
  it("converts dollar prices into cents", () => {
    const result = createPricesByStationId([
      station("station-1", {
        regular: {
          price: 3.159,
          cash: false,
        },
        diesel: {
          price: 4.25,
          cash: true,
        },
      }),
      station("station-2"),
    ]);

    expect(result).toEqual({
      "station-1": [
        {
          fuelType: "regular",
          centsPerGallon: 316,
          source: "gasbuddy",
          observedAt: null,
        },
        {
          fuelType: "diesel",
          centsPerGallon: 425,
          source: "gasbuddy",
          observedAt: null,
        },
      ],
    });
  });

  it("ignores missing or invalid prices", () => {
    const result = createPricesByStationId([
      station("invalid", {
        regular: {
          price: Number.NaN,
          cash: false,
        },
        premium: {
          price: 0,
          cash: false,
        },
        diesel: {
          price: -1,
          cash: false,
        },
      }),
    ]);

    expect(result).toEqual({});
  });

  it("does not modify the stations", () => {
    const stations = [
      station("station-1", {
        regular: {
          price: 3.25,
          cash: false,
        },
      }),
    ];
    const original = structuredClone(stations);

    createPricesByStationId(stations);

    expect(stations).toEqual(original);
  });
});

describe("createCoordinatorRequest", () => {
  it("uses distributed best-ranking defaults", () => {
    const stations = [station("station-1")];

    const request = createCoordinatorRequest({
      userLocation: {
        lat: 30.2,
        lng: -92,
      },
      requiredFuel: "regular",
      stations,
    });

    expect(request).toEqual({
      userLocation: {
        lat: 30.2,
        lng: -92,
      },
      requiredFuel: "regular",
      stations,
      sortBy: "best",
      mode: "distributed",
    });
  });

  it("includes prices and requested processing options", () => {
    const stations = [
      station("station-1", {
        premium: {
          price: 3.99,
          cash: false,
        },
      }),
    ];

    const request = createCoordinatorRequest({
      userLocation: {
        lat: 30.2,
        lng: -92,
      },
      requiredFuel: "premium",
      stations,
      sortBy: "cheapest",
      mode: "single",
    });

    expect(request.sortBy).toBe("cheapest");
    expect(request.mode).toBe("single");
    expect(request.pricesByStationId).toEqual({
      "station-1": [
        {
          fuelType: "premium",
          centsPerGallon: 399,
          source: "gasbuddy",
          observedAt: null,
        },
      ],
    });
  });
});