"use client";

import { useState } from "react";
import { Button, Group, Modal, Text } from "@mantine/core";
import type { Vehicle } from "@/lib/fuelEconomy";
import VehicleSelect from "./VehicleSelect";

// "Select vehicle" button that opens the Year/Make/Model/Engine dropdowns in a
// modal, then shows the chosen vehicle on the main page.
export default function VehiclePicker() {
  const [opened, setOpened] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);

  return (
    <>
      <Group>
        <Button onClick={() => setOpened(true)}>
          {vehicle ? "Change vehicle" : "Select vehicle"}
        </Button>
        {vehicle && (
          <Text>
            {vehicle.year} {vehicle.make} {vehicle.model} ({vehicle.fuelType})
          </Text>
        )}
      </Group>

      {/* keepMounted so the dropdowns remember their picks when reopened */}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Select vehicle"
        keepMounted
      >
        <VehicleSelect onSelect={setVehicle} />
        <Button mt="md" fullWidth disabled={!vehicle} onClick={() => setOpened(false)}>
          Done
        </Button>
      </Modal>
    </>
  );
}
