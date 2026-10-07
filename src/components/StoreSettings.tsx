import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  googleEmbedUrl,
  defaultOpeningHours,
  type DayHours,
  type OpeningHours,
  type StoreDetails,
  type Weekday,
} from '../lib/store';

const MAP_DELAY_MS = 900;

// Dashboard "Store" tab (owners only): address with an embedded Google map, and
// weekly opening hours. The iframe searches the typed address itself (debounced);
// being cross-origin it can't hand coordinates back — those are set separately
// on the Profile tab ("Your coordinates") and passed through unchanged here.
export default function StoreSettings({ ownerName }: { ownerName: string }) {
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [hours, setHours] = useState<OpeningHours>(defaultOpeningHours);
  const [mapAddress, setMapAddress] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    async function load() {
      try {
        const { store } = await apiFetch<{ store: StoreDetails }>('/owner/store');
        setAddress(store.address ?? '');
        setLat(store.lat);
        setLng(store.lng);
        setMapAddress(store.address ?? '');
        if (store.opening_hours) setHours(store.opening_hours);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'unknown_error');
      } finally {
        setLoaded(true);
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => window.clearTimeout(timerRef.current);
  }, []);

  function handleAddressChange(value: string) {
    setAddress(value);
    setSaved(false);
    window.clearTimeout(timerRef.current);
    const query = value.trim();
    timerRef.current = window.setTimeout(() => setMapAddress(query.length >= 4 ? query : ''), MAP_DELAY_MS);
  }

  function updateDay(day: Weekday, patch: Partial<DayHours>) {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
    setSaved(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/owner/store', {
        method: 'PUT',
        body: JSON.stringify({ address, lat, lng, opening_hours: hours }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  const mapUrl = googleEmbedUrl(ownerName, mapAddress, lat, lng);

  if (!loaded) return <p className="m3-supporting">Loading…</p>;

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
      {saved && <p className="m3-banner" role="status">Store details saved.</p>}

      <section className="dashboard__section">
        <h2>Location</h2>
        <label className="m3-field store__address">
          Address
          <input
            value={address}
            onChange={(e) => handleAddressChange(e.target.value)}
            placeholder="Start typing your store's address"
            autoComplete="street-address"
          />
        </label>
        <p className="store__hint">Type the full address; the map updates when you stop typing.</p>
        {mapUrl ? (
          <iframe
            className="store-map"
            title="Store location"
            src={mapUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <div className="store-map" />
        )}
      </section>

      <section className="dashboard__section">
        <h2>Opening hours</h2>
        <ul className="store__hours">
          {WEEKDAYS.map((day) => {
            const h = hours[day];
            return (
              <li key={day} className="store__day">
                <label className="store__toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={h.open}
                    onChange={(e) => updateDay(day, { open: e.target.checked })}
                  />
                  <span className="store__day-name">{WEEKDAY_LABELS[day]}</span>
                </label>
                {h.open ? (
                  <span className="store__times">
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[day]} opens`}
                      value={h.from}
                      onChange={(e) => updateDay(day, { from: e.target.value })}
                      required
                    />
                    <span aria-hidden="true">–</span>
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[day]} closes`}
                      value={h.to}
                      min={h.from}
                      onChange={(e) => updateDay(day, { to: e.target.value })}
                      required
                    />
                  </span>
                ) : (
                  <span className="store__closed">Closed</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <button className="dashboard__button" type="submit">Save store details</button>
    </form>
  );
}
