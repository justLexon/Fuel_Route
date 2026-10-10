"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Stack, Text } from "@mantine/core";
import { useGpsLocation } from "@/hooks/useGpsLocation";
import type { LatLng } from "@/lib/location";
import { SEARCH_RADIUS_MILES, type Station } from "@/lib/stations";
import ManualLocation from "./ManualLocation";

// Leaflet touches `window`, so it can only load in the browser.
const LocationMap = dynamic(() => import("./LocationMap"), { ssr: false });

// Stations (or an error) along with the location they were loaded for.
type StationResult =
  | { location: LatLng; stations: Station[] }
  | { location: LatLng; error: string };

// Holds the one location the rest of the app uses, and loads nearby stations for it.
// - User allows GPS: center the map there and fill the search box with its address.
// - User blocks GPS: search box stays empty for them to type in.
// A searched address wins over GPS, since the user chose it on purpose.
export default function LocationSection() {
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

  // Load stations whenever the location changes. If it changes again before
  // the request finishes, the old request is cancelled.
  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();

    fetch(`/api/stations?lat=${location.lat}&lng=${location.lng}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        setStationResult(
          res.ok ? { location, stations: data.stations } : { location, error: data.error }
        );
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setStationResult({ location, error: "Couldn't load gas stations." });
        }
      });

    return () => controller.abort();
  }, [location]);

  // Only use results that belong to the current location.
  const current = stationResult?.location === location ? stationResult : null;
  const stations = current && "stations" in current ? current.stations : [];

  return (
    <Stack gap="md">
      <ManualLocation
        address={address}
        onAddressChange={setAddress}
        onLocation={setManualLocation}
      />

      {location && !current && <Text c="dimmed">Finding gas stations...</Text>}
      {current && "error" in current && <Text c="red">{current.error}</Text>}
      {current && "stations" in current && (
        <Text c="dimmed">
          {stations.length} gas stations within {SEARCH_RADIUS_MILES} miles
        </Text>
      )}

      <LocationMap location={location} stations={stations} />
    </Stack>
  );
}
