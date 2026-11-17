import {
  runBenchmark,
  type BenchmarkStatistics,
} from "./runBenchmark";

function readNumber(
  name: string,
  fallback: number
): number {
  const value = process.env[name]?.trim();

  if (!value) {
    return fallback;
  }

  return Number(value);
}

function formatStatistics(
  label: string,
  statistics: BenchmarkStatistics
) {
  console.log(
    `${label}: average ${statistics.averageMs} ms, ` +
      `median ${statistics.medianMs} ms, ` +
      `min ${statistics.minimumMs} ms, ` +
      `max ${statistics.maximumMs} ms, ` +
      `p95 ${statistics.p95Ms} ms`
  );
}

function formatSpeedup(
  value: number | null
): string {
  return value === null
    ? "not available"
    : `${value}x`;
}

async function main() {
  try {
    const coordinatorUrl =
      process.env.COORDINATOR_URL?.trim() ||
      "http://127.0.0.1:4000";

    const stationCount = readNumber(
      "BENCHMARK_STATIONS",
      500
    );

    const iterations = readNumber(
      "BENCHMARK_ITERATIONS",
      10
    );

    const warmupIterations = readNumber(
      "BENCHMARK_WARMUPS",
      1
    );

    console.log(
      `Benchmarking ${stationCount} stations, ` +
        `${iterations} measured iteration(s), ` +
        `${warmupIterations} warmup iteration(s).`
    );

    const report = await runBenchmark({
      coordinatorUrl,
      stationCount,
      iterations,
      warmupIterations,
    });

    console.log("");
    console.log("Client end-to-end timing");
    formatStatistics(
      "Single worker",
      report.single.client
    );
    formatStatistics(
      "Distributed",
      report.distributed.client
    );

    console.log("");
    console.log("Coordinator timing");
    formatStatistics(
      "Single worker",
      report.single.coordinator
    );
    formatStatistics(
      "Distributed",
      report.distributed.coordinator
    );

    console.log("");
    console.log(
      `Client speedup: ` +
        `${formatSpeedup(report.clientSpeedup)}`
    );

    console.log(
      `Coordinator speedup: ` +
        `${formatSpeedup(
          report.coordinatorSpeedup
        )}`
    );

    console.log("");
    console.log("Complete JSON report");
    console.log(
      JSON.stringify(report, null, 2)
    );
  } catch (error) {
    console.error(
      "Benchmark failed:",
      error instanceof Error
        ? error.message
        : error
    );

    process.exit(1);
  }
}

void main();