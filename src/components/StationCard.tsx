import { Button, Paper, Text, Title } from "@mantine/core";
import type { LatLng } from "@/lib/location";
import type { Station } from "@/lib/stations";
import { straightLineMiles } from "@/lib/distance";
import { getStationDisplayName } from "@/lib/stationDisplay";
import styles from "./Dashboard.module.css";
import { hasStationCoordinates } from "@/lib/stationSelection";

export default function StationCard({ station, center, onSelect }: {
  station: Station;
  center: LatLng;
  onSelect: (stationId: string) => void;
}) {
  const distance = straightLineMiles(center, station);
  const canShowOnMap = hasStationCoordinates(station);

  return (
    <Paper component="article" className={styles.stationCard}>
      <Title order={3} className={styles.stationName}>
        {getStationDisplayName(station)}
      </Title>
      <Text className={styles.stationAddress}>
        {station.address?.trim() || (canShowOnMap ? "Location available on map" : "Address unavailable")}
      </Text>
      {distance !== null && (
        <Text className={styles.stationDistance}>
          {distance > 0 && distance < 0.1 ? "Less than 0.1" : distance.toFixed(1)} mi
          <span className={styles.distanceLabel}>Straight-line distance</span>
        </Text>
      )}
      <Button
        type="button"
        className={`${styles.panelAction} ${styles.stationMapAction}`}
        aria-label={`Show ${getStationDisplayName(station)} on map`}
        disabled={!canShowOnMap}
        onClick={() => onSelect(station.id)}
      >
        Show on map
      </Button>
      {!canShowOnMap && <Text className={styles.hint}>Map location unavailable.</Text>}
    </Paper>
  );
}
