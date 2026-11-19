# Worker Protocol (draft)

How the web app, the coordinator, and the workers talk to each other. Everything is JSON over HTTP. **This is a draft for Samuel and the team to review**, and nothing uses it yet.

The types are in `src/lib/workerProtocol.ts`, and the batching function is in `src/lib/batching.ts`.

## Flow

1. The web app gets nearby stations and sends them to the coordinator with `POST /jobs`.
2. The coordinator creates a job ID, checks which workers are up with `GET /health`, and splits the stations with `createBatches()`.
3. The coordinator sends each worker its batch with `POST /process`, all at the same time.
4. Each worker adds distance, price, and fuel compatibility, then returns its stations.
5. The coordinator combines the results, removes duplicates, filters, ranks, and replies to the web app.

## Web app → coordinator: `POST /jobs`

Request:

```json
{
  "user": { "lat": 30.5044, "lng": -90.4612 },
  "requiredFuel": "regular",
  "stations": [
    {
      "id": "node/1057358647",
      "name": "Chevron",
      "brand": "Chevron",
      "lat": 30.4741,
      "lng": -90.8627,
      "address": null,
      "fuels": []
    }
  ]
}
```

Response:

```json
{
  "jobId": "job-abc123",
  "results": [],
  "failedBatchIds": [],
  "totalMs": 412
}
```

`results` uses the same station format the workers return, below. If `failedBatchIds` isn't empty, the results are missing some stations, and the app can still show what it has.

## Coordinator → worker: `POST /process`

Request:

```json
{
  "jobId": "job-abc123",
  "batchId": "job-abc123-0",
  "user": { "lat": 30.5044, "lng": -90.4612 },
  "requiredFuel": "regular",
  "stations": []
}
```

`stations` uses the same format as `POST /jobs`.

Success (HTTP 200):

```json
{
  "status": "ok",
  "jobId": "job-abc123",
  "batchId": "job-abc123-0",
  "workerId": "worker-1",
  "results": [
    {
      "id": "node/1057358647",
      "name": "Chevron",
      "brand": "Chevron",
      "lat": 30.4741,
      "lng": -90.8627,
      "address": null,
      "fuels": [],
      "distanceMiles": 21.7,
      "price": 3.09,
      "compatibility": "unknown"
    }
  ],
  "processingMs": 38
}
```

Failure (HTTP 500):

```json
{
  "status": "error",
  "jobId": "job-abc123",
  "batchId": "job-abc123-0",
  "workerId": "worker-1",
  "error": "Could not read prices."
}
```

## Coordinator → worker: `GET /health`

```json
{ "status": "ok", "workerId": "worker-1" }
```

A worker that doesn't answer isn't available.

## Rules

- **Compatibility:** only filter out stations marked `"no"`. Most OpenStreetMap stations don't list their fuels, so filtering out `"unknown"` too would remove almost everything.
- **Missing prices:** `price` is `null` when there's no price. Don't use `0`, or those stations will rank as the cheapest.
- **Retries:** a failed batch keeps its `batchId` when it's sent to another worker. A slow worker could still answer after that, so the coordinator keeps one result per `batchId` and removes duplicate stations by `id`.
- **Batching:** `createBatches()` makes sizes differ by at most one and never makes an empty batch. With 0 stations it returns no batches, and with 0 workers it throws an error.

## Questions for the team

1. **Samuel:** should workers also return a ranking score? This draft leaves ranking to the coordinator, since the algorithm isn't defined yet.
2. **Jelon:** does the vehicle's fuel type map to `requiredFuel` this way? FuelEconomy.gov returns values like `Regular Gasoline`. Electric vehicles and E85 don't fit these four grades, so what should the app do for them?
3. **Jelon:** where do workers read prices from? The project document says crowdsourced prices in Supabase.
4. **Samuel:** should workers require a shared secret? Otherwise anyone who finds the EC2 address can call them.
