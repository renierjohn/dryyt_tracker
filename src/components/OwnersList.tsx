import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

interface Owner {
  id: number;
  display_name: string;
  email: string;
  contact_number: string | null;
  address: string | null;
  avatar_key: string | null;
}

export default function OwnersList() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const body = await apiFetch<{ owners: Owner[] }>('/owners');
        setOwners(body.owners);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'unknown_error');
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  if (error || owners.length === 0) return null;

  return (
    <section className="home__owners">
      <h2 className="home__section-title">Stores</h2>
      <ul className="home__owner-list">
        {owners.map((o) => (
          <li key={o.id}>
            <Link className="home__owner-item" to={`/owner/${encodeURIComponent(o.display_name)}`}>
              {o.avatar_key ? (
                <img className="home__avatar" src={`/api/avatars/${o.avatar_key}`} alt="" width={40} height={40} loading="lazy" />
              ) : (
                <span className="home__avatar" aria-hidden="true">{o.display_name.charAt(0).toUpperCase()}</span>
              )}
              <span className="home__owner-text">
                <span className="home__owner-name">{o.display_name}</span>
                {o.address && <span className="home__owner-meta">{o.address}</span>}
                <span className="home__owner-meta">{o.email}</span>
                {o.contact_number && <span className="home__owner-meta">{o.contact_number}</span>}
              </span>
              <span className="home__owner-visit" aria-hidden="true">Visit</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
