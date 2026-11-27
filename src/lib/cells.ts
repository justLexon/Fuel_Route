// Grid cells for the shared cache. Searches are snapped to fixed cells, so users
// a few blocks apart (or typing the same place differently) share one cache
// entry. Each cell's data is loaded around the cell's center with a radius large
// enough to cover a full search from anywhere in the cell.

import type { LatLng } from "./location";

export const CELL_DEGREES = 0.05; // about 3.5 × 3 miles
const MILES_PER_DEGREE_LAT = 69.0;
// From a cell's center to its corner is under 2.5 miles (0.025° each way).
export const CELL_MARGIN_MILES = 2.5;

export type Cell = {
  key: string; // southwest corner, e.g. "30.20,-92.05"
  center: LatLng;
};

export function cellFor({ lat, lng }: LatLng): Cell {
  // The tiny epsilon keeps 30.2 / 0.05 = 603.999… in cell 604.
  const south = Math.floor(lat / CELL_DEGREES + 1e-9) * CELL_DEGREES;
  const west = Math.floor(lng / CELL_DEGREES + 1e-9) * CELL_DEGREES;
  return {
    key: `${south.toFixed(2)},${west.toFixed(2)}`,
    center: { lat: round(south + CELL_DEGREES / 2), lng: round(west + CELL_DEGREES / 2) },
  };
}

// The radius a cell's data is loaded for: the search radius plus the margin.
export function cellRadiusMiles(searchRadiusMiles: number) {
  return searchRadiusMiles + CELL_MARGIN_MILES;
}

// A box around a circle, for `lat between … and lng between …` queries.
export function boundsAround({ lat, lng }: LatLng, radiusMiles: number) {
  const dLat = radiusMiles / MILES_PER_DEGREE_LAT;
  const dLng = radiusMiles / (MILES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Key for one point (~1 m), used for looked-up addresses.
export function pointKey({ lat, lng }: LatLng) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;
