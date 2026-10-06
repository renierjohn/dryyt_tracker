// Keep in sync with worker/socialLinks.ts.
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
export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  viber: 'Viber',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  website: 'Website',
};
