import { WEEKDAYS, WEEKDAY_LABELS, formatTime, todayKey, type StoreDetails } from '../lib/store';
import StoreMap from './StoreMap';
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
  const hasPin = store.lat != null && store.lng != null;
  if (!store.address && !hasPin && !store.opening_hours && !avatarKey) return null;
  const today = todayKey();

  return (
    <div className="store-info">
      {(store.address || hasPin) && (
        <div className="m3-card store-info__location">
          <h2 className="m3-card__title">Location</h2>
          {store.address && <p className="store-info__address">{store.address}</p>}
          {hasPin && (
            <>
              <StoreMap lat={store.lat} lng={store.lng} className="store-map--compact" />
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
