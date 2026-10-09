// Turns an address into coordinates using OpenStreetMap's free Nominatim geocoder.
// Usage: GET /api/geocode?q=Hammond, LA
// Nominatim rules: max 1 request/second and a User-Agent identifying the app
// (browsers can't set that header, which is why this runs on the server).
// https://operations.osmfoundation.org/policies/nominatim/

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();

  if (!query) {
    return Response.json({ error: "Missing address." }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const res = await fetch(url, {
    headers: { "User-Agent": "FuelRoute/0.1 (CMPS 432 class project)" },
  });

  if (!res.ok) {
    return Response.json({ error: "Address lookup failed." }, { status: 502 });
  }

  const results: NominatimResult[] = await res.json();

  if (results.length === 0) {
    return Response.json({ error: "No results for that address." }, { status: 404 });
  }

  const { lat, lon, display_name } = results[0];
  return Response.json({
    lat: Number(lat),
    lng: Number(lon),
    address: display_name,
  });
}
