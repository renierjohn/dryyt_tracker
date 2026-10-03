import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { geocode, reverseGeocode } from '../lib/geocode';
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  defaultOpeningHours,
  type DayHours,
  type OpeningHours,
  type StoreDetails,
  type Weekday,
} from '../lib/store';
import StoreMap from './StoreMap';

const GEOCODE_DELAY_MS = 900;

// Dashboard "Store" tab (owners only): address with a live map pin, and weekly
// opening hours. Typing an address moves the pin; dragging the pin (or clicking
// the map) fills the address back in.
export default function StoreSettings() {
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [hours, setHours] = useState<OpeningHours>(defaultOpeningHours);
  const [lookup, setLookup] = useState<'idle' | 'searching' | 'not_found'>('idle');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pendingRef = useRef<{ timer?: number; abort?: AbortController }>({});

  useEffect(() => {
    async function load() {
      try {
        const { store } = await apiFetch<{ store: StoreDetails }>('/owner/store');
        setAddress(store.address ?? '');
        setLat(store.lat);
        setLng(store.lng);
        if (store.opening_hours) setHours(store.opening_hours);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'unknown_error');
      } finally {
        setLoaded(true);
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const pending = pendingRef.current;
    return () => {
      window.clearTimeout(pending.timer);
      pending.abort?.abort();
    };
  }, []);

  function cancelPending() {
    window.clearTimeout(pendingRef.current.timer);
    pendingRef.current.abort?.abort();
  }

  function handleAddressChange(value: string) {
    setAddress(value);
    setSaved(false);
    cancelPending();
    if (value.trim().length < 4) {
      setLookup('idle');
      return;
    }
    pendingRef.current.timer = window.setTimeout(async () => {
      const abort = new AbortController();
      pendingRef.current.abort = abort;
      setLookup('searching');
      try {
        const hit = await geocode(value.trim(), abort.signal);
        if (hit) {
          setLat(hit.lat);
          setLng(hit.lng);
          setLookup('idle');
        } else {
          setLookup('not_found');
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error('Geocoding failed', err);
          setLookup('idle');
        }
      }
    }, GEOCODE_DELAY_MS);
  }

  const handlePinMove = useCallback(async (nextLat: number, nextLng: number) => {
    window.clearTimeout(pendingRef.current.timer);
    pendingRef.current.abort?.abort();
    setLat(nextLat);
    setLng(nextLng);
    setSaved(false);
    const abort = new AbortController();
    pendingRef.current.abort = abort;
    setLookup('searching');
    try {
      const found = await reverseGeocode(nextLat, nextLng, abort.signal);
      if (found) setAddress(found);
      setLookup('idle');
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('Reverse geocoding failed', err);
        setLookup('idle');
      }
    }
  }, []);

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
        <p className="store__hint" aria-live="polite">
          {lookup === 'searching'
            ? 'Finding on map…'
            : lookup === 'not_found'
              ? 'Couldn’t find that address — try adding the city, or drag the pin.'
              : 'Drag the pin or tap the map to fine-tune.'}
        </p>
        <StoreMap lat={lat} lng={lng} onMove={handlePinMove} />
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
