/**
 * Social share metadata: OG image URL, share text, and share URL.
 * Used for open graph and Twitter cards and share buttons.
 */

import { getPublicSiteOrigin } from "@/lib/site-public-origin"

interface SocialShareConfig {
  url: string
  title: string
  description: string
  imageUrl: string
  twitterCard: "summary" | "summary_large_image"
}

/** Default OG image path. */
const DEFAULT_OG_IMAGE_PATH = "/og-image.jpg"

/** Build full image URL for OG/twitter. */
export function getOgImageUrl(path?: string | null): string {
  const p = path && path.trim() ? path : DEFAULT_OG_IMAGE_PATH
  const base = getPublicSiteOrigin()
  return p.startsWith("http") ? p : `${base}${p}`
}

/** Build social share config for a page. */
export function getSocialShareConfig(opts: {
  path: string
  title: string
  description: string
  imagePath?: string | null
}): SocialShareConfig {
  const base = getPublicSiteOrigin()
  const url = opts.path.startsWith("http") ? opts.path : `${base}${opts.path}`
  return {
    url,
    title: opts.title,
    description: opts.description,
    imageUrl: getOgImageUrl(opts.imagePath),
    twitterCard: "summary_large_image",
  }
}

/** Share URL for Twitter intent. */
export function getTwitterShareUrl(config: SocialShareConfig): string {
  const params = new URLSearchParams({
    text: `${config.title} – ${config.description.slice(0, 100)}`,
    url: config.url,
  })
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

/** Share URL for Facebook. */
export function getFacebookShareUrl(config: SocialShareConfig): string {
  const params = new URLSearchParams({ u: config.url })
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`
}

/** Share URL for LinkedIn. */
export function getLinkedInShareUrl(config: SocialShareConfig): string {
  const params = new URLSearchParams({
    url: config.url,
    summary: config.description,
    title: config.title,
  })
  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`
}
