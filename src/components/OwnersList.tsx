import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

interface Owner {
  id: number;
  display_name: string;
  email: string;
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
      <div className="home__owner-cards">
        {owners.map((o) => (
          <Link className="home__owner-card" to={`/owner/${encodeURIComponent(o.display_name)}`} key={o.id}>
            <h3>{o.display_name}</h3>
            <p>{o.email}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
