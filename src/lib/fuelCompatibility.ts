import type {
  FuelCompatibility,
  FuelType,
  KnownFuelType,
} from "./processing";

export function normalizeVehicleFuel(
  fuel: string | null | undefined
): FuelType {
  const value = fuel?.trim().toLowerCase();
  if (!value) return "unknown";

  if (value.includes("diesel")) return "diesel";
  if (value.includes("e85") || value.includes("ethanol")) return "e85";
  if (
    value.includes("compressed natural gas") ||
    value.includes("natural gas") ||
    value === "cng"
  ) {
    return "cng";
  }
  if (value.includes("propane") || value === "lpg") return "lpg";
  if (value.includes("hydrogen")) return "hydrogen";
  if (value.includes("premium")) return "premium";
  if (value.includes("midgrade")) return "midgrade";
  if (value.includes("regular") || value.includes("gasoline")) {
    return "regular";
  }
  if (value.includes("electric")) return "electric";

  return "unknown";
}

export function normalizeStationFuelTag(
  tag: string
): KnownFuelType | null {
  const value = tag.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!value) return null;

  const octaneMatch = /^octane_(\d+)$/.exec(value);
  if (octaneMatch) {
    const octane = Number(octaneMatch[1]);
    if (octane <= 87) return "regular";
    if (octane <= 90) return "midgrade";
    return "premium";
  }

  if (value.includes("diesel")) return "diesel";

  switch (value) {
    case "regular":
    case "gasoline":
    case "petrol":
    case "e5":
    case "e10":
      return "regular";
    case "midgrade":
      return "midgrade";
    case "premium":
      return "premium";
    case "e85":
      return "e85";
    case "cng":
    case "compressed_natural_gas":
      return "cng";
    case "lpg":
    case "autogas":
    case "propane":
      return "lpg";
    case "electric":
    case "electricity":
      return "electric";
    case "hydrogen":
      return "hydrogen";
    default:
      return null;
  }
}

function acceptableFuelTypes(
  requiredFuel: FuelType
): readonly KnownFuelType[] {
  switch (requiredFuel) {
    case "regular":
      return ["regular", "midgrade", "premium"];
    case "midgrade":
      return ["midgrade", "premium"];
    case "unknown":
      return [];
    default:
      return [requiredFuel];
  }
}

function normalizeFuelTags(
  tags: readonly string[]
): Set<KnownFuelType> {
  const fuels = new Set<KnownFuelType>();

  for (const tag of tags) {
    const fuel = normalizeStationFuelTag(tag);
    if (fuel) fuels.add(fuel);
  }

  return fuels;
}

export function determineFuelCompatibility(
  requiredFuel: FuelType,
  availableTags: readonly string[],
  unavailableTags: readonly string[] = []
): FuelCompatibility {
  const acceptable = acceptableFuelTypes(requiredFuel);
  if (acceptable.length === 0) return "unknown";

  const available = normalizeFuelTags(availableTags);
  if (acceptable.some((fuel) => available.has(fuel))) {
    return "compatible";
  }

  const unavailable = normalizeFuelTags(unavailableTags);
  if (acceptable.every((fuel) => unavailable.has(fuel))) {
    return "incompatible";
  }

  return "unknown";
}