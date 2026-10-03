// The last code this browser tracked successfully, kept in the "dryyt" cookie
// so the sidebar can offer a "My Track" shortcut back to /track?code=<code>.
const COOKIE = 'dryyt';
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export function getMyTrackCode(): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const code = decodeURIComponent(match.slice(COOKIE.length + 1));
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export function setMyTrackCode(code: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
}
