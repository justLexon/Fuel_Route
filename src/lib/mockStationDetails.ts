// TEMPORARY fake data for the station card until real prices (Jelon) and
// distance (Arielle) are ready. Values are generated from the station id,
// so the same station always shows the same numbers.

export type StationDetails = {
  prices: { regular: number; midgrade: number; premium: number; diesel: number };
  distanceMiles: number;
  open24Hours: boolean;
};

// Turns a string into a repeatable number between 0 and 1.
function seededRandom(seed: string, salt: number) {
  let hash = salt;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

export function getMockStationDetails(stationId: string): StationDetails {
  const regular = 2.79 + seededRandom(stationId, 1) * 0.6;
  return {
    prices: {
      regular,
      midgrade: regular + 0.4,
      premium: regular + 0.8,
      diesel: regular + 0.5 + seededRandom(stationId, 2) * 0.3,
    },
    distanceMiles: 0.5 + seededRandom(stationId, 3) * 29.5,
    open24Hours: seededRandom(stationId, 4) > 0.5,
  };
}
