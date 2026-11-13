export const BRAND_PLATFORMS = [
  'x',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
] as const

export type BrandPlatform = (typeof BRAND_PLATFORMS)[number]

export const BRAND_POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'sent',
  'failed',
  'cancelled',
] as const

/** Platform-specific character limits used to constrain AI drafts. */
export const PLATFORM_CHAR_LIMITS: Record<BrandPlatform, number> = {
  x: 280,
  instagram: 2200,
  tiktok: 2200,
  youtube: 1000,
  linkedin: 3000,
}

/** Human label for UI rendering. */
export const PLATFORM_LABELS: Record<BrandPlatform, string> = {
  x: 'X',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
}

export type BrandDraftVariant = {
  body: string
  hashtags: string[]
  /** Character count of `body` — pre-computed so the UI doesn't have to. */
  charCount: number
  /** True when `body` is within the platform's character limit. */
  withinLimit: boolean
}
