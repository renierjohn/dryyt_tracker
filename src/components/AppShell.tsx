import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { isSuperadmin, canSendAlerts, isOwner, isCustomer } from '../lib/permissions';
import LogoutButton from './LogoutButton';
import { getMyTrackCode } from '../lib/myTrack';
import '../assets/sass/m3.scss';

// Material 3 app shell, adapting by window size: phones get a top app bar +
// bottom navigation bar; tablets and desktops get a navigation rail. The nav is
// built directly here (not via <PluginNav>) because it mixes core links
// (dashboard, alerts) with the auth action — plugin links (Workflow, Theme) stay
// reachable from Dashboard's own shortcuts list instead.

// Material Symbols paths (24×24 viewBox).
const ICONS = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  admin: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
  alerts:
    'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  logout:
    'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
  login:
    'M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z',
  register:
    'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  tracker:
    'M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  mytrack:
    'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  // Transaction statuses (Tracker sections).
  hold: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z',
  in_progress:
    'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z',
  done: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  ready_to_pickup:
    'M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-1.99.9-1.99 2L3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm0 10c-2.76 0-5-2.24-5-5h2c0 1.66 1.34 3 3 3s3-1.34 3-3h2c0 2.76-2.24 5-5 5z',
  end: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z',
  print:
    'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  save: 'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z',
  arrow: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
  scan:
    'M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M19 5h-6v6h6V5zm-6 8h1.5v1.5H13V13zm1.5 1.5H16V16h-1.5v-1.5zM16 13h1.5v1.5H16V13zm-3 3h1.5v1.5H13V16zm1.5 1.5H16V19h-1.5v-1.5zM16 16h1.5v1.5H16V16zm1.5-1.5H19V16h-1.5v-1.5zm0 3H19V19h-1.5v-1.5zM22 7h-2V4h-3V2h5v5zm0 15v-5h-2v3h-3v2h5zM2 22h5v-2H4v-3H2v5zM2 2v5h2V4h3V2H2z',
} as const;

export type IconName = keyof typeof ICONS;
type NavKey = 'home' | 'dashboard' | 'tracker' | 'track' | 'scan' | 'alerts' | 'register' | 'login';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="m3-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

function NavItem({ icon, label, active }: { icon: IconName; label: string; active?: boolean }) {
  return (
    <>
      <span className={`m3-nav__pill${active ? ' m3-nav__pill--active' : ''}`}>
        <Icon name={icon} />
      </span>
      <span className="m3-nav__label">{label}</span>
    </>
  );
}

function NavLink({ to, icon, label, active }: { to: string; icon: IconName; label: string; active: NavKey }) {
  const isActive = to.slice(1) === active || (to === '/' && active === 'home');
  return (
    <Link className="m3-nav__item" to={to} aria-current={isActive ? 'page' : undefined}>
      <NavItem icon={icon} label={label} active={isActive} />
    </Link>
  );
}

export default function AppShell({
  active,
  user = null,
  refresh,
  trailing,
  contentClassName,
  children,
}: {
  active: NavKey;
  user?: AuthUser | null;
  refresh?: () => Promise<void>;
  trailing?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  const admin = user ? isSuperadmin(user) : false;
  const owner = user ? isOwner(user) : false;
  // Read on every render, so it shows up as soon as /track stores a code.
  // Owners get the pickup scanner in its place.
  const myTrackCode = owner ? null : getMyTrackCode();

  return (
    <div className="m3-shell">
      <header className="m3-shell__bar">
        <Link className="m3-shell__brand" to="/">
          <img className="m3-shell__logo" src="/dryyt-logo.svg" alt="" width={32} height={32} />
          Dryyt
        </Link>
        {trailing ?? (user && (
          <span className="m3-shell__avatar" title={user.display_name}>
            {initials(user.display_name)}
          </span>
        ))}
      </header>

      <main className={`m3-shell__content${contentClassName ? ` ${contentClassName}` : ''}`}>{children}</main>

      <nav className="m3-nav">
        <NavLink to="/" icon="home" label="Home" active={active} />
        {myTrackCode && (
          <Link
            className="m3-nav__item"
            to={`/track?code=${encodeURIComponent(myTrackCode)}`}
            aria-current={active === 'track' ? 'page' : undefined}
          >
            <NavItem icon="mytrack" label="My Track" active={active === 'track'} />
          </Link>
        )}
        {owner && (
          <Link className="m3-nav__item" to="/plugins/workflow/scan" aria-current={active === 'scan' ? 'page' : undefined}>
            <NavItem icon="scan" label="Scan" active={active === 'scan'} />
          </Link>
        )}
        {user && (
          <Link
            className="m3-nav__item"
            to={admin ? '/admin' : '/dashboard'}
            aria-current={active === 'dashboard' ? 'page' : undefined}
          >
            <NavItem
              icon={admin ? 'admin' : 'dashboard'}
              label={admin ? 'Admin' : 'Dashboard'}
              active={active === 'dashboard'}
            />
          </Link>
        )}
        {user && (owner || isCustomer(user)) && (
          <Link className="m3-nav__item" to="/plugins/workflow" aria-current={active === 'tracker' ? 'page' : undefined}>
            <NavItem icon="tracker" label="Tracker" active={active === 'tracker'} />
          </Link>
        )}
        {user && !admin && canSendAlerts(user) && (
          <Link className="m3-nav__item" to="/admin/alerts" aria-current={active === 'alerts' ? 'page' : undefined}>
            <NavItem icon="alerts" label="Alerts" active={active === 'alerts'} />
          </Link>
        )}
        {!user && <NavLink to="/register" icon="register" label="Register" active={active} />}
        {user && refresh ? (
          <LogoutButton refresh={refresh} className="m3-nav__item">
            <NavItem icon="logout" label="Log out" />
          </LogoutButton>
        ) : (
          !user && <NavLink to="/login" icon="login" label="Log in" active={active} />
        )}
      </nav>
    </div>
  );
}
