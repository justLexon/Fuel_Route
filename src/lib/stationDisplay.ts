import type { Station } from "./stations";

// The API may already have substituted its generic name; prefer a real brand.
export function getStationDisplayName(station: Partial<Pick<Station, "name" | "brand">>): string {
  const name = station.name?.trim();
  const brand = station.brand?.trim();

  if (name && name !== "Gas station") return name;
  return brand || "Gas station";
}
