"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Paper, Stack, Text, Title } from "@mantine/core";
import { useGpsLocation } from "@/hooks/useGpsLocation";
import type { Vehicle } from "@/lib/fuelEconomy";
import type { LatLng } from "@/lib/location";
import { getStationDisplayName } from "@/lib/stationDisplay";
import {
  hasStationCoordinates,
  resolveStationSelection,
  type StationSelection,
} from "@/lib/stationSelection";
import {
  SEARCH_RADIUS_MILES,
  type GasFuel,
  type Station,
} from "@/lib/stations";
import ManualLocation from "./ManualLocation";
import StationResults from "./StationResults";
import VehiclePicker from "./VehiclePicker";
import styles from "./Dashboard.module.css";

// Leaflet touches `window`, so it can only load in the browser.
const LocationMap = dynamic(() => import("./LocationMap"), {
  ssr: false,
});

type ProcessingSummary = {
  jobId: string;
  mode: "single" | "distributed";
  totalStations: number;
  workerCount: number;
  completedBatches: number;
  retriedBatches: number;
  failedBatches: number;
  totalTimeMs: number;
};

// Results belong to both a location and a selected fuel. This prevents a
// response for the previous vehicle from appearing after the fuel changes.
type StationResult =
  | {
      location: LatLng;
      fuel: GasFuel;
      stations: Station[];
      processing: ProcessingSummary | null;
      processingError?: string;
    }
  | {
      location: LatLng;
      fuel: GasFuel;
      error: string;
    };

// Holds the one location the rest of the app uses, and loads nearby stations.
// A searched address wins over GPS, since the user chose it on purpose.
export default function LocationSection() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [gpsLocation, setGpsLocation] = useState<LatLng | null>(null);
  const [manualLocation, setManualLocation] = useState<LatLng | null>(null);
  const [address, setAddress] = useState("");
  const [stationResult, setStationResult] =
    useState<StationResult | null>(null);

  const handleGpsLocation = useCallback(async (location: LatLng) => {
    setGpsLocation(location);

    try {
      const res = await fetch(
        `/api/geocode?lat=${location.lat}&lng=${location.lng}`
      );

      if (!res.ok) return;

      const data = await res.json();

      // Do not overwrite anything the user already started typing.
      setAddress((current) => current || data.address);
    } catch {
      // No address is fine; the map still shows the GPS location.
    }
  }, []);

  useGpsLocation(handleGpsLocation);

  const location = manualLocation ?? gpsLocation;
  const fuel: GasFuel = vehicle?.gasFuel ?? "regular";

  // Load and process stations whenever either the location or fuel changes.
  // If another request starts first, cancel the previous request.
  useEffect(() => {
    if (!location) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
      fuel,
    });

    fetch(`/api/stations?${params}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();

        if (res.ok) {
          setStationResult({
            location,
            fuel,
            stations: data.stations,
            processing: data.processing ?? null,
            processingError:
              typeof data.processingError === "string"
                ? data.processingError
                : undefined,
          });
          return;
        }

        setStationResult({
          location,
          fuel,
          error:
            typeof data.error === "string"
              ? data.error
              : "Couldn't load gas stations.",
        });
      })
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          return;
        }

        setStationResult({
          location,
          fuel,
          error: "Couldn't load gas stations.",
        });
      });

    return () => controller.abort();
  }, [location, fuel]);

  // Only use results belonging to the current location and selected fuel.
  const current =
    stationResult?.location === location &&
    stationResult.fuel === fuel
      ? stationResult
      : null;

  // Prefer stations with a known price for the selected fuel. If prices are
  // unavailable, retain all compatible stations returned by the coordinator.
  const stations = useMemo(() => {
    const all =
      current && "stations" in current ? current.stations : [];

    const withFuel = all.filter(
      (station) => station.prices?.[fuel]
    );

    return withFuel.length > 0 ? withFuel : all;
  }, [current, fuel]);

  const [selection, setSelection] =
    useState<StationSelection | null>(null);
  const [shownSelection, setShownSelection] =
    useState<StationSelection | null>(null);
  const mapFrame = useRef<HTMLElement>(null);

  const activeSelection =
    current &&
    "stations" in current &&
    resolveStationSelection(selection, stations)
      ? selection
      : null;

  const shownStation =
    shownSelection === activeSelection
      ? resolveStationSelection(activeSelection, stations)
      : null;

  function handleStationSelect(stationId: string) {
    if (!current || !("stations" in current)) return;

    const station = stations.find((item) => item.id === stationId);
    if (!station || !hasStationCoordinates(station)) return;

    setSelection((previous) => ({
      stationId,
      stations,
      activation: (previous?.activation ?? 0) + 1,
    }));

    const frame = mapFrame.current;

    if (frame) {
      const bounds = frame.getBoundingClientRect();

      if (
        bounds.top < 0 ||
        bounds.bottom > window.innerHeight
      ) {
        frame.scrollIntoView({
          block: "nearest",
          behavior: "instant",
        });
      }
    }
  }

  const handleStationShown = useCallback(
    (shown: StationSelection) => setShownSelection(shown),
    []
  );

  return (
    <>
      <div className={styles.workspace}>
        <div className={styles.sidebar}>
          <Paper
            component="section"
            className={styles.panel}
            aria-labelledby="vehicle-heading"
          >
            <Title
              order={2}
              id="vehicle-heading"
              className={styles.panelTitle}
            >
              <span className={styles.step} aria-hidden="true">
                1
              </span>
              Your vehicle
            </Title>

            <VehiclePicker
              vehicle={vehicle}
              onVehicleChange={setVehicle}
            />
          </Paper>

          <Paper
            component="section"
            className={styles.panel}
            aria-labelledby="location-heading"
          >
            <Title
              order={2}
              id="location-heading"
              className={styles.panelTitle}
            >
              <span className={styles.step} aria-hidden="true">
                2
              </span>
              Where are you headed?
            </Title>

            <ManualLocation
              address={address}
              onAddressChange={setAddress}
              onLocation={setManualLocation}
            />

            <Text className={styles.hint}>
              Search area: {SEARCH_RADIUS_MILES} miles
            </Text>

            <Stack gap="xs" mt="sm">
              {location && !current && (
                <Text c="dimmed">
                  Finding and processing gas stations...
                </Text>
              )}

              {current && "error" in current && (
                <Text c="red">{current.error}</Text>
              )}

              {current && "stations" in current && (
                <>
                  <Text c="dimmed">
                    {stations.length} gas stations within{" "}
                    {SEARCH_RADIUS_MILES} miles
                  </Text>

                  {current.processing && (
                    <Text c="dimmed" size="xs">
                      Distributed processing:{" "}
                      {current.processing.workerCount} worker
                      {current.processing.workerCount === 1
                        ? ""
                        : "s"}
                      , {current.processing.totalTimeMs.toFixed(1)} ms
                    </Text>
                  )}

                  {current.processingError && (
                    <Text c="orange" size="xs">
                      {current.processingError}
                    </Text>
                  )}
                </>
              )}
            </Stack>
          </Paper>
        </div>

        <section
          ref={mapFrame}
          className={styles.mapFrame}
          aria-label="Nearby gas stations map"
        >
          <LocationMap
            location={location}
            stations={stations}
            selection={activeSelection}
            onStationShown={handleStationShown}
          />
        </section>
      </div>

      <div
        className={styles.mapAnnouncement}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {shownStation && activeSelection && (
          <span key={activeSelection.activation}>
            {getStationDisplayName(shownStation)} shown on map.
            Station popup opened.
          </span>
        )}
      </div>

      {!location ? (
        <StationResults status="idle" />
      ) : !current ? (
        <StationResults status="loading" />
      ) : "error" in current ? (
        <StationResults
          status="error"
          error={current.error}
        />
      ) : (
        <StationResults
          status="success"
          stations={stations}
          center={current.location}
          vehicle={vehicle}
          onSelect={handleStationSelect}
        />
      )}
    </>
  );
}