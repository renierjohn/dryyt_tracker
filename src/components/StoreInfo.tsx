import { WEEKDAYS, WEEKDAY_LABELS, formatTime, googleEmbedUrl, todayKey, type StoreDetails } from '../lib/store';
import { useState, useSyncExternalStore } from 'react';
import ImageLightbox from './ImageLightbox';
import '../assets/sass/store.scss';

// Phone widths (below 599px), where opening hours collapse — keep in sync with
// the matching breakpoint in store.scss.
const NARROW_QUERY = '(max-width: 598.98px)';

function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(NARROW_QUERY);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
  );
}

// Read-only store cards for the public /owner/:identifier page.
export default function StoreInfo({
  store,
  avatarKey,
  name,
}: {
  store: StoreDetails;
  avatarKey?: string | null;
  name?: string | null;
}) {
  const narrow = useNarrow();
  const [photoOpen, setPhotoOpen] = useState(false);
  const photoAlt = name ? `${name} profile picture` : 'Store profile picture';
  const mapUrl = googleEmbedUrl(name, store.address, store.lat, store.lng);
  if (!mapUrl && !store.opening_hours && !avatarKey) return null;
  return (
    <div className="store-info">
      {mapUrl && (
        <div className="m3-card store-info__location">
          <h2 className="m3-card__title">
            Location{store.address && <span className="store-info__address">: {store.address}</span>}
          </h2>
          {mapUrl && (
            <>
              <iframe
                className="store-map store-map--compact"
                title="Store location"
                src={mapUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <a
                className="store-info__directions"
                href={`https://www.google.com/maps?${new URLSearchParams({ q: [name, store.address ?? `${store.lat},${store.lng}`].filter(Boolean).join(' ') })}`}
                target="_blank"
                rel="noreferrer"
              >
                Get directions
              </a>
            </>
          )}
        </div>
      )}
      <div className="store-info__side">
        {avatarKey && (
          <button type="button" className="store-info__photo" aria-label="View photo" onClick={() => setPhotoOpen(true)}>
            <img src={`/api/avatars/${avatarKey}`} alt={photoAlt} />
          </button>
        )}
        {store.opening_hours &&
          (narrow ? (
            // Phones: collapsed by default, under its title.
            <details className="m3-card m3-collapsible">
              <summary className="m3-card__title">Opening hours</summary>
              <OpeningHours hours={store.opening_hours} />
            </details>
          ) : (
            <div className="m3-card">
              <h2 className="m3-card__title">Opening hours</h2>
              <OpeningHours hours={store.opening_hours} />
            </div>
          ))}
      </div>
      {photoOpen && avatarKey && (
        <ImageLightbox src={`/api/avatars/${avatarKey}`} alt={photoAlt} onClose={() => setPhotoOpen(false)} />
      )}
    </div>
  );
}

function OpeningHours({ hours }: { hours: NonNullable<StoreDetails['opening_hours']> }) {
  const today = todayKey();
  return (
    <dl className="store-info__hours">
      {WEEKDAYS.map((day) => {
        const h = hours[day];
        return (
          <div key={day} className={day === today ? 'store-info__today' : undefined}>
            <dt>{WEEKDAY_LABELS[day]}</dt>
            <dd>{h.open ? `${formatTime(h.from)} – ${formatTime(h.to)}` : 'Closed'}</dd>
          </div>
        );
      })}
    </dl>
  );
}
