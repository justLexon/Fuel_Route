# Supabase cache plan

**Status:** plan, not built yet.
**Goal:** stop calling Overpass, GasBuddy and Nominatim on every search. All users share one cache in Supabase, so a search someone already ran nearby is fast and costs no outside lookups.

## Why

Right now every search runs its own Overpass query and opens 10 GasBuddy tabs. The only cache is in the memory of one server.

- Overpass is often overloaded (502, 504, 429 or timeouts), which breaks searches.
- GasBuddy scraping is slow (several seconds) and should stay low volume.
- On Vercel, each server instance has its own memory, which is often wiped, so users barely share the memory cache.

Gas stations rarely change, and prices change every few hours. So we store each kind of data once and refresh it on its own schedule.

| Data | Source | Refresh every |
|---|---|---|
| Stations (name, brand, location) | Overpass | 365 days |
| Missing addresses | Nominatim reverse lookup | Once per station; addresses don't change |
| Prices | GasBuddy (Samuel's EC2 service) | 30 minutes |

## How a search works

```
GET /api/stations?lat&lng
  1. Memory cache (this server only, ≤ 2 min)  → hit? return
  2. Supabase (shared)                          → fresh? return, save to memory
  3. Overpass / GasBuddy                        → save to Supabase + memory, return
```

The steps are run separately for stations and for prices, because they go stale at different rates.

### Grid cells

Searches are mapped to fixed grid cells, so two users a few blocks apart share the same cells.

| | Cell size | Why |
|---|---|---|
| Station cells | 0.1° × 0.1° (about 7 × 6 mi) | Small, cheap Overpass requests |
| Price cells | 0.15° lat × 0.4° lng | About one GasBuddy map view at zoom 12, so one cell = 5 scrapes (one per fuel). Checked: a 1280 px wide view at zoom 12 covers 0.178° × 0.434°, so a view centered on a cell covers all of it. |

A cell's key is its southwest corner rounded to the cell size, for example `30.2,-92.1`. A 10-mile search touches a few cells of each kind.

## Tables

```sql
-- Station info from OpenStreetMap. Refreshed every 365 days.
create table stations (
  id                text primary key,           -- OSM id, e.g. 'node/123456'
  cell              text not null,              -- station cell it belongs to, e.g. '30.2,-92.1'
  name              text,
  brand             text,
  address           text,                       -- from OSM tags, or looked up (see below)
  address_looked_up boolean not null default false, -- true once Nominatim was asked, even if it had none
  lat               double precision not null,
  lng               double precision not null,
  fuels             text[] not null default '{}',
  updated_at        timestamptz not null default now()
);
create index stations_lat_lng on stations (lat, lng);
create index stations_cell on stations (cell);

-- Which station cells have been loaded from Overpass, and when.
create table station_cells (
  cell       text primary key,                  -- e.g. '30.2,-92.1'
  fetched_at timestamptz not null,              -- last successful Overpass load
  failed_at  timestamptz                        -- last failed refresh; retry after 1 hour
);

-- GasBuddy's stations (their own ids, separate from OSM). The map data has no
-- name or brand: its brand_id is always 0, so it isn't stored.
create table gasbuddy_stations (
  id         bigint primary key,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz not null default now()
);
create index gasbuddy_stations_lat_lng on gasbuddy_stations (lat, lng);

-- Latest price per GasBuddy station and fuel. Upserted, so the table never
-- grows past (stations × 5 fuels).
create table prices (
  gasbuddy_id bigint not null references gasbuddy_stations(id) on delete cascade,
  fuel        text not null check (fuel in ('regular','midgrade','premium','diesel','e85')),
  price       numeric(5,3) not null,
  cash        boolean not null default false,
  fetched_at  timestamptz not null default now(), -- when we scraped it (the map data has no report time)
  primary key (gasbuddy_id, fuel)
);

-- Which price cells have been scraped, and when. Also stops two users from
-- scraping the same cell at the same time.
create table price_cells (
  cell       text primary key,
  fetched_at timestamptz,                       -- last successful scrape
  claimed_at timestamptz,                       -- a scrape in progress
  failed_at  timestamptz                        -- last failure; retry after 1 min
);

-- Only the server (service-role key) can read or write. No public access.
alter table stations          enable row level security;
alter table station_cells     enable row level security;
alter table gasbuddy_stations enable row level security;
alter table prices            enable row level security;
alter table price_cells       enable row level security;
```

Row level security is enabled with **no policies**, so the public `anon` key can't read or write anything. Only server code using the service-role key can.

## Rules

### Stations

For each station cell in the search area:

1. **Never loaded** (no `station_cells` row): this is the first search here. Query Overpass and save the result. If Overpass fails, there's no old data to use, so show the GasBuddy-only fallback (below) and try again on the next search.
2. **Loaded less than 365 days ago:** use Supabase. Don't call Overpass.
3. **Expired** (`fetched_at` older than 365 days): refresh from Overpass, unless `failed_at` is within the last hour.
   - **If it succeeds,** replace the cell's stations in one transaction:
     - Delete the cell's `stations` rows whose ids aren't in the new result (closed stations).
     - Upsert the rest. Old names and brands are overwritten.
     - Set `fetched_at = now()` and `failed_at = null`.
   - **If it fails,** set `failed_at = now()` and keep using the expired rows. Old names beat no names.
4. Read the stations with `lat between … and lng between …`, then filter to the exact 10-mile radius in JavaScript.
5. A refresh must **not** overwrite an address we looked up when OSM still has none. Only replace `address` when OSM supplies one.

**GasBuddy-only fallback:** GasBuddy stations that match no OSM station (because the cell isn't loaded yet, or the station opened after the last refresh) are still shown, named "Gas station" (GasBuddy's map data has no names or brands), with an address from Nominatim. With refreshes a year apart, this is how new stations show up in the meantime.

### Addresses

Some OSM stations have no address tags; that's the "Chevron" card with no address. These already work without Supabase: `/api/station-address` does a Nominatim reverse lookup for each card shown, at most 1 per second, cached in memory.

With Supabase, save the result to `stations.address` and set `address_looked_up = true`, so each station is looked up once, ever. Set the flag even when Nominatim has no address, so we don't keep asking.

### Prices

1. For each price cell: if `fetched_at` is within 30 minutes, use the database. Otherwise, try to claim the cell:
   ```sql
   insert into price_cells (cell) values ($1) on conflict do nothing;

   update price_cells set claimed_at = now()
   where cell = $1
     and (fetched_at is null or fetched_at < now() - interval '30 min')
     and (claimed_at is null or claimed_at < now() - interval '60 s')
     and (failed_at  is null or failed_at  < now() - interval '1 min')
   returning cell;
   ```
2. **Row returned:** this server got the claim. Scrape (5 fuels), upsert `gasbuddy_stations` and `prices`, then set `fetched_at = now(), claimed_at = null`. On failure, set `failed_at = now(), claimed_at = null`.
3. **No row returned:** another user is already scraping it, or it just failed. Wait a few seconds, then read from the database.
4. When reading, use only prices with `fetched_at` in the last 30 minutes. A station missing from the latest scrape keeps an old row, so it drops out without any cleanup job.

### Matching

Match GasBuddy stations to OSM stations **at read time** with the current `attachPrices` (nearest within 0.06 mi). We don't store the match, because either side can change when it's refreshed. Matching about 100 stations takes well under a millisecond.

Names and brands come only from OSM. GasBuddy's map data includes a `brand_id`, but it's always 0, so there's nothing to learn from it.

### Memory cache (per server)

- Key it by **cell**, not by the searched location, so it lines up with Supabase.
- Cache for at most **2 minutes**.
- Count price expiry from the row's `fetched_at`, **not** from when this server cached it. Otherwise prices could be 30 minutes old in Supabase plus more in memory.
- It only saves the roughly 50–100 ms Supabase query on repeat searches. Supabase is what cuts GasBuddy and Overpass lookups.

## Code changes

| File | Change |
|---|---|
| `src/lib/supabase.ts` (new) | Server-only client using `SUPABASE_SERVICE_ROLE_KEY`. |
| `src/lib/cells.ts` (new) | Find the cells for a search (both grid sizes), cell keys, cell bounds. Unit tested. |
| `src/lib/stationStore.ts` (new) | Read stations for an area, refresh stale cells from Overpass, save looked-up addresses. |
| `src/lib/priceStore.ts` (new) | Read fresh prices, claim, call the EC2 price service, save, failures. |
| `src/app/api/stations/route.ts` | Use the two stores and replace the current memory cache with the cell-keyed one. The response shape stays the same, so the UI doesn't change. |
| `src/app/api/station-address/route.ts` | Check `stations.address` first, and save new lookups there. |

## Environment variables

Put these in `.env.local` and in Vercel. **Never** use a `NEXT_PUBLIC_` prefix; the service-role key must stay on the server.

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

## Open questions for the team

- **Samuel's EC2 price service:** I'd suggest that Vercel calls EC2 for each price cell and writes to Supabase itself, which keeps all database logic in one place. The other option is EC2 writing to Supabase directly. Decide before building `priceStore.ts`.
- **Does the AWS setup already include a database?** If so, use the same schema there instead of adding Supabase.
- **Free-tier pause:** Supabase free projects pause after about a week with no activity. Open the project before the demo, and preload the demo area by searching it once.

## Ground rules

- **Store station info, not price history.** Prices are overwritten in place, and nothing older than 30 minutes is shown. GasBuddy scraping is for the class demo only, so keep it low volume.
- **OpenStreetMap data (ODbL)** may be stored, but the app must show "© OpenStreetMap contributors". The Leaflet map already does.
- **Nominatim:** at most 1 request per second, with the app's User-Agent (`FuelRoute/0.1 (CMPS 432 class project)`). Don't use it for bulk lookups; only look up stations that are shown.
