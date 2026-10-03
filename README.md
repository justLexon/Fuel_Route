# Fuel Route

**Team:** Lexon, Samuel, Dalton, Arielle, Jelon — CMPS 432

Fuel Route is a web app that finds nearby gas stations that carry the right fuel for your vehicle, ranked by price and distance.

Today, drivers have to look up what fuel their car needs, then separately compare nearby stations by price and distance. Fuel Route combines those steps: the user picks a vehicle and location, and the app determines the compatible fuel type, loads nearby stations and prices, calculates distances, and ranks the results.

To support the course's distributed-computing goals, station data is split into independent batches and processed concurrently by multiple worker services (on AWS EC2). A coordinator then combines the results into one ranked response.

## Core workflow

Location/GPS → vehicle selection → determine fuel requirement → retrieve nearby stations/prices → process results in parallel → rank/filter → show on map/list

## Core features

- GPS / manual location
- Vehicle lookup
- Fuel compatibility
- Nearby station search
- Gas prices
- Distance calculation
- Map / list results
- Basic ranking of the best gas stations

Stretch features (optional): accounts, favorites, notifications, historical prices, crowdsourced prices.

## Tech stack

| Tool | Purpose |
| --- | --- |
| TypeScript | Main language for the web app, APIs, coordinator, and workers |
| Next.js | Full-stack web framework (frontend, routing, API endpoints) |
| Mantine | React UI component library |
| Leaflet | Interactive map, markers, popups |
| OpenStreetMap | Map tiles and geographic data |
| Overpass API | Queries OSM for gas stations near a lat/lng |
| Supabase / PostgreSQL | Persistent data (crowdsourced prices, station references, etc.) |
| AWS EC2 | Hosts the distributed coordinator/worker services |
| Vercel | Hosts the Next.js web app |
| Vitest | Unit and integration testing |
| FuelEconomy.gov | Vehicle data used to determine the right fuel |

## Getting started

Requires Node.js 20+.

```bash
git clone <repo-url>
cd Fuel_Route
git checkout beta
npm install
npm run dev
```

Open http://localhost:3000.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint |

## Project structure

```
_docs/          Project document (scope, phases, assignments)
src/app/        Next.js App Router pages and layouts
public/         Static assets
```

## Contributing

Read [CONVENTIONS.md](CONVENTIONS.md) before your first commit. In short: branch off `beta`, open PRs into `beta`, and only merge `beta` into `main` with a teammate's approval.

## Milestones

1. **Phase 0 – Setup:** repo, Next.js, Mantine, API/data research
2. **Phase 1 – Basic UI, location, and vehicle:** layout, GPS/manual location, vehicle selection, fuel requirement
3. **Phase 2 – Stations, prices, and map:** Overpass station search, Leaflet map, prices, distance
4. **Phase 3 – Distributed processing:** coordinator + workers on EC2, batching, aggregation, failure handling, timing
5. **Phase 4 – Ranking and recommendation:** filter by fuel, rank by price/distance, user sorting
6. **Phase 5 – Testing, deployment, and demo**

See [_docs/CMPS432_Project_Document.md](_docs/CMPS432_Project_Document.md) for the full breakdown and assignments.
