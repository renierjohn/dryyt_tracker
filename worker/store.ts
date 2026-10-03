// Validation for an owner's store details (address, map pin, opening hours).
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayHours {
  open: boolean;
  from: string; // "HH:MM", 24h
  to: string;
}

export type OpeningHours = Record<Weekday, DayHours>;

export interface StoreDetails {
  address: string | null;
  lat: number | null;
  lng: number | null;
  opening_hours: OpeningHours | null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ADDRESS_LENGTH = 300;

export function parseOpeningHours(raw: string | null): OpeningHours | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OpeningHours;
  } catch {
    return null;
  }
}

// Returns the cleaned details, or an error code for the API response.
export function validateStoreDetails(body: unknown): StoreDetails | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'invalid_body' };
  const b = body as Record<string, unknown>;

  const address = typeof b.address === 'string' ? b.address.trim() : '';
  if (address.length > MAX_ADDRESS_LENGTH) return { error: 'invalid_address' };

  let lat: number | null = null;
  let lng: number | null = null;
  if (b.lat != null || b.lng != null) {
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number') return { error: 'invalid_location' };
    if (!(Math.abs(b.lat) <= 90) || !(Math.abs(b.lng) <= 180)) return { error: 'invalid_location' };
    lat = b.lat;
    lng = b.lng;
  }

  let hours: OpeningHours | null = null;
  if (b.opening_hours != null) {
    if (typeof b.opening_hours !== 'object') return { error: 'invalid_opening_hours' };
    const raw = b.opening_hours as Record<string, unknown>;
    hours = {} as OpeningHours;
    for (const day of WEEKDAYS) {
      const d = raw[day] as Record<string, unknown> | undefined;
      if (!d || typeof d.open !== 'boolean' || typeof d.from !== 'string' || typeof d.to !== 'string') {
        return { error: 'invalid_opening_hours' };
      }
      if (!TIME_RE.test(d.from) || !TIME_RE.test(d.to)) return { error: 'invalid_opening_hours' };
      if (d.open && d.from >= d.to) return { error: 'invalid_opening_hours' };
      hours[day] = { open: d.open, from: d.from, to: d.to };
    }
  }

  return { address: address || null, lat, lng, opening_hours: hours };
}
