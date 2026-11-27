import { Button, Paper, SimpleGrid, Text, Title } from "@mantine/core";
import type { LatLng } from "@/lib/location";
import { GAS_FUEL_LABELS, GAS_FUELS, hasPrices, type GasFuel, type Station } from "@/lib/stations";
import { straightLineMiles } from "@/lib/distance";
import { getStationDisplayName } from "@/lib/stationDisplay";
import styles from "./Dashboard.module.css";
import { hasStationCoordinates } from "@/lib/stationSelection";

export default function StationCard({ station, center, highlightFuel = null, fillUpCost = null, onSelect }: {
  station: Station;
  center: LatLng;
  highlightFuel?: GasFuel | null; // the vehicle's fuel, shown in the accent color
  fillUpCost?: number | null; // from ranking: fill-up plus the drive there and back
  onSelect: (stationId: string) => void;
}) {
  const distance = straightLineMiles(center, station);
  const canShowOnMap = hasStationCoordinates(station);
  // Addresses missing from OSM are looked up by StationResults before the card shows.
  const address = station.address?.trim();

  return (
    <Paper component="article" className={styles.stationCard}>
      <div className={styles.stationHeader}>
        <Title order={3} className={styles.stationName}>
          {getStationDisplayName(station)}
        </Title>
        {distance !== null && (
          <Text className={styles.stationDistance}>
            {distance > 0 && distance < 0.1 ? "< 0.1" : distance.toFixed(1)} mi
          </Text>
        )}
      </div>
      {address && <Text className={styles.stationAddress}>{address}</Text>}
      {hasPrices(station) ? (
        <SimpleGrid cols={3} spacing="xs" verticalSpacing={4} className={styles.stationPrices}>
          {GAS_FUELS.filter((fuel) => station.prices?.[fuel]).map((fuel) => (
            <div key={fuel} className={fuel === highlightFuel ? styles.yourFuel : undefined}>
              <Text size="xs" c="dimmed">
                {GAS_FUEL_LABELS[fuel]}
                {station.prices?.[fuel]?.cash && " · cash"}
              </Text>
              <Text fw={700}>${station.prices?.[fuel]?.price.toFixed(2)}</Text>
            </div>
          ))}
        </SimpleGrid>
      ) : (
        <Text className={`${styles.hint} ${styles.stationPrices}`}>No prices</Text>
      )}
      {fillUpCost !== null && (
        <Text className={styles.fillUpCost}>
          Fill-up + drive: <strong>${fillUpCost.toFixed(2)}</strong>
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
