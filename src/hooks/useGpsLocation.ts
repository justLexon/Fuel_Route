"use client";

import { useEffect } from "react";
import type { LatLng } from "@/lib/location";

// Asks the browser for the device's location when the page opens.
// The browser shows its own Allow / Block popup. `onLocation` is only
// called if the user allows it; if they block it, nothing happens.
export function useGpsLocation(onLocation: (location: LatLng) => void) {
  useEffect(() => {
    if (!navigator.geolocation) return;

    // watchPosition (unlike getCurrentPosition) keeps listening, so this fires
    // as soon as the user clicks Allow without needing a reload.
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        onLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        navigator.geolocation.clearWatch(watchId);
      },
      () => navigator.geolocation.clearWatch(watchId)
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [onLocation]);
}
