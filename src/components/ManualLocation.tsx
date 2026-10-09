"use client";

import { useState } from "react";
import { Button, Group, Text, TextInput } from "@mantine/core";

type Result =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; lat: number; lng: number; address: string }
  | { status: "error"; message: string };

// Lets the user type an address (e.g. if they declined GPS, or want to
// search somewhere else) and shows the coordinates it resolves to.
export default function ManualLocation() {
  const [address, setAddress] = useState("");
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

      setResult({ status: "success", ...data });
    } catch {
      setResult({ status: "error", message: "Couldn't reach the server." });
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Group align="flex-end">
        <TextInput
          label="Or enter an address"
          placeholder="City, ZIP, or street address"
          value={address}
          onChange={(event) => setAddress(event.currentTarget.value)}
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

      {result.status === "success" && (
        <Text mt="sm">
          {result.address}
          <br />
          {result.lat.toFixed(5)}, {result.lng.toFixed(5)}
        </Text>
      )}
    </form>
  );
}
