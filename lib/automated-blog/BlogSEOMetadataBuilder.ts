/**
 * BlogSEOMetadataBuilder — builds SEO title, description, and heading structure for blog articles.
 * Ensures meta descriptions and titles are within length limits; supports canonical.
 */

import { getPublicSiteOrigin } from '@/lib/site-public-origin'

/*
 * ⚠ THE APEX WAS HARDCODED, AND THIS BUILDS THE CANONICAL FOR EVERY BLOG
 * ARTICLE. app/sitemap.xml/route.ts publishes articles on www via
 * getPublicSiteOrigin(), and the apex 307s to www — so each article told
 * crawlers its canonical was a URL that redirects, contradicting the sitemap
 * entry that led them there. Articles are the blog's actual ranking content,
 * so this was the costliest place left for it.
 *
 * Fifth file in this class: 39ab1f8 fixed 17, d662343a fixed four more under
 * lib/seo-landing, and this one hid behind the same `BASE` name.
 */
const BASE = getPublicSiteOrigin()
const SITE_NAME = "AllFantasy"

export interface BlogSEOInput {
  title: string
  excerpt: string | null
  body: string
  sport: string
  category: string
  slug: string
}

export interface BlogSEOMetadata {
  title: string
  description: string
  canonical: string
  ogTitle: string
  ogDescription: string
  keywords: string[]
}

const TITLE_MAX = 60
const DESC_MAX = 160

export function buildBlogSEO(input: BlogSEOInput): BlogSEOMetadata {
  const title = (input.title || "Blog").trim().slice(0, TITLE_MAX)
  const descRaw = (input.excerpt || input.body || "").trim().replace(/\s+/g, " ")
  const description = descRaw.slice(0, DESC_MAX)
  const canonical = `${BASE}/blog/${input.slug}`

  const keywords = [
    "fantasy sports",
    input.sport,
    input.category.replace(/_/g, " "),
    "AllFantasy",
  ].filter(Boolean)

  return {
    title: title ? `${title} | ${SITE_NAME} Blog` : `${SITE_NAME} Blog`,
    description: description || `Fantasy sports article: ${input.category}.`,
    canonical,
    ogTitle: title || SITE_NAME,
    ogDescription: description,
    keywords,
  }
}

/**
 * Ensure heading structure in body: at least one h1 or first heading as h2.
 * Does not mutate; returns suggestion or empty.
 */
export function suggestHeadingStructure(body: string): string | null {
  const hasH1 = /^#\s/m.test(body) || /<h1>/i.test(body)
  if (hasH1) return null
  const firstLine = body.split("\n")[0]?.trim()
  if (firstLine && !/^#+\s/.test(firstLine)) return "Consider adding a single # heading at the top."
  return null
}
