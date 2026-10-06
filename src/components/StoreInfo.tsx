import { WEEKDAYS, WEEKDAY_LABELS, formatTime, googleEmbedUrl, todayKey, type StoreDetails } from '../lib/store';
import '../assets/sass/store.scss';

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
  const mapUrl = googleEmbedUrl(name, store.address, store.lat, store.lng);
  if (!mapUrl && !store.opening_hours && !avatarKey) return null;
  const today = todayKey();

  return (
    <div className="store-info">
      {mapUrl && (
        <div className="m3-card store-info__location">
          <h2 className="m3-card__title">Location</h2>
          {store.address && <p className="store-info__address">{store.address}</p>}
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
          <img
            className="store-info__photo"
            src={`/api/avatars/${avatarKey}`}
            alt={name ? `${name} profile picture` : 'Store profile picture'}
          />
        )}
        {store.opening_hours && (
          <div className="m3-card">
            <h2 className="m3-card__title">Opening hours</h2>
            <dl className="store-info__hours">
              {WEEKDAYS.map((day) => {
                const h = store.opening_hours![day];
                return (
                  <div key={day} className={day === today ? 'store-info__today' : undefined}>
                    <dt>{WEEKDAY_LABELS[day]}</dt>
                    <dd>{h.open ? `${formatTime(h.from)} – ${formatTime(h.to)}` : 'Closed'}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
