import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../../../sdk';
import '../theme.scss';

// Routes that set document.documentElement.dataset.theme themselves: Home
// (always 'default') and the public per-owner workflow page (that owner's own
// flavor, not the viewer's). Both do it via their own async fetch, same as this
// component — two async writers on one route would be a race, not a "last one
// in the tree wins", so this component must skip those routes outright rather
// than also writing to them.
function hasOwnThemeHandling(pathname: string): boolean {
  return pathname === '/' || /^\/plugins\/workflow\/[^/]+$/.test(pathname);
}

// Mounted once at app root (see App.tsx's "app.root" PluginSlot), re-applying on
// every route change (not just once at load) so the signed-in user's effective
// flavor (their own if they're an owner, their parent owner's if they're a
// 'user' account) survives client-side navigation.
export default function ThemeApplier() {
  const location = useLocation();

  useEffect(() => {
    if (hasOwnThemeHandling(location.pathname)) return;

    let cancelled = false;
    void apiFetch<{ flavor: string }>('/plugins/theme/me')
      .then((body) => {
        if (!cancelled) document.documentElement.dataset.theme = body.flavor;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  return null;
}
