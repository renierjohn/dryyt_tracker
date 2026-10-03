import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import AppShell, { Icon } from '../components/AppShell';
import '../assets/sass/home.scss';
import RichText from '../components/RichText';
import QrCode from '../components/QrCode';
import { useColorbox } from '../lib/useColorbox';
import '../assets/sass/track.scss';

interface TrackedTransaction {
  code: string;
  customer_name: string;
  description: string | null;
  status: string;
  updated_at: string;
  image_ids: number[];
}

const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
};

// The normal path an order moves along; 'hold' sits off it (see statusStep).
const STEPS = ['in_progress', 'done', 'ready_to_pickup'];

function formatUpdated(updatedAt: string) {
  return new Date(updatedAt.replace(' ', 'T') + 'Z').toLocaleString();
}

const normalizeCode = (s: string) => s.trim().toUpperCase();

export default function Track() {
  const { user, refresh } = useSession();
  const photosRef = useRef<HTMLUListElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [transaction, setTransaction] = useState<TrackedTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(lookupCode: string) {
    setLoading(true);
    setError(null);
    setTransaction(null);
    try {
      const body = await apiFetch<{ transaction: TrackedTransaction }>(
        `/plugins/workflow/track/${encodeURIComponent(lookupCode)}`,
      );
      setTransaction(body.transaction);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'not_found' : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = searchParams.get('code');
    if (initial) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void lookup(normalizeCode(initial));
    }
    // Only run on mount — the form's own submit handler drives later lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = normalizeCode(code);
    if (!trimmed) return;
    setSearchParams({ code: trimmed });
    void lookup(trimmed);
  }

  const stepIndex = transaction ? STEPS.indexOf(transaction.status) : -1;
  useColorbox(photosRef, transaction?.image_ids.join(','));

  return (
    <AppShell active="home" user={user} refresh={refresh} contentClassName="m3-page track">
      <h1 className="m3-headline">Code Result</h1>

      <section>
        <form className="home__track-card track__search" onSubmit={handleSubmit}>
          <div className="home__track-row">
            <div className="home__field">
              <input
                id="track-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder=" "
                maxLength={6}
                autoComplete="off"
                required
              />
              <label htmlFor="track-code">Code</label>
            </div>
            <button type="submit" className="home__fab" aria-label="Track">
              <Icon name="arrow" />
            </button>
          </div>
        </form>

        {loading && <p className="m3-supporting track__loading" role="status">Looking up…</p>}
        {error === 'not_found' && (
          <p className="m3-banner m3-banner--error" role="alert">No order found for that code.</p>
        )}
        {error === 'unknown_error' && (
          <p className="m3-banner m3-banner--error" role="alert">Something went wrong — try again.</p>
        )}

        {transaction && (
          <article className="m3-card track__result">
            <div className="track__result-head">
              <div className="track__result-id">
                <code className="track__code">{transaction.code}</code>
                <span className={`track__chip track__chip--${transaction.status}`}>
                  {STATUS_LABELS[transaction.status] ?? transaction.status}
                </span>
              </div>
              <figure className="track__qr">
                <QrCode value={transaction.code} size={112} label={`QR code for ${transaction.code}`} />
                <figcaption>Scan for code</figcaption>
              </figure>
            </div>

            {transaction.status === 'hold' ? (
              <p className="m3-supporting">This code is on hold. Contact the store for details.</p>
            ) : (
              <ol className="track__steps">
                {STEPS.map((step, i) => (
                  <li
                    key={step}
                    className={`track__step${i <= stepIndex ? ' track__step--done' : ''}${i === stepIndex ? ' track__step--current' : ''}`}
                    aria-current={i === stepIndex ? 'step' : undefined}
                  >
                    <span className="track__step-dot" aria-hidden="true" />
                    <span className="track__step-label">{STATUS_LABELS[step]}</span>
                  </li>
                ))}
              </ol>
            )}

            <dl className="track__details">
              <div>
                <dt>Customer</dt>
                <dd>{transaction.customer_name}</dd>
              </div>
              {transaction.description && (
                <div>
                  <dt>Description</dt>
                  <RichText as="dd" html={transaction.description} />
                </div>
              )}
              <div>
                <dt>Last updated</dt>
                <dd>{formatUpdated(transaction.updated_at)}</dd>
              </div>
            </dl>

            {transaction.image_ids.length > 0 && (
              <div className="track__photos">
                <h2 className="m3-section-title">Photos</h2>
                <ul ref={photosRef}>
                  {transaction.image_ids.map((imageId, i) => {
                    const src = `/api/plugins/workflow/track/${encodeURIComponent(transaction.code)}/images/${imageId}`;
                    return (
                      <li key={imageId}>
                        <a href={src} data-colorbox="track-photos" title={`Photo ${i + 1}`}>
                          <img src={src} alt={`Photo ${i + 1}`} loading="lazy" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </article>
        )}
      </section>
    </AppShell>
  );
}
