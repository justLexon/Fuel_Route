# Price Service on AWS EC2

How to move the GasBuddy price lookup off a laptop and onto an AWS EC2 server, so the hosted Fuel Route app can get prices without anyone's computer being on.

**Status:** plan. Nothing here is built yet. Do [Step 4](#step-4-test-whether-gasbuddy-works-from-aws) before anything else, because it decides whether the rest is worth doing.
**Related:** [supabase-cache.md](supabase-cache.md) is the shared cache in front of this service. Together they keep GasBuddy lookups rare.

## Why this is needed

Today, `src/lib/gasbuddy.ts` opens Chrome on whatever machine runs Fuel Route, loads GasBuddy's price map once per fuel type, and reads the prices the map downloads. That works on a laptop, but not on Vercel, which has no Chrome and no screen. On Vercel, stations load without prices.

The fix is a small **price service** on an EC2 machine that has Chrome:

```
Browser ──> Fuel Route on Vercel ──> Supabase: prices for this area < 30 min old?
                 │                          │ yes → done, no GasBuddy lookup
                 │                          │ no  ↓
                 │          GET /prices?lat=..&lng=.. ──> Price service on EC2
                 │                                              │
                 │                                       Chrome (on a virtual screen)
                 │                                              │
                 └── saves to Supabase, matches <── JSON ───────┘ GasBuddy price map
```

Fuel Route keeps doing everything else: Overpass, the Supabase cache, matching prices to stations, and the UI. Only "open Chrome and read GasBuddy" moves to EC2.

Three facts from testing shape the design:

- **GasBuddy blocks hidden (headless) Chrome** with a Cloudflare check ("Just a moment..."). Chrome has to run with a window. A server has no screen, so we give it a virtual one with **Xvfb**. Chrome can't tell the difference.
- **The map only loads its data when it's on screen**, and one map view covers about 25 × 12 miles at zoom 12. Zooming out makes GasBuddy drop stations.
- **The map shows one fuel type at a time**, picked with the `fuel` URL parameter: `1` regular, `2` midgrade, `3` premium, `4` diesel, `5` E85. All five prices for one map view take five page loads.

## Keeping GasBuddy lookups low

The service must not open a pile of tabs for every user search. Four layers prevent that:

| Layer | Where | What it does |
|---|---|---|
| **Supabase price cache** | Vercel | Prices are stored by grid cell for 30 minutes and shared by all users. **Most searches never reach EC2.** See [supabase-cache.md](supabase-cache.md). |
| **Cell claim** | Vercel + Supabase | When a cell expires, only one request gets to refresh it. Others wait a few seconds and read the result. |
| **Tab limit** | EC2 | At most `MAX_TABS` pages load at once (default 5), however many requests arrive. The rest wait their turn. |
| **Short cache + duplicate check** | EC2 | The same map view requested twice within 5 minutes, or while it's still loading, is only loaded once. |

The service also keeps one browser running and reuses its tabs, instead of starting Chrome and opening new tabs for each request. That saves several seconds per request, and it keeps GasBuddy's and Cloudflare's cookies between loads.

**Worst-case load:** GasBuddy is read at most once per price cell every 30 minutes, no matter how many people use the app. One cell is 5 page loads (one per fuel). A 10-mile search touches 4–6 cells, so the **very first search** in an area costs 20–30 page loads and takes 10–20 seconds. After that, searches there are instant until the prices expire. **Search the demo area once before presenting** so it's already loaded.

## Before you start

- **Cost:** a `t3.medium` costs about $0.04/hour, roughly $30/month if left on. **Stop the instance when you're not using it**: EC2 → Instances → select it → Instance state → Stop. A stopped instance only costs a little for its disk.
- **Keep it low-volume.** This reads GasBuddy's website automatically, which their terms don't allow. It's for this class demo, which our professor suggested. Don't make it public, don't run it constantly, and don't build anything on top of it beyond the demo.
- **Have a backup for the demo.** If AWS gets blocked (Step 4), use a price snapshot stored in Supabase instead.

## Step 1: Launch the EC2 instance

In the AWS Console, go to **EC2 → Instances → Launch instances**:

| Setting | Value |
| --- | --- |
| Name | `fuel-route-prices` |
| AMI | **Ubuntu Server 24.04 LTS** (64-bit **x86**, not Arm, because Google Chrome has no Arm Linux build) |
| Instance type | **t3.medium** (4 GB RAM) for 5 tabs at once. A `t3.small` (2 GB) can work with `MAX_TABS=2`, but it's slower. `t3.micro` runs out of memory. |
| Key pair | Create new → name `fuel-route` → type RSA → format `.pem`. It downloads once, so keep it safe. |
| Storage | 16 GB gp3 |

Under **Network settings → Edit**, set up the security group:

| Type | Port | Source | Why |
| --- | --- | --- | --- |
| SSH | 22 | **My IP** | So you can log in |
| Custom TCP | 8080 | Anywhere (0.0.0.0/0) | So Vercel can reach the price service. Vercel has no fixed IP to allow, so the secret header from Step 5 protects it instead. |

Click **Launch instance**.

**Give it a fixed IP:** EC2 → **Elastic IPs** → Allocate → then Actions → **Associate** with `fuel-route-prices`. Without this, the IP changes every time the instance stops and starts, and Fuel Route would lose track of it. (An Elastic IP is free while it's attached to a running instance, and costs a little while the instance is stopped.)

## Step 2: Log in with SSH

On Windows, first lock down the key file so SSH will accept it. Run this in PowerShell, in the folder with the `.pem`:

```powershell
icacls fuel-route.pem /inheritance:r
icacls fuel-route.pem /grant:r "$($env:USERNAME):(R)"
```

Then connect, using your Elastic IP:

```powershell
ssh -i fuel-route.pem ubuntu@<ELASTIC-IP>
```

Everything below runs **on the EC2 machine**.

## Step 3: Install Node, Xvfb, and Chrome

```bash
# System updates
sudo apt update && sudo apt upgrade -y

# Node.js 22, and Xvfb (the virtual screen)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs xvfb

# Project folder
mkdir ~/price-service && cd ~/price-service
npm init -y
npm pkg set type=module
npm install playwright

# Real Google Chrome, the same browser that works on our laptops,
# plus the Linux libraries it needs.
npx playwright install --with-deps chrome

# Playwright's own Chromium, as a backup to test in Step 4.
npx playwright install --with-deps chromium
```

Check it worked: `node -v` should print `v22.x`, `google-chrome --version` should print a version, and `xvfb-run --help` should print usage text.

**About the virtual screen:** every command below starts with `xvfb-run -a -s "-screen 0 1920x1440x24"`. That creates a 1920 × 1440 virtual screen just for that command. Chrome opens its window there with `headless: false`, exactly like on a laptop. Xvfb's default screen is only 640 × 480, which is why the size is set.

## Step 4: Test whether GasBuddy works from AWS

**This step decides everything.** Cloudflare is often stricter with data-center IPs, like AWS's, than with home internet. If GasBuddy blocks this machine, stop here and use the Supabase snapshot plan instead.

Create `~/price-service/test-gasbuddy.mjs`:

```js
// Usage: node test-gasbuddy.mjs [chrome|chromium]
import { chromium } from "playwright";

const browserName = process.argv[2] ?? "chrome";
const browser = await chromium.launch({
  headless: false,
  channel: browserName === "chrome" ? "chrome" : undefined,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const mapResponse = page.waitForResponse(
  (res) => res.url().endsWith("/gaspricemap/map") && res.request().method() === "POST",
  { timeout: 45_000 }
);
mapResponse.catch(() => {});
await page.goto("https://www.gasbuddy.com/gaspricemap?lat=30.2020&lng=-92.0773&z=12&fuel=1", {
  waitUntil: "commit",
});
console.log(browserName, "title:", await page.title());

try {
  const data = await (await mapResponse).json();
  const all = [...data.primaryStations, ...data.secondaryStations];
  console.log("stations:", all.length, "with price:", all.filter((s) => s.price !== "--").length);
} catch (error) {
  console.log("no map data:", error.message);
  await page.screenshot({ path: `test-${browserName}.png` });
  console.log(`saved test-${browserName}.png. Copy it to your laptop to see what the page showed.`);
}
await browser.close();
```

Run it on the virtual screen with real Chrome first, then with Chromium:

```bash
xvfb-run -a -s "-screen 0 1920x1440x24" node test-gasbuddy.mjs chrome
xvfb-run -a -s "-screen 0 1920x1440x24" node test-gasbuddy.mjs chromium
```

| Output | Meaning | Next |
| --- | --- | --- |
| `stations: 140 with price: 73` (any numbers above 0) | It works from AWS with that browser | Continue to Step 5, using a browser that worked |
| Works with `chrome` only | Cloudflare treats Chromium differently | Keep the default `BROWSER_CHANNEL=chrome` |
| Title `Just a moment...`, or `no map data`, with both | Cloudflare is blocking this machine | **Stop.** Use the Supabase snapshot plan. Don't try to get around the block. |

Run it a few times, a minute apart. A block sometimes shows up only after the first request.

To see a screenshot, copy it to your laptop by running this **on your laptop**:

```powershell
scp -i fuel-route.pem ubuntu@<ELASTIC-IP>:~/price-service/test-chrome.png .
```

## Step 5: Write the price service

Create `~/price-service/price-server.mjs`. It loads one map view for all five fuels and returns every station with its prices. Compared with `src/lib/gasbuddy.ts`:

- It **launches the browser once** and reuses its tabs, instead of starting Chrome for every request.
- It loads **at most `MAX_TABS` pages at once**. Extra requests wait instead of opening more tabs.
- It loads the **same view only once** if two requests ask for it at the same time, and caches it for 5 minutes.
- It loads **one map view per request**. Fuel Route asks for the views it needs (one per price cell).
- It requires a **secret header**, so only Fuel Route can use it.

```js
// Price service: GET /prices?lat=30.20&lng=-92.07
// Loads one GasBuddy map view (about 25 x 12 miles at zoom 12) centered on lat/lng,
// once per fuel type, and returns every station in it that has a price:
//   { stations: [{ id, lat, lng, prices: { regular: { price, cash }, ... } }],
//     failedFuels: [] }   <- fuels whose page didn't load this time
// (The map data also has `brand_id` and `tme`, but they're always 0 and "", so they're skipped.)
// Environment:
//   PRICE_SECRET    required; callers send it in the x-price-secret header
//   MAX_TABS        pages loading at once (default 5)
//   BROWSER_CHANNEL "chrome" (default, Google Chrome) or "chromium" (Playwright's own)
//   PORT            default 8080

import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.PRICE_SECRET;
const MAX_TABS = Number(process.env.MAX_TABS ?? 5);
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL ?? "chrome";
const ZOOM = 12;
const MAP_TIMEOUT_MS = 45_000;
const CACHE_MS = 5 * 60_000; // a complete view
const PARTIAL_CACHE_MS = 60_000; // a view where some fuels failed
const FUEL_IDS = { regular: 1, midgrade: 2, premium: 3, diesel: 4, e85: 5 };

if (!SECRET) {
  console.error("Set PRICE_SECRET before starting.");
  process.exit(1);
}

// ---- One browser for the whole server ----
// One shared context keeps GasBuddy's and Cloudflare's cookies, and the browser
// cache, between requests. If Chrome crashes, the next request starts it again.
let contextPromise = null;
let idleTabs = [];

function getContext() {
  if (!contextPromise) {
    const promise = chromium
      .launch({ headless: false, channel: BROWSER_CHANNEL === "chromium" ? undefined : BROWSER_CHANNEL })
      .then((browser) => {
        browser.on("disconnected", () => {
          contextPromise = null;
          idleTabs = [];
        });
        // Tall window: the map only loads its data while it's on screen.
        return browser.newContext({ viewport: { width: 1280, height: 1400 } });
      });
    promise.catch(() => {
      if (contextPromise === promise) contextPromise = null;
    });
    contextPromise = promise;
  }
  return contextPromise;
}

// ---- At most MAX_TABS pages loading at once; the rest wait their turn ----
let activeLoads = 0;
const waitingLoads = [];

async function withTab(load) {
  if (activeLoads < MAX_TABS) activeLoads++;
  else await new Promise((resolve) => waitingLoads.push(resolve)); // a finishing load hands over its turn

  let page = null;
  try {
    const context = await getContext();
    do page = idleTabs.pop(); while (page && page.isClosed());
    page ??= await context.newPage();

    const result = await load(page);

    // Park the tab on a blank page, so the old map stops loading and can't answer
    // the next request with its data. Then keep it for reuse.
    const parked = page;
    page = null;
    await parked.goto("about:blank").then(
      () => idleTabs.push(parked),
      () => parked.close().catch(() => {})
    );
    return result;
  } finally {
    if (page) page.close().catch(() => {}); // the load failed: don't reuse this tab
    const next = waitingLoads.shift();
    if (next) next();
    else activeLoads--;
  }
}

// ---- Load one fuel for one map view ----
function loadFuel(lat, lng, fuel) {
  return withTab(async (page) => {
    // The map asks GasBuddy for the stations in its visible area with this request.
    const mapResponse = page.waitForResponse(
      (res) => res.url().endsWith("/gaspricemap/map") && res.request().method() === "POST",
      { timeout: MAP_TIMEOUT_MS }
    );
    mapResponse.catch(() => {}); // if goto fails first, this rejection is already handled
    // Only wait for the page to start loading; the full load (ads, trackers) can take
    // over 30 s, and all we need is the map request above.
    await page.goto(
      `https://www.gasbuddy.com/gaspricemap?lat=${lat}&lng=${lng}&z=${ZOOM}&fuel=${FUEL_IDS[fuel]}`,
      { waitUntil: "commit", timeout: MAP_TIMEOUT_MS }
    );
    const data = await (await mapResponse).json();
    return [...data.primaryStations, ...data.secondaryStations].filter((s) => s.price !== "--");
  });
}

// ---- Load all fuels for one map view, combined into one entry per station ----
async function loadView(lat, lng) {
  const fuels = Object.keys(FUEL_IDS);
  const results = await Promise.allSettled(fuels.map((fuel) => loadFuel(lat, lng, fuel)));

  const failedFuels = fuels.filter((_, i) => results[i].status === "rejected");
  if (failedFuels.length === fuels.length) throw results[0].reason;

  const byId = new Map();
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    for (const s of result.value) {
      const station = byId.get(s.id) ?? { id: s.id, lat: s.lat, lng: s.lng, prices: {} };
      station.prices[fuels[i]] = { price: Number(s.price), cash: Boolean(s.iscash) };
      byId.set(s.id, station);
    }
  });
  return { stations: [...byId.values()], failedFuels };
}

// ---- Same view twice within 5 minutes, or while it's still loading: load it once ----
const views = new Map(); // key -> { promise, expires }

function getView(lat, lng) {
  const now = Date.now();
  for (const [key, entry] of views) if (entry.expires <= now) views.delete(key);

  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = views.get(key);
  if (cached) return cached.promise;

  const entry = { promise: loadView(lat, lng), expires: Infinity }; // Infinity while loading
  views.set(key, entry);
  entry.promise.then(
    ({ failedFuels }) => (entry.expires = Date.now() + (failedFuels.length ? PARTIAL_CACHE_MS : CACHE_MS)),
    () => views.get(key) === entry && views.delete(key) // failures aren't cached
  );
  return entry.promise;
}

// ---- HTTP server ----
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/health") return send(res, 200, { status: "ok", activeLoads, waiting: waitingLoads.length });
    if (url.pathname !== "/prices") return send(res, 404, { error: "Not found." });
    if (req.headers["x-price-secret"] !== SECRET) return send(res, 401, { error: "Unauthorized." });

    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (!url.searchParams.get("lat") || !url.searchParams.get("lng") ||
        !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return send(res, 400, { error: "Missing or invalid lat/lng." });
    }

    const started = Date.now();
    try {
      const view = await getView(lat, lng);
      const failed = view.failedFuels.length ? ` (failed: ${view.failedFuels.join(", ")})` : "";
      console.log(`${lat},${lng}: ${view.stations.length} stations in ${Date.now() - started} ms${failed}`);
      send(res, 200, view);
    } catch (error) {
      console.warn(`${lat},${lng} failed: ${error.message}`);
      send(res, 502, { error: "Couldn't load GasBuddy prices." });
    }
  })
  .listen(PORT, () => console.log(`Price service on port ${PORT}, up to ${MAX_TABS} tabs`));
```

Make up a long random secret. For example, run this on the server and copy the output:

```bash
openssl rand -hex 24
```

Try the service in the foreground first:

```bash
PRICE_SECRET=<your-secret> xvfb-run -a -s "-screen 0 1920x1440x24" node price-server.mjs
```

Then, from your **laptop**, in a second terminal:

```powershell
curl.exe -H "x-price-secret: <your-secret>" "http://<ELASTIC-IP>:8080/prices?lat=30.2020&lng=-92.0773"
```

You should get `{"stations":[...],"failedFuels":[]}` back. Run the same command again right away: it should answer instantly from the 5-minute cache, and the server log should show a few milliseconds.

For reference, this code was tested on a Windows laptop with Google Chrome (Lafayette, LA):

| Request | Result |
|---|---|
| First view (5 new tabs) | 77 stations, about 3 s |
| Same view, 2 requests at once | Loaded once; both got the answer at about 3 s |
| Same view again | From cache, a few ms |
| A different view (reused tabs) | About 1 s |
| No secret | `401` | Stop the server with Ctrl+C when you're done.

## Step 6: Keep it running with pm2

pm2 restarts the service if it crashes and starts it again after a reboot.

```bash
sudo npm install -g pm2

cd ~/price-service
PRICE_SECRET=<your-secret> pm2 start "xvfb-run -a -s '-screen 0 1920x1440x24' node price-server.mjs" --name price-service

pm2 save       # remember this process list
pm2 startup    # prints one sudo command. Copy and run it so pm2 starts on boot.
```

On a `t3.small`, add `MAX_TABS=2` before `pm2 start`, next to `PRICE_SECRET`.

Useful commands:

| Command | What it does |
| --- | --- |
| `pm2 status` | Is it running? |
| `pm2 logs price-service` | Live logs (Ctrl+C to exit) |
| `pm2 restart price-service` | Restart after editing the code |
| `pm2 stop price-service` | Stop it |

To change the secret later: `pm2 delete price-service`, run the `pm2 start` line again with the new value, then `pm2 save`.

## Step 7: Point Fuel Route at the service

**1. Environment variables.** Add these locally in `.env.local` (git-ignored) and in Vercel under **Project → Settings → Environment Variables**:

```
PRICE_SERVICE_URL=http://<ELASTIC-IP>:8080
PRICE_SERVICE_SECRET=<your-secret>
```

**2. Before Supabase exists: call the service from `gasbuddy.ts`.** Use the service when `PRICE_SERVICE_URL` is set, and fall back to local Chrome otherwise, so it still works on a laptop. It asks for the same two map views the local code loads (north and south of the search). This goes at the top of `getGasBuddyPrices`, with the helper below it:

```ts
export async function getGasBuddyPrices(lat: number, lng: number): Promise<GasBuddyStation[]> {
  const serviceUrl = process.env.PRICE_SERVICE_URL;
  if (serviceUrl) return getPricesFromService(serviceUrl, lat, lng);

  // ...existing local-Chrome code stays below...
}

async function getPricesFromService(serviceUrl: string, lat: number, lng: number) {
  const views = await Promise.allSettled(
    [lat + TILE_LAT_OFFSET, lat - TILE_LAT_OFFSET].map(async (viewLat) => {
      const res = await fetch(`${serviceUrl}/prices?lat=${viewLat}&lng=${lng}`, {
        headers: { "x-price-secret": process.env.PRICE_SERVICE_SECRET ?? "" },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`Price service returned ${res.status}`);
      const data: { stations: GasBuddyStation[] } = await res.json();
      return data.stations;
    })
  );
  const loaded = views.flatMap((view) => (view.status === "fulfilled" ? [view.value] : []));
  if (loaded.length === 0) throw (views[0] as PromiseRejectedResult).reason;

  // The two views overlap, so merge each station's prices.
  const byId = new Map<number, GasBuddyStation>();
  for (const station of loaded.flat()) {
    const existing = byId.get(station.id);
    byId.set(station.id, existing ? { ...existing, prices: { ...existing.prices, ...station.prices } } : station);
  }
  return [...byId.values()];
}
```

The service returns stations in the same `GasBuddyStation` shape as the local code, so nothing else changes. If the service is down, the stations route already catches the error, and stations load without prices. Check that the stations route's own timeout allows for the service: a view that isn't cached can take 5–15 seconds.

**3. With Supabase: one call per expired price cell.** Once [supabase-cache.md](supabase-cache.md) is built, only `priceStore.ts` calls the service. It calls once for each price cell that is expired **and** that this request claimed, using the cell's center as `lat`/`lng`, then saves the result to `gasbuddy_stations` and `prices`. Searches whose cells are fresh never call EC2.

**4. Redeploy on Vercel**, then search a location. Prices should show on the station cards, and `pm2 logs price-service` on EC2 should show the request. Search the same place again: there should be no new log line, because Supabase or the service's cache answered.

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| `Just a moment...` or no map data in Step 4 | Cloudflare blocks AWS IPs | Try `chromium` vs `chrome`. If both fail, use the Supabase snapshot plan. |
| `Missing X server or $DISPLAY` | Started without `xvfb-run` | Start with the full `xvfb-run -a -s ...` command |
| `Chromium distribution 'chrome' is not found` | Chrome isn't installed | `npx playwright install --with-deps chrome`, or set `BROWSER_CHANNEL=chromium` |
| `curl` from laptop hangs or times out | Port 8080 isn't open | Check the security group rule from Step 1 |
| `401 Unauthorized` | Secret doesn't match | Same value in `PRICE_SECRET` (EC2) and `PRICE_SERVICE_SECRET` (Vercel) |
| `Couldn't load GasBuddy prices` | GasBuddy slow, or its page changed | Check `pm2 logs`, then run `test-gasbuddy.mjs` again and look at the screenshot |
| Some fuels in `failedFuels` | Those page loads timed out | Fine now and then. If constant, lower `MAX_TABS` |
| Requests slow when several people search | Waiting for a free tab | `/health` shows `waiting`. Raise `MAX_TABS` on a bigger instance |
| Service dies, `pm2 logs` shows out of memory | Too many tabs for the instance | Lower `MAX_TABS`, or use a bigger instance |
| Worked yesterday, not today | Instance was stopped and the IP changed | Attach an Elastic IP (Step 1) |
| Prices on laptop, not on Vercel | Env vars missing on Vercel, or no redeploy | Add both env vars, redeploy |

## Security notes

- The secret travels over plain HTTP. That's acceptable for a class demo, but anyone watching the network between Vercel and EC2 could see it. Putting the service behind HTTPS, for example with Caddy and a domain name, would fix that.
- Don't commit the secret or the `.pem` key to git.
- Keep SSH (port 22) limited to **My IP**.

## Later: distributed workers

Each worker in `_docs/worker-protocol.md` could be one of these services. Price cells are a natural unit of work: the coordinator gives each worker a list of expired cells, and the workers load them in parallel. That spreads both the tab load and the GasBuddy requests across machines.
