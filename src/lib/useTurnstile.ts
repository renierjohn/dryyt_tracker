import { useCallback, useEffect, useRef } from 'react';

// Public sitekey (safe to ship); the secret lives in the Worker as TURNSTILE_SECRET_KEY.
const SITE_KEY = '0x4AAAAAAFPUKOKS_zLsvLYz';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(window.turnstile!);
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile_load_failed'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Deferred Turnstile: the widget is rendered on mount but only runs its challenge
// once start() is called (wired to the form's first input focus). getToken() waits
// for that challenge on submit; reset() is needed after a failed request because
// tokens are single-use.
export function useTurnstile(action: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const state = useRef<{
    widgetId?: string;
    started: boolean;
    token?: string;
    waiters: { resolve: (t: string) => void; reject: (e: Error) => void }[];
  }>({ started: false, waiters: [] });

  useEffect(() => {
    const s = state.current;
    let cancelled = false;
    const settle = (token: string | null) => {
      s.token = token ?? undefined;
      const waiters = s.waiters.splice(0);
      for (const w of waiters) {
        if (token) w.resolve(token);
        else w.reject(new Error('turnstile_failed'));
      }
    };
    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        s.widgetId = api.render(containerRef.current, {
          sitekey: SITE_KEY,
          action,
          execution: 'execute',
          appearance: 'interaction-only',
          callback: (token: string) => settle(token),
          'error-callback': () => settle(null),
          'expired-callback': () => {
            s.token = undefined;
            s.started = false;
          },
        });
        if (s.started) api.execute(s.widgetId);
      })
      .catch(() => settle(null));
    return () => {
      cancelled = true;
      if (s.widgetId) window.turnstile?.remove(s.widgetId);
      s.widgetId = undefined;
      s.started = false;
      s.token = undefined;
    };
  }, [action]);

  const start = useCallback(() => {
    const s = state.current;
    if (s.started) return;
    s.started = true;
    if (s.widgetId) window.turnstile?.execute(s.widgetId);
  }, []);

  const getToken = useCallback((): Promise<string> => {
    const s = state.current;
    if (s.token) return Promise.resolve(s.token);
    start();
    return new Promise((resolve, reject) => s.waiters.push({ resolve, reject }));
  }, [start]);

  const reset = useCallback(() => {
    const s = state.current;
    s.token = undefined;
    s.started = false;
    if (s.widgetId) window.turnstile?.reset(s.widgetId);
  }, []);

  return { turnstileRef: containerRef, startTurnstile: start, getTurnstileToken: getToken, resetTurnstile: reset };
}
