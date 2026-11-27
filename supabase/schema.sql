-- Fuel Route shared cache (see _docs/supabase-cache.md).
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again; it only creates what's missing and replaces the function.

-- Station info from OpenStreetMap (Overpass). Refreshed every 365 days.
create table if not exists osm_stations (
  id                text primary key,              -- OSM id, e.g. 'node/123456'
  name              text not null,
  brand             text,
  address           text,                          -- from OSM tags only
  lat               double precision not null,
  lng               double precision not null,
  fuels             text[] not null default '{}',
  unavailable_fuels text[] not null default '{}',
  updated_at        timestamptz not null default now()
);
create index if not exists osm_stations_lat_lng on osm_stations (lat, lng);

-- Which cells have been loaded from Overpass, and when.
create table if not exists station_cells (
  cell       text primary key,                     -- southwest corner, e.g. '30.20,-92.05'
  fetched_at timestamptz,                          -- last successful Overpass load
  failed_at  timestamptz                           -- last failed refresh; retried after 1 hour
);

-- GasBuddy stations with their latest prices. Upserted in place, so there's no
-- price history. Prices older than 30 minutes aren't used.
create table if not exists gasbuddy_stations (
  id         bigint primary key,                   -- GasBuddy's station id
  lat        double precision not null,
  lng        double precision not null,
  prices     jsonb not null default '{}',          -- { "regular": { "price": 2.89, "cash": false }, ... }
  fetched_at timestamptz not null default now()
);
create index if not exists gasbuddy_stations_lat_lng on gasbuddy_stations (lat, lng);

-- Which cells have been scraped, and when. claimed_at stops two users from
-- scraping the same cell at the same time.
create table if not exists price_cells (
  cell       text primary key,
  fetched_at timestamptz,                          -- last successful scrape
  claimed_at timestamptz,                          -- a scrape in progress
  failed_at  timestamptz                           -- last failure; retried after 1 minute
);

-- Nominatim reverse lookups for stations with no OSM address. Stations don't
-- move, so each point is looked up once, ever. address null = Nominatim had none.
create table if not exists addresses (
  point        text primary key,                   -- 'lat,lng' rounded to 5 decimals (~1 m)
  address      text,
  looked_up_at timestamptz not null default now()
);

-- Decides who scrapes a price cell, atomically:
--   'fresh'   scraped in the last 30 minutes: read the database
--   'busy'    someone else is scraping it right now: wait, then read
--   'failed'  the last scrape failed under a minute ago: don't retry yet
--   'claimed' the caller should scrape it now
create or replace function claim_price_cell(p_cell text, p_fresh_seconds int default 1800)
returns json
language plpgsql
set search_path = public
as $$
declare
  r price_cells;
  status text;
begin
  insert into price_cells (cell) values (p_cell) on conflict do nothing;
  select * into r from price_cells where cell = p_cell for update;

  if r.fetched_at > now() - make_interval(secs => p_fresh_seconds) then
    status := 'fresh';
  elsif r.claimed_at > now() - interval '60 seconds' then
    status := 'busy';
  elsif r.failed_at > now() - interval '60 seconds' then
    status := 'failed';
  else
    update price_cells set claimed_at = now() where cell = p_cell;
    status := 'claimed';
  end if;

  return json_build_object('status', status, 'fetched_at', r.fetched_at);
end;
$$;

-- Only the server (secret / service_role key) can read or write. Row-level
-- security with no policies blocks the public anon and publishable keys.
alter table osm_stations      enable row level security;
alter table station_cells     enable row level security;
alter table gasbuddy_stations enable row level security;
alter table price_cells       enable row level security;
alter table addresses         enable row level security;

revoke all on function claim_price_cell(text, int) from public, anon, authenticated;
grant execute on function claim_price_cell(text, int) to service_role;
