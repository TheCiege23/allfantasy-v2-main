/**
 * BlogSEOMetadataBuilder — builds SEO title, description, and heading structure for blog articles.
 * Ensures meta descriptions and titles are within length limits; supports canonical.
 */

import { getPublicSiteOrigin } from "@/lib/site-public-origin"

const BASE = getPublicSiteOrigin()
const SITE_NAME = "AllFantasy"

export interface BlogSEOInput {
  title: string
  excerpt: string | null
  body: string
  sport: string
  category: string
  slug: string
  /** The article's stored SEO title (BlogArticle.seoTitle). Used as written when present. */
  seoTitle?: string | null
  /** The article's stored meta description (BlogArticle.seoDescription). Used when present. */
  seoDescription?: string | null
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

/**
 * Cut `text` to at most `max` characters at a WORD boundary, with an ellipsis when it was cut.
 *
 * ⚠ A plain `.slice(0, max)` was the bug: production served "…Pick a Fantasy Basketball Forma |
 * AllFantasy Blog" and a CFP description ending "how to fill yours out" with its last words gone.
 */
export function fitToWords(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ")
  if (t.length <= max) return t
  const room = t.slice(0, max - 1) // leave one character for the ellipsis
  const cut = room.lastIndexOf(" ")
  const head = (cut > max * 0.5 ? room.slice(0, cut) : room).replace(/[\s,;:–—-]+$/, "")
  return `${head}…`
}

/** Markdown (as the blog body is stored) → plain text, for a description fallback. */
function plainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*]|\d{1,3}[.)])\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * ⚠ THE STORED SEO FIELDS WIN. Every article carries `seoTitle` and `seoDescription`, written for
 * search results, and this builder used to ignore both: it rebuilt the title from the article title
 * and the description from the excerpt, each cut mid-word. Now:
 *   title        seoTitle as written; else the article title (cut at a word) + " | AllFantasy Blog"
 *   description  seoDescription; else the excerpt; else the body as plain text — cut at a word
 */
export function buildBlogSEO(input: BlogSEOInput): BlogSEOMetadata {
  const articleTitle = (input.title || "").trim()
  const storedTitle = (input.seoTitle || "").trim()
  const title = storedTitle
    ? storedTitle
    : articleTitle
      ? `${fitToWords(articleTitle, TITLE_MAX)} | ${SITE_NAME} Blog`
      : `${SITE_NAME} Blog`
  const descSource = (input.seoDescription || "").trim() || (input.excerpt || "").trim() || plainText(input.body || "")
  const description = descSource ? fitToWords(descSource, DESC_MAX) : ""
  const canonical = `${BASE}/blog/${input.slug}`

  const keywords = [
    "fantasy sports",
    input.sport,
    input.category.replace(/_/g, " "),
    "AllFantasy",
  ].filter(Boolean)

  return {
    title,
    description: description || `Fantasy sports article: ${input.category}.`,
    canonical,
    // Social cards have room for the article's own headline; no site suffix, no cut.
    ogTitle: articleTitle || SITE_NAME,
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
