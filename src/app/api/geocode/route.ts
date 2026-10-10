// Converts between addresses and coordinates using OpenStreetMap's free Nominatim geocoder.
//   Address -> coordinates:  GET /api/geocode?q=Hammond, LA
//   Coordinates -> address:  GET /api/geocode?lat=30.50&lng=-90.46
// Nominatim rules: max 1 request/second and a User-Agent identifying the app
// (browsers can't set that header, which is why this runs on the server).
// https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "FuelRoute/0.1 (CMPS 432 class project)";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

function toResponse({ lat, lon, display_name }: NominatimResult) {
  return Response.json({
    lat: Number(lat),
    lng: Number(lon),
    address: display_name,
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  const lat = params.get("lat");
  const lng = params.get("lng");

  if (lat && lng) {
    return reverseGeocode(lat, lng);
  }

  if (!query) {
    return Response.json({ error: "Missing address." }, { status: 400 });
  }

  const url = new URL(`${NOMINATIM_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

  if (!res.ok) {
    return Response.json({ error: "Address lookup failed." }, { status: 502 });
  }

  const results: NominatimResult[] = await res.json();

  if (results.length === 0) {
    return Response.json({ error: "No results for that address." }, { status: 404 });
  }

  return toResponse(results[0]);
}

async function reverseGeocode(lat: string, lng: string) {
  const url = new URL(`${NOMINATIM_URL}/reverse`);
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lng);
  url.searchParams.set("format", "jsonv2");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

  if (!res.ok) {
    return Response.json({ error: "Address lookup failed." }, { status: 502 });
  }

  // Nominatim returns { error: "Unable to geocode" } for places with no address (e.g. the ocean).
  const result: NominatimResult | { error: string } = await res.json();

  if ("error" in result) {
    return Response.json({ error: "No address found for this location." }, { status: 404 });
  }

  return toResponse(result);
}
