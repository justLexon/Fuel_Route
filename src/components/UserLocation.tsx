"use client";

import { useEffect, useState } from "react";
import { Text } from "@mantine/core";

type LocationState =
  | { status: "loading" }
  | { status: "success"; lat: number; lng: number }
  | { status: "error"; message: string };

// Asks the browser for the device's location when the page opens.
// The browser shows its own Allow / Block popup.
export default function UserLocation() {
  const [location, setLocation] = useState<LocationState>({ status: "loading" });

  useEffect(() => {
    if (!navigator.geolocation) {
      queueMicrotask(() =>
        setLocation({ status: "error", message: "Your browser doesn't support location." })
      );
      return;
    }

    // watchPosition (unlike getCurrentPosition) keeps listening, so the text
    // updates as soon as the user clicks Allow without needing a reload.
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocation({
          status: "success",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        navigator.geolocation.clearWatch(watchId);
      },
      (error) =>
        setLocation({
          status: "error",
          message:
            error.code === error.PERMISSION_DENIED
              ? "Location access was declined."
              : "Couldn't get your location.",
        })
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  if (location.status === "loading") {
    return <Text c="dimmed">Waiting for location permission...</Text>;
  }

  if (location.status === "error") {
    return <Text c="red">{location.message}</Text>;
  }

  return (
    <Text>
      Your location: {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
    </Text>
  );
}
