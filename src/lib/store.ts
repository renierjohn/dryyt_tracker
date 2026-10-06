// Mirrors worker/store.ts — an owner's store details as the API returns them.
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export interface DayHours {
  open: boolean;
  from: string;
  to: string;
}

export type OpeningHours = Record<Weekday, DayHours>;

export interface StoreDetails {
  address: string | null;
  lat: number | null;
  lng: number | null;
  opening_hours: OpeningHours | null;
}

export function defaultOpeningHours(): OpeningHours {
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, { open: d !== 'sun', from: '09:00', to: '17:00' }]),
  ) as OpeningHours;
}

// "09:00" → "9:00 AM" in the viewer's locale.
export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Weekday key for today (JS getDay() starts on Sunday).
export function todayKey(): Weekday {
  return WEEKDAYS[(new Date().getDay() + 6) % 7];
}

// Google Maps embed searched by text. Prefixing the owner's name lets Google
// match the business listing; coordinates are the fallback when there's no address.
export function googleEmbedUrl(name: string | null | undefined, address: string | null, lat: number | null, lng: number | null) {
  const q = address ? [name, address].filter(Boolean).join(' ') : lat != null && lng != null ? `${lat},${lng}` : '';
  return q ? `https://maps.google.com/maps?${new URLSearchParams({ q, z: '17', output: 'embed' })}` : null;
}
