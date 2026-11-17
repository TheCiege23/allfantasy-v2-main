/**
 * Builds Next.js Metadata and optional JSON-LD from SEO config.
 * Use in generateMetadata() and for injecting structured data.
 */

import type { Metadata } from "next"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"
import type { SEOPageConfig } from "./SEOPageResolver"
import { getDefaultOgImagePath } from "./SEOPageResolver"

const SITE_NAME = "AllFantasy"
const INSTALL_PATH = "/install"

interface MetadataInput extends SEOPageConfig {
  imagePath?: string
}

/** Build Next.js Metadata from SEO config. */
export function buildMetadata(input: MetadataInput): Metadata {
  const siteOrigin = getPublicSiteOrigin()
  const imagePath = input.imagePath ?? getDefaultOgImagePath()
  const imageUrl = imagePath.startsWith("http") ? imagePath : `${siteOrigin}${imagePath}`
  const canonical = input.canonical || `${siteOrigin}${INSTALL_PATH}`
  return {
    title: input.title,
    description: input.description,
    applicationName: SITE_NAME,
    category: "sports",
    keywords: input.keywords,
    alternates: input.canonical ? { canonical: input.canonical } : undefined,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: SITE_NAME,
      statusBarStyle: "black-translucent",
    },
    appLinks: {
      web: {
        url: canonical,
        should_fallback: true,
      },
    },
    openGraph: {
      title: input.title,
      description: input.description,
      url: input.canonical,
      siteName: SITE_NAME,
      type: "website",
      images: [{ url: imageUrl }],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [imageUrl],
    },
    other: {
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
      "theme-color": "#020617",
    },
    robots: input.noIndex ? { index: false, follow: true } : { index: true, follow: true },
  }
}

