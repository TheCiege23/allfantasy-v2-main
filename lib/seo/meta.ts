/**
 * PROMPT 168 — SEO meta tag generation.
 * Single API for OpenGraph, canonical, and Twitter meta. Use in page metadata or generateMetadata().
 */

import type { Metadata } from 'next'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { getOgImageUrl } from './SocialShareMetadataService'
const SITE_NAME = 'AllFantasy'
const INSTALL_PATH = '/install'

export interface BuildSeoMetaInput {
  /** Page title (document and default for OG/Twitter). */
  title: string
  /** Meta description. */
  description: string
  /** Canonical path (e.g. '/ai') or full URL. Used for alternates.canonical and openGraph.url. */
  canonicalPath?: string
  /** Override: full canonical URL. If set, canonicalPath is ignored. */
  canonical?: string
  /** Optional OG title (defaults to title). */
  openGraphTitle?: string
  /** Optional OG description (defaults to description). */
  openGraphDescription?: string
  /** Optional Twitter title (defaults to title). */
  twitterTitle?: string
  /** Optional Twitter description (defaults to description). */
  twitterDescription?: string
  /** OG image path or full URL (e.g. '/og-image.jpg'). */
  imagePath?: string | null
  /** Set true to noindex (e.g. thank-you pages). */
  noIndex?: boolean
  /** Optional keywords. */
  keywords?: string[]
  /**
   * `hreflang` alternates, as language code -> path or absolute URL. Emitted as
   * `alternates.languages` alongside the canonical.
   *
   * Only set this where the SAME page is genuinely served in more than one
   * language at distinct addresses. Declaring an alternate that returns the
   * canonical language tells a crawler the two are translations of each other
   * when they are the same document, which is worse than declaring nothing.
   */
  languageAlternates?: Record<string, string>
  /** OpenGraph locale (e.g. 'es_US'). Defaults to the OG default when unset. */
  ogLocale?: string
}

/**
 * Build Next.js Metadata with OpenGraph, canonical, and Twitter.
 * Use as: export const metadata = buildSeoMeta({ title, description, canonicalPath: '/ai' })
 */
export function buildSeoMeta(input: BuildSeoMetaInput): Metadata {
  const BASE = getPublicSiteOrigin()
  const canonical =
    input.canonical ?? (input.canonicalPath ? (input.canonicalPath.startsWith('http') ? input.canonicalPath : `${BASE}${input.canonicalPath}`) : undefined)
  const ogTitle = input.openGraphTitle ?? input.title
  const ogDesc = input.openGraphDescription ?? input.description
  const twTitle = input.twitterTitle ?? input.title
  const twDesc = input.twitterDescription ?? input.description
  const imageUrl = input.imagePath ? getOgImageUrl(input.imagePath) : getOgImageUrl(null)
  const appLinkTarget = canonical ?? `${BASE}${INSTALL_PATH}`

  return {
    title: input.title,
    description: input.description,
    applicationName: SITE_NAME,
    category: 'sports',
    keywords: input.keywords,
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      title: SITE_NAME,
      statusBarStyle: 'black-translucent',
    },
    appLinks: {
      web: {
        url: appLinkTarget,
        should_fallback: true,
      },
    },
    metadataBase: new URL(BASE),
    alternates:
      canonical || input.languageAlternates
        ? {
            ...(canonical ? { canonical } : {}),
            ...(input.languageAlternates
              ? {
                  languages: Object.fromEntries(
                    Object.entries(input.languageAlternates).map(([lang, href]) => [
                      lang,
                      href.startsWith('http') ? href : `${BASE}${href}`,
                    ]),
                  ),
                }
              : {}),
          }
        : undefined,
    openGraph: {
      title: ogTitle,
      description: ogDesc,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
      ...(input.ogLocale ? { locale: input.ogLocale } : {}),
      images: [{ url: imageUrl }],
    },
    twitter: {
      card: 'summary_large_image',
      title: twTitle,
      description: twDesc,
      images: [imageUrl],
    },
    other: {
      'mobile-web-app-capable': 'yes',
      'apple-mobile-web-app-capable': 'yes',
      'theme-color': '#020617',
    },
    robots: input.noIndex ? { index: false, follow: true } : { index: true, follow: true },
  }
}
