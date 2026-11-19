import { Group, Text, Title } from "@mantine/core";
import styles from "./Dashboard.module.css";

export default function DashboardHeader() {
  return (
    <>
      <header className={styles.header}>
        <Group gap="sm" aria-label="Fuel Route">
          <span className={styles.logo} aria-hidden="true">F↗</span>
          <Text component="span" className={styles.brand}>
            Fuel<span className={styles.brandAccent}>Route</span>
          </Text>
        </Group>
      </header>
      <div className={styles.intro}>
        <Title order={1} className={styles.headline}>
          Your next stop, simplified.
        </Title>
        <Text className={styles.description}>
          Choose a vehicle and location to explore nearby stations.
        </Text>
      </div>
    </>
  );
}
