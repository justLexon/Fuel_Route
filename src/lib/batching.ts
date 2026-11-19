import type { Station } from "./stations";

// One worker's share of a job.
export type Batch = {
  batchId: string;
  jobId: string;
  workerId: string;
  stations: Station[];
};

// Splits stations across workers so batch sizes differ by at most one.
// Workers are skipped when there are fewer stations than workers, so a batch
// is never empty.
export function createBatches(
  jobId: string,
  stations: Station[],
  workerIds: string[]
): Batch[] {
  if (workerIds.length === 0) {
    throw new Error("No available workers.");
  }

  const batchCount = Math.min(stations.length, workerIds.length);
  const batches: Batch[] = [];
  let start = 0;

  for (let i = 0; i < batchCount; i++) {
    // The first (remainder) batches each take one extra station.
    const size =
      Math.floor(stations.length / batchCount) +
      (i < stations.length % batchCount ? 1 : 0);

    batches.push({
      batchId: `${jobId}-${i}`,
      jobId,
      workerId: workerIds[i],
      stations: stations.slice(start, start + size),
    });
    start += size;
  }

  return batches;
}
