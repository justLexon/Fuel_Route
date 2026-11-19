"use client";

import { useId, useMemo, useState } from "react";
import { Button, Group, Loader, Paper, SegmentedControl, Text, Title } from "@mantine/core";
import type { Vehicle } from "@/lib/fuelEconomy";
import type { LatLng } from "@/lib/location";
import { DEFAULT_MPG, FILL_UP_GALLONS, rankStations, type SortMode } from "@/lib/ranking";
import { GAS_FUEL_LABELS, SEARCH_RADIUS_MILES, type Station } from "@/lib/stations";
import StationCard from "./StationCard";
import styles from "./Dashboard.module.css";

const PAGE_SIZE = 6;

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

  const [page, setPage] = useState({ stations, count: PAGE_SIZE });
  // A replacement result array starts at six, even without an intermediate loading render.
  const visibleCount = page.stations === stations ? page.count : PAGE_SIZE;
  const visible = ranked.slice(0, visibleCount);
  const hasFuelPrices = ranked.some((entry) => entry.price !== null);
  const fuelLabel = GAS_FUEL_LABELS[fuel];

  if (ranked.length === 0) {
    return (
      <Paper className={styles.resultsMessage} role="status">
        <Text>No stations found within {SEARCH_RADIUS_MILES} miles.</Text>
        <Text c="dimmed" size="sm">Try a nearby city or another address.</Text>
      </Paper>
    );
  }

  return (
    <>
      <Group justify="space-between" align="center" mb="xs" gap="sm">
        <Text c="dimmed" size="sm" role="status">
          {hasFuelPrices
            ? `Showing ${visible.length} of ${ranked.length} stations with ${fuelLabel} prices within ${SEARCH_RADIUS_MILES} miles`
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
      {visible.length < ranked.length && (
        <Button
          className={`${styles.panelAction} ${styles.showMore}`}
          aria-controls={listId}
          onClick={() => setPage({ stations, count: visibleCount + PAGE_SIZE })}
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
      {props.status === "loading" && (
        <Paper className={styles.resultsMessage} role="status">
          <Group gap="sm"><Loader size="sm" color="#51d8cf" /><Text>Finding nearby stations…</Text></Group>
        </Paper>
      )}
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
