// Social media links on a user's profile, stored as JSON in users.social_links.
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'tiktok',
  'x',
  'youtube',
  'linkedin',
  'viber',
  'whatsapp',
  'telegram',
  'website',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

export const MAX_SOCIAL_LINKS = 10;
const MAX_URL_LENGTH = 500;

// Validates and normalizes the request's links: platform from the list, URL
// http(s) only (a bare "facebook.com/x" gets https://), blank rows dropped.
// Returns null when anything is invalid.
export function parseSocialLinks(raw: unknown): SocialLink[] | null {
  if (!Array.isArray(raw)) return null;
  const links: SocialLink[] = [];
  for (const item of raw) {
    const platform = (item as { platform?: unknown })?.platform;
    const rawUrl = (item as { url?: unknown })?.url;
    if (typeof rawUrl !== 'string' || typeof platform !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) continue;
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) return null;
    const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return null;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) return null;
    if (url.href.length > MAX_URL_LENGTH) return null;
    links.push({ platform: platform as SocialPlatform, url: url.href });
  }
  return links.length > MAX_SOCIAL_LINKS ? null : links;
}

export function readSocialLinks(stored: string | null): SocialLink[] {
  if (!stored) return [];
  try {
    const links = JSON.parse(stored);
    return Array.isArray(links) ? (links as SocialLink[]) : [];
  } catch {
    return [];
  }
}
