"use client";

import { useEffect, useState } from "react";
import { Select, Stack, Text } from "@mantine/core";
import {
  getMakes,
  getModels,
  getOptions,
  getVehicle,
  getYears,
  type MenuItem,
  type Vehicle,
} from "@/lib/fuelEconomy";

// Year -> Make -> Model -> Engine/Trim dropdowns. Each one unlocks after the
// one before it is picked, and changing one clears everything after it.
export default function VehicleSelect() {
  const [years, setYears] = useState<MenuItem[]>([]);
  const [makes, setMakes] = useState<MenuItem[]>([]);
  const [models, setModels] = useState<MenuItem[]>([]);
  const [options, setOptions] = useState<MenuItem[]>([]);

  const [year, setYear] = useState<string | null>(null);
  const [make, setMake] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getYears()
      .then(setYears)
      .catch(() => setError("Couldn't load vehicle years."));
  }, []);

  function handleYear(value: string | null) {
    setYear(value);
    setMake(null);
    setModel(null);
    setOptionId(null);
    setMakes([]);
    setModels([]);
    setOptions([]);
    setVehicle(null);
    if (value) {
      getMakes(value)
        .then(setMakes)
        .catch(() => setError("Couldn't load makes."));
    }
  }

  function handleMake(value: string | null) {
    setMake(value);
    setModel(null);
    setOptionId(null);
    setModels([]);
    setOptions([]);
    setVehicle(null);
    if (year && value) {
      getModels(year, value)
        .then(setModels)
        .catch(() => setError("Couldn't load models."));
    }
  }

  function handleModel(value: string | null) {
    setModel(value);
    setOptionId(null);
    setOptions([]);
    setVehicle(null);
    if (year && make && value) {
      getOptions(year, make, value)
        .then(setOptions)
        .catch(() => setError("Couldn't load engine options."));
    }
  }

  function handleOption(value: string | null) {
    setOptionId(value);
    setVehicle(null);
    if (value) {
      getVehicle(value)
        .then(setVehicle)
        .catch(() => setError("Couldn't load vehicle details."));
    }
  }

  const toData = (items: MenuItem[]) =>
    items.map((item) => ({ value: item.value, label: item.text }));

  return (
    <Stack gap="sm">
      <Select
        label="Year"
        placeholder="Pick a year"
        data={toData(years)}
        value={year}
        onChange={handleYear}
        searchable
      />
      <Select
        label="Make"
        placeholder="Pick a make"
        data={toData(makes)}
        value={make}
        onChange={handleMake}
        disabled={!year}
        searchable
      />
      <Select
        label="Model"
        placeholder="Pick a model"
        data={toData(models)}
        value={model}
        onChange={handleModel}
        disabled={!make}
        searchable
      />
      <Select
        label="Engine / Trim"
        placeholder="Pick an option"
        data={toData(options)}
        value={optionId}
        onChange={handleOption}
        disabled={!model}
      />

      {error && <Text c="red">{error}</Text>}

      {vehicle && (
        <Text>
          {vehicle.year} {vehicle.make} {vehicle.model} uses: {vehicle.fuelType}
        </Text>
      )}
    </Stack>
  );
}
