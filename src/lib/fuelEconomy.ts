// Small client for the FuelEconomy.gov vehicle API.
// Docs: https://www.fueleconomy.gov/feg/ws/

const BASE_URL = "https://www.fueleconomy.gov/ws/rest/vehicle";

export type MenuItem = { text: string; value: string };

export type Vehicle = {
  id: string;
  year: string;
  make: string;
  model: string;
  fuelType: string; // e.g. "Regular Gasoline", "Premium Gasoline", "Diesel", "Electricity"
};

async function getJson(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`FuelEconomy.gov request failed: ${res.status}`);
  return res.json();
}

// The API returns `null` for no results and a single object (not an array)
// when there's only one result, so normalize to an array.
async function getMenu(path: string): Promise<MenuItem[]> {
  const data = await getJson(path);
  if (!data?.menuItem) return [];
  return Array.isArray(data.menuItem) ? data.menuItem : [data.menuItem];
}

export function getYears() {
  return getMenu("/menu/year");
}

export function getMakes(year: string) {
  return getMenu(`/menu/make?year=${encodeURIComponent(year)}`);
}

export function getModels(year: string, make: string) {
  return getMenu(
    `/menu/model?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`
  );
}

// Each option's `value` is the vehicle ID used by getVehicle().
export function getOptions(year: string, make: string, model: string) {
  return getMenu(
    `/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`
  );
}

export async function getVehicle(id: string): Promise<Vehicle> {
  const data = await getJson(`/${encodeURIComponent(id)}`);
  return {
    id,
    year: data.year,
    make: data.make,
    model: data.model,
    fuelType: data.fuelType1,
  };
}
