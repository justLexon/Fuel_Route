"use client";

import { useState } from "react";
import { Button, Group, Text, TextInput } from "@mantine/core";
import type { LatLng } from "@/lib/location";

type Result =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

// Address search box. Filled in automatically from GPS when the user allows
// location, otherwise left empty for them to type in.
export default function ManualLocation({
  address,
  onAddressChange,
  onLocation,
}: {
  address: string;
  onAddressChange: (address: string) => void;
  onLocation: (location: LatLng) => void;
}) {
  const [result, setResult] = useState<Result>({ status: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address.trim()) return;

    setResult({ status: "loading" });

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      const data = await res.json();

      if (!res.ok) {
        setResult({ status: "error", message: data.error });
        return;
      }

      setResult({ status: "idle" });
      onLocation({ lat: data.lat, lng: data.lng });
    } catch {
      setResult({ status: "error", message: "Couldn't reach the server." });
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Group align="flex-end">
        <TextInput
          label="Location"
          placeholder="City, ZIP, or street address"
          value={address}
          onChange={(event) => onAddressChange(event.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button type="submit" loading={result.status === "loading"}>
          Search
        </Button>
      </Group>

      {result.status === "error" && (
        <Text c="red" mt="sm">
          {result.message}
        </Text>
      )}

    </form>
  );
}
