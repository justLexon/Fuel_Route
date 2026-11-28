"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Paper, Stack, Text, Title } from "@mantine/core";
import { useGpsLocation } from "@/hooks/useGpsLocation";
import type { LatLng } from "@/lib/location";
import { SEARCH_RADIUS_MILES, type Station } from "@/lib/stations";
import type { Vehicle } from "@/lib/fuelEconomy";
import type { Processing } from "@/lib/coordinator";
import ManualLocation from "./ManualLocation";
import VehiclePicker from "./VehiclePicker";
import styles from "./Dashboard.module.css";
import StationResults from "./StationResults";
import { hasStationCoordinates, resolveStationSelection, type StationSelection } from "@/lib/stationSelection";
import { getStationDisplayName } from "@/lib/stationDisplay";

// Leaflet touches `window`, so it can only load in the browser.
const LocationMap = dynamic(() => import("./LocationMap"), { ssr: false });

// Stations (or an error) along with the location and fuel they were loaded for.
type StationResult =
  | { location: LatLng; fuel: string; stations: Station[]; processing: Processing }
  | { location: LatLng; fuel: string; error: string };

// Holds the one location the rest of the app uses, and loads nearby stations for it.
// - User allows GPS: center the map there and fill the search box with its address.
// - User blocks GPS: search box stays empty for them to type in.
// A searched address wins over GPS, since the user chose it on purpose.
export default function LocationSection() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [gpsLocation, setGpsLocation] = useState<LatLng | null>(null);
  const [manualLocation, setManualLocation] = useState<LatLng | null>(null);
  const [address, setAddress] = useState("");
  const [stationResult, setStationResult] = useState<StationResult | null>(null);

  const handleGpsLocation = useCallback(async (location: LatLng) => {
    setGpsLocation(location);

    try {
      const res = await fetch(`/api/geocode?lat=${location.lat}&lng=${location.lng}`);
      if (!res.ok) return;
      const data = await res.json();
      // Don't overwrite anything the user already started typing.
      setAddress((current) => current || data.address);
    } catch {
      // No address is fine; the map still shows the GPS location.
    }
  }, []);

  useGpsLocation(handleGpsLocation);

  const location = manualLocation ?? gpsLocation;
  // The server's workers check fuel compatibility, so the list is loaded for
  // the vehicle's fuel (regular when there's no vehicle or it doesn't use gas).
  const fuel = vehicle?.gasFuel ?? "regular";

  // Load stations whenever the location or fuel changes. If either changes again
  // before the request finishes, the old request is cancelled.
  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();

    fetch(`/api/stations?lat=${location.lat}&lng=${location.lng}&fuel=${fuel}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        setStationResult(
          res.ok
            ? { location, fuel, stations: data.stations, processing: data.processing ?? { distributed: false } }
            : { location, fuel, error: data.error }
        );
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setStationResult({ location, fuel, error: "Couldn't load gas stations." });
        }
      });

    return () => controller.abort();
  }, [location, fuel]);

  // Only use results that belong to the current location and fuel.
  const current = stationResult?.location === location && stationResult.fuel === fuel ? stationResult : null;
  // Only show stations (on the map and in the list) that sell the vehicle's fuel,
  // or regular when there's no vehicle or it doesn't use gas, matching the list's
  // ranking. If none do (e.g. GasBuddy is down), show them all rather than nothing.
  // Memoized because map selection compares this array by identity.
  const stations = useMemo(() => {
    const all = current && "stations" in current ? current.stations : [];
    const withFuel = all.filter((station) => station.prices?.[fuel]);
    return withFuel.length > 0 ? withFuel : all;
  }, [current, fuel]);

  const [selection, setSelection] = useState<StationSelection | null>(null);
  const [shownSelection, setShownSelection] = useState<StationSelection | null>(null);
  const mapFrame = useRef<HTMLElement>(null);
  const activeSelection = current && "stations" in current && resolveStationSelection(selection, stations)
    ? selection : null;
  const shownStation = shownSelection === activeSelection
    ? resolveStationSelection(activeSelection, stations) : null;

  function handleStationSelect(stationId: string) {
    if (!current || !("stations" in current)) return;
    const station = stations.find((item) => item.id === stationId);
    if (!station || !hasStationCoordinates(station)) return;
    setSelection((previous) => ({ stationId, stations, activation: (previous?.activation ?? 0) + 1 }));
    const frame = mapFrame.current;
    if (frame) {
      const bounds = frame.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        frame.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }
  }

  const handleStationShown = useCallback((shown: StationSelection) => setShownSelection(shown), []);

  return (
    <>
      <div className={styles.workspace}>
        <div className={styles.sidebar}>
          <Paper component="section" className={styles.panel} aria-labelledby="vehicle-heading">
            <Title order={2} id="vehicle-heading" className={styles.panelTitle}>
              <span className={styles.step} aria-hidden="true">1</span>Your vehicle
            </Title>
            <VehiclePicker vehicle={vehicle} onVehicleChange={setVehicle} />
          </Paper>
          <Paper component="section" className={styles.panel} aria-labelledby="location-heading">
            <Title order={2} id="location-heading" className={styles.panelTitle}>
              <span className={styles.step} aria-hidden="true">2</span>Where are you headed?
            </Title>
            <ManualLocation
              address={address}
              onAddressChange={setAddress}
              onLocation={setManualLocation}
            />
            <Text className={styles.hint}>Search area: {SEARCH_RADIUS_MILES} miles</Text>
            <Stack gap="xs" mt="sm">
              {location && !current && <Text c="dimmed">Finding gas stations...</Text>}
              {current && "error" in current && <Text c="red">{current.error}</Text>}
              {current && "stations" in current && (
                <Text c="dimmed">
                  {stations.length} gas stations within {SEARCH_RADIUS_MILES} miles
                </Text>
              )}
            </Stack>
          </Paper>
        </div>
        <section ref={mapFrame} className={styles.mapFrame} aria-label="Nearby gas stations map">
          <LocationMap
            location={location}
            stations={stations}
            selection={activeSelection}
            onStationShown={handleStationShown}
          />
        </section>
      </div>
      <div className={styles.mapAnnouncement} role="status" aria-live="polite" aria-atomic="true">
        {shownStation && activeSelection && (
          <span key={activeSelection.activation}>{getStationDisplayName(shownStation)} shown on map. Station popup opened.</span>
        )}
      </div>
      {!location ? <StationResults status="idle" />
        : !current ? <StationResults status="loading" />
        : "error" in current ? <StationResults status="error" error={current.error} />
        : <StationResults status="success" stations={stations} center={current.location} vehicle={vehicle} processing={current.processing} onSelect={handleStationSelect} />}
    </>
  );
}
