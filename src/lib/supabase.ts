// Server-only access to the Supabase cache (see _docs/supabase-cache.md), through
// Supabase's REST API (PostgREST), so no client library is needed.
// Uses the secret key, which bypasses row-level security. Never import this from
// a client component, and never give the key a NEXT_PUBLIC_ prefix.
// https://supabase.com/docs/guides/api

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const TIMEOUT_MS = 5_000;

// Without the URL and key, the app works as before: no shared cache.
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

export async function supabaseRest<T = unknown>(
  path: string, // e.g. "osm_stations?select=*" or "rpc/claim_price_cell"
  { method = "GET", body, prefer }: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase is not configured");

  const headers: Record<string, string> = { apikey: SUPABASE_SECRET_KEY };
  // New-style keys (sb_secret_...) go only in `apikey`; a legacy service_role JWT
  // also goes in Authorization.
  if (!SUPABASE_SECRET_KEY.startsWith("sb_")) headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Supabase ${method} ${path.split("?")[0]}: HTTP ${res.status} ${detail}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// A PostgREST `in` filter value: in.("a","b")
export function inList(values: (string | number)[]) {
  return `in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(",")})`;
}
