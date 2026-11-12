"use client";

import { useId, useMemo, useState } from "react";
import { Button, Group, Loader, Paper, Text, Title } from "@mantine/core";
import type { LatLng } from "@/lib/location";
import { SEARCH_RADIUS_MILES, type Station } from "@/lib/stations";
import StationCard from "./StationCard";
import styles from "./Dashboard.module.css";

const PAGE_SIZE = 6;

type ResultProps =
  | { status: "idle" | "loading" }
  | { status: "error"; error: string }
  | { status: "success"; stations: Station[]; center: LatLng; onSelect: (stationId: string) => void };

// State lives only in the successful list, so starting another request resets it.
function StationList({ stations, center, onSelect }: {
  stations: Station[];
  center: LatLng;
  onSelect: (stationId: string) => void;
}) {
  const listId = useId();
  const uniqueStations = useMemo(() => {
    const seen = new Set<string>();
    return stations.filter((station) => {
      if (seen.has(station.id)) return false;
      seen.add(station.id);
      return true;
    });
  }, [stations]);
  const [page, setPage] = useState({ stations, count: PAGE_SIZE });
  // A replacement result array starts at six, even without an intermediate loading render.
  const visibleCount = page.stations === stations ? page.count : PAGE_SIZE;
  const visible = uniqueStations.slice(0, visibleCount);

  if (uniqueStations.length === 0) {
    return (
      <Paper className={styles.resultsMessage} role="status">
        <Text>No stations found within {SEARCH_RADIUS_MILES} miles.</Text>
        <Text c="dimmed" size="sm">Try a nearby city or another address.</Text>
      </Paper>
    );
  }

  return (
    <>
      <Text c="dimmed" size="sm" mb="md" role="status">
        Showing {visible.length} of {uniqueStations.length} stations within {SEARCH_RADIUS_MILES} miles
      </Text>
      <div id={listId} className={styles.stationGrid}>
        {visible.map((station) => <StationCard key={station.id} station={station} center={center} onSelect={onSelect} />)}
      </div>
      {visible.length < uniqueStations.length && (
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
      {props.status === "success" && <StationList stations={props.stations} center={props.center} onSelect={props.onSelect} />}
    </section>
  );
}
