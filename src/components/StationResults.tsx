"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button, Group, Loader, Paper, SegmentedControl, Text, Title } from "@mantine/core";
import type { Vehicle } from "@/lib/fuelEconomy";
import type { LatLng } from "@/lib/location";
import { DEFAULT_MPG, FILL_UP_GALLONS, rankStations, type SortMode } from "@/lib/ranking";
import { GAS_FUEL_LABELS, SEARCH_RADIUS_MILES, type Station } from "@/lib/stations";
import { hasStationCoordinates } from "@/lib/stationSelection";
import StationCard from "./StationCard";
import styles from "./Dashboard.module.css";

const PAGE_SIZE = 6;
const MAX_ADDRESS_BATCH = 24; // the most /api/station-address takes at once

// Looked-up addresses are keyed by location (~1 m), like the server's cache.
const addressKey = (station: Station) => `${station.lat.toFixed(5)},${station.lng.toFixed(5)}`;

function needsAddressLookup(station: Station, addresses: Record<string, string | null>) {
  return !station.address?.trim() && hasStationCoordinates(station) && !(addressKey(station) in addresses);
}

function withAddress(station: Station, addresses: Record<string, string | null>): Station {
  return station.address?.trim() ? station : { ...station, address: addresses[addressKey(station)] ?? null };
}

function LoadingMessage() {
  return (
    <Paper className={styles.resultsMessage} role="status">
      <Group gap="sm"><Loader size="sm" color="#51d8cf" /><Text>Finding nearby stations…</Text></Group>
    </Paper>
  );
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "best", label: "Best overall" },
  { value: "cheapest", label: "Cheapest" },
  { value: "closest", label: "Closest" },
];

type ResultProps =
  | { status: "idle" | "loading" }
  | { status: "error"; error: string }
  | {
      status: "success";
      stations: Station[];
      center: LatLng;
      vehicle: Vehicle | null;
      onSelect: (stationId: string) => void;
    };

// State lives only in the successful list, so starting another request resets it.
function StationList({ stations, center, vehicle, onSelect }: {
  stations: Station[];
  center: LatLng;
  vehicle: Vehicle | null;
  onSelect: (stationId: string) => void;
}) {
  const listId = useId();
  const [sort, setSort] = useState<SortMode>("best");
  // Rank by the vehicle's fuel; regular when there's no vehicle or it doesn't use gas.
  const fuel = vehicle?.gasFuel ?? "regular";
  const mpg = vehicle?.mpg ?? null;

  const ranked = useMemo(() => {
    const seen = new Set<string>();
    const uniqueStations = stations.filter((station) => {
      if (seen.has(station.id)) return false;
      seen.add(station.id);
      return true;
    });
    return rankStations(uniqueStations, center, fuel, mpg, sort);
  }, [stations, center, fuel, mpg, sort]);

  // Paging belongs to one search (its center) and one order (sort, fuel, MPG), so
  // a new search or a re-sort starts again at six, without an intermediate
  // loading render. That way a new order appears in one step.
  const order = `${sort}|${fuel}|${mpg}`;
  const [page, setPage] = useState({ center, order, count: PAGE_SIZE });
  const visibleCount = page.center === center && page.order === order ? page.count : PAGE_SIZE;
  const wanted = useMemo(() => ranked.slice(0, visibleCount), [ranked, visibleCount]);

  // Cards only show once their addresses are in, a page at a time, so nothing on
  // the page changes after it appears. Stations without an OSM address get one
  // looked up from their coordinates (null: none found, or the lookup failed).
  const [addresses, setAddresses] = useState<Record<string, string | null>>({});
  const missingPoints = JSON.stringify(
    wanted
      .filter(({ station }) => needsAddressLookup(station, addresses))
      .slice(0, MAX_ADDRESS_BATCH)
      .map(({ station }) => ({ id: addressKey(station), lat: station.lat, lng: station.lng }))
  );

  useEffect(() => {
    const points: { id: string }[] = JSON.parse(missingPoints);
    if (points.length === 0) return;
    const controller = new AbortController();
    fetch("/api/station-address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : {}))
      .catch((error: Error) => (error.name === "AbortError" ? null : {}))
      .then((data: { addresses?: Record<string, string | null> } | null) => {
        if (!data) return; // cancelled: a newer lookup replaced this one
        // Anything without an answer counts as "no address", so the page still shows.
        setAddresses((previous) => ({
          ...previous,
          ...Object.fromEntries(points.map(({ id }) => [id, data.addresses?.[id] ?? null])),
        }));
      });
    return () => controller.abort();
  }, [missingPoints]);

  // Show whole pages only: all wanted cards when every address is in; otherwise
  // the full pages before the first card still waiting (e.g. after "Show more").
  let readyCount = 0;
  while (readyCount < wanted.length && !needsAddressLookup(wanted[readyCount].station, addresses)) {
    readyCount++;
  }
  const shownCount = readyCount === wanted.length
    ? readyCount
    : Math.floor(readyCount / PAGE_SIZE) * PAGE_SIZE;
  const visible = wanted.slice(0, shownCount).map((entry) => ({
    ...entry,
    station: withAddress(entry.station, addresses),
  }));
  const loadingMore = shownCount < wanted.length;
  const hasFuelPrices = ranked.some((entry) => entry.price !== null);
  const fuelLabel = GAS_FUEL_LABELS[fuel];

  // Until the first page is ready, keep showing just the loading message, so the
  // header and cards appear together. (Updating state during render is React's
  // pattern for remembering something from an earlier render.)
  const [firstPageShown, setFirstPageShown] = useState(false);
  if (visible.length > 0 && !firstPageShown) setFirstPageShown(true);

  if (ranked.length === 0) {
    return (
      <Paper className={styles.resultsMessage} role="status">
        <Text>No stations found within {SEARCH_RADIUS_MILES} miles.</Text>
        <Text c="dimmed" size="sm">Try a nearby city or another address.</Text>
      </Paper>
    );
  }

  if (!firstPageShown && visible.length === 0) return <LoadingMessage />;

  return (
    <>
      <Group justify="space-between" align="center" mb="xs" gap="sm">
        <Text c="dimmed" size="sm" role="status">
          {hasFuelPrices
            ? `Showing ${wanted.length} of ${ranked.length} stations with ${fuelLabel} prices within ${SEARCH_RADIUS_MILES} miles`
            : `No ${fuelLabel} prices nearby. Showing the closest stations.`}
        </Text>
        {hasFuelPrices && (
          <SegmentedControl
            size="xs"
            value={sort}
            onChange={(value) => setSort(value as SortMode)}
            data={SORT_OPTIONS}
            aria-label="Sort stations"
          />
        )}
      </Group>
      <Text c="dimmed" size="xs" mb="md">
        {!vehicle
          ? `Ranked by ${fuelLabel} prices, ${DEFAULT_MPG} MPG. Select your vehicle to rank by its fuel and MPG.`
          : !vehicle.gasFuel
            ? `Gas prices don't apply to this vehicle (${vehicle.fuelType || "unknown fuel"}). Showing ${fuelLabel} prices.`
            : `Ranked for your ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${fuelLabel}, ${mpg ?? DEFAULT_MPG} MPG.`}
        {hasFuelPrices && sort === "best" && ` Best overall = cost of a ${FILL_UP_GALLONS}-gallon fill-up plus the gas to drive there and back.`}
      </Text>
      {visible.length === 0 ? (
        <LoadingMessage />
      ) : (
        <div id={listId} className={styles.stationGrid}>
          {visible.map((entry) => (
            <StationCard
              key={entry.station.id}
              station={entry.station}
              center={center}
              highlightFuel={hasFuelPrices ? fuel : null}
              fillUpCost={entry.fillUpCost}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      {visible.length > 0 && (wanted.length < ranked.length || loadingMore) && (
        <Button
          className={`${styles.panelAction} ${styles.showMore}`}
          aria-controls={listId}
          loading={loadingMore}
          onClick={() => setPage({ center, order, count: visibleCount + PAGE_SIZE })}
        >
          Show more
        </Button>
      )}
    </>
  );
}

export default function StationResults(props: ResultProps) {
  const headingId = useId();
  return (
    <section className={styles.stationResults} aria-labelledby={headingId}>
      <Title order={2} id={headingId} className={styles.resultsTitle}>Nearby stations</Title>
      {props.status === "idle" && (
        <Paper className={styles.resultsMessage} role="status">
          <Text>Enter a location or allow location access to find nearby stations.</Text>
        </Paper>
      )}
      {props.status === "loading" && <LoadingMessage />}
      {props.status === "error" && (
        <Paper className={styles.resultsMessage} role="alert">
          <Text c="red">{props.error}</Text>
        </Paper>
      )}
      {props.status === "success" && (
        <StationList stations={props.stations} center={props.center} vehicle={props.vehicle} onSelect={props.onSelect} />
      )}
    </section>
  );
}
