import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

interface PublicAlert {
  id: number;
  type: 'info' | 'success' | 'warning' | 'danger';
  visibility: string;
  body_html: string;
}

interface PublicProfile {
  display_name: string;
  avatar_key: string | null;
  alerts: PublicAlert[];
}

export default function UserPage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await apiFetch<PublicProfile>(`/users/${id}/public`);
        if (!cancelled) setProfile(body);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          console.error('Failed to load public profile', err);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) return <p>User not found.</p>;
  if (!profile) return <p>Loading…</p>;

  return (
    <div>
      {profile.avatar_key && (
        <img src={`/api/avatars/${profile.avatar_key}`} alt={profile.display_name} width={96} height={96} />
      )}
      <h1>{profile.display_name}</h1>
      {profile.alerts.map((alert) => (
        <div
          key={alert.id}
          className={`alert alert-${alert.type}`}
          dangerouslySetInnerHTML={{ __html: alert.body_html }}
        />
      ))}
    </div>
  );
}
