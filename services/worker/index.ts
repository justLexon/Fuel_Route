import { createWorkerServer } from "./server";

const DEFAULT_PORT = 4001;
const DEFAULT_HOST = "0.0.0.0";
const SHUTDOWN_TIMEOUT_MS = 10_000;

function getPort(): number {
  const value = process.env.PORT?.trim();

  if (!value) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "PORT must be an integer between 1 and 65535."
    );
  }

  return port;
}

const port = getPort();
const host =
  process.env.HOST?.trim() || DEFAULT_HOST;
const workerId =
  process.env.WORKER_ID?.trim() || "worker-local";

const server = createWorkerServer({ workerId });
let shuttingDown = false;

server.listen(port, host, () => {
  console.log(
    `Worker "${workerId}" listening at http://${host}:${port}`
  );
});

function shutDown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}; shutting down worker.`);

  const timeout = setTimeout(() => {
    console.error("Worker shutdown timed out.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  timeout.unref();

  server.close((error) => {
    clearTimeout(timeout);

    if (error) {
      console.error("Worker shutdown failed:", error);
      process.exit(1);
    }

    console.log("Worker stopped.");
    process.exit(0);
  });
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));