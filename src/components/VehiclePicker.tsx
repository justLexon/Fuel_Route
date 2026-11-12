"use client";

import { useState } from "react";
import { Button, Modal, Stack, Text } from "@mantine/core";
import type { Vehicle } from "@/lib/fuelEconomy";
import VehicleSelect from "./VehicleSelect";
import styles from "./Dashboard.module.css";

// "Select vehicle" button that opens the Year/Make/Model/Engine dropdowns in a
// modal, then shows the chosen vehicle on the main page.
export default function VehiclePicker() {
  const [opened, setOpened] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);

  return (
    <>
      <Stack gap="sm">
        <svg className={styles.vehicleIllustration} viewBox="0 0 280 100" aria-hidden="true" focusable="false">
          <path d="M30 66L42 41L88 35L115 15H184L214 39L247 47L258 70H245M63 70H213M31 70H21V54L42 41M101 35L121 23H179L194 36Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="48" cy="72" r="15" fill="none" stroke="currentColor" strokeWidth="4" />
          <circle cx="230" cy="72" r="15" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M78 47H197M139 24V36M250 53H231" stroke="currentColor" strokeWidth="3" />
        </svg>
        {vehicle ? (
          <div className={styles.vehicleDetails}>
            <Text className={styles.vehicleName}>
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Selected vehicle"}
            </Text>
            <Text className={vehicle.fuelType?.trim() ? styles.vehicleFuel : styles.vehicleHint}>
              {vehicle.fuelType?.trim() ? `Fuel type: ${vehicle.fuelType}` : "Fuel information unavailable"}
            </Text>
          </div>
        ) : (
          <Text className={styles.vehicleHint}>Select your vehicle to see its fuel information.</Text>
        )}
        <Button fullWidth className={styles.panelAction} onClick={() => setOpened(true)}>
          {vehicle ? "Change vehicle" : "Select vehicle"}
        </Button>
      </Stack>

      {/* keepMounted so the dropdowns remember their picks when reopened */}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Select vehicle"
        keepMounted
        padding="lg"
        radius="lg"
        classNames={{
          content: styles.vehicleModal,
          header: styles.vehicleModalHeader,
          title: styles.vehicleModalTitle,
          close: styles.vehicleModalClose,
        }}
      >
        <VehicleSelect onSelect={setVehicle} />
        <Button mt="lg" fullWidth className={styles.panelAction} disabled={!vehicle} onClick={() => setOpened(false)}>
          Done
        </Button>
      </Modal>
    </>
  );
}
