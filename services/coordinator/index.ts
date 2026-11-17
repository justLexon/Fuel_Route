import { createCoordinatorServer } from "./server";
import { parseWorkerUrls } from "./workers";

const DEFAULT_PORT = 4000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_WORKER_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function readPositiveInteger(
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const value = process.env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ` +
        `1 and ${maximum}.`
    );
  }

  return parsed;
}

function startCoordinator() {
  try {
    const port = readPositiveInteger(
      "PORT",
      DEFAULT_PORT,
      65_535
    );

    const host =
      process.env.HOST?.trim() || DEFAULT_HOST;

    const healthTimeoutMs = readPositiveInteger(
      "WORKER_HEALTH_TIMEOUT_MS",
      DEFAULT_HEALTH_TIMEOUT_MS
    );

    const workerTimeoutMs = readPositiveInteger(
      "WORKER_REQUEST_TIMEOUT_MS",
      DEFAULT_WORKER_TIMEOUT_MS
    );

    const workerUrls = parseWorkerUrls(
      process.env.WORKER_URLS
    );

    const server = createCoordinatorServer({
      workerUrls,
      healthTimeoutMs,
      workerTimeoutMs,
    });

    let shuttingDown = false;

    server.listen(port, host, () => {
      console.log(
        `Coordinator listening at ` +
          `http://${host}:${port}`
      );

      console.log(
        `Configured ${workerUrls.length} worker(s).`
      );
    });

    server.on("error", (error) => {
      console.error(
        "Coordinator server error:",
        error
      );
    });

    function shutDown(signal: string) {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;

      console.log(
        `Received ${signal}; ` +
          `shutting down coordinator.`
      );

      const timeout = setTimeout(() => {
        console.error(
          "Coordinator shutdown timed out."
        );
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);

      timeout.unref();

      server.close((error) => {
        clearTimeout(timeout);

        if (error) {
          console.error(
            "Coordinator shutdown failed:",
            error
          );
          process.exit(1);
        }

        console.log("Coordinator stopped.");
        process.exit(0);
      });
    }

    process.once(
      "SIGINT",
      () => shutDown("SIGINT")
    );

    process.once(
      "SIGTERM",
      () => shutDown("SIGTERM")
    );
  } catch (error) {
    console.error(
      "Coordinator failed to start:",
      error instanceof Error
        ? error.message
        : error
    );

    process.exit(1);
  }
}

startCoordinator();