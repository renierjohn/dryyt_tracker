// Address ⇄ coordinates via OpenStreetMap's Nominatim (no API key). Its usage
// policy allows at most ~1 request/second, so callers debounce typing.
const NOMINATIM = 'https://nominatim.openstreetmap.org';

export interface GeocodeResult {
  lat: number;
  lng: number;
  address: string;
}

export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), address: hit.display_name } : null;
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const body = (await res.json()) as { display_name?: string };
  return body.display_name ?? null;
}
