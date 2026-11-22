/**
 * Structured data for one blog post: a BlogPosting and the Blog → post breadcrumb.
 *
 * Until this, a post carried only the site-wide Organization and WebSite JSON-LD, so nothing told a
 * search engine that the page is an article, when it was published, or what image represents it.
 *
 * Pure: the page passes in what it already loaded. The image is the post's own
 * `/blog/<slug>/opengraph-image` card, the same one link previews show.
 */

import { BLOG_CATEGORY_LABELS, type BlogCategory } from './types'

export type BlogPostingInput = {
  origin: string
  slug: string
  title: string
  description: string
  category: string
  tags: unknown
  publishedAt: Date | null
  updatedAt: Date
}

export function blogPostCanonical(origin: string, slug: string): string {
  return `${origin}/blog/${slug}`
}

export function blogPostImageUrl(origin: string, slug: string): string {
  return `${blogPostCanonical(origin, slug)}/opengraph-image`
}

function tagList(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : []
}

export function buildBlogPostingJsonLd(input: BlogPostingInput): Record<string, unknown>[] {
  const url = blogPostCanonical(input.origin, input.slug)
  const organization = {
    '@type': 'Organization',
    name: 'AllFantasy',
    url: input.origin,
    logo: { '@type': 'ImageObject', url: `${input.origin}/af-crest-transparent.png` },
  }
  const keywords = tagList(input.tags)
  const section = BLOG_CATEGORY_LABELS[input.category as BlogCategory]

  const posting: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: input.title,
    description: input.description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: [blogPostImageUrl(input.origin, input.slug)],
    // A post that went live without a publish date (never, today) falls back to its last edit.
    datePublished: (input.publishedAt ?? input.updatedAt).toISOString(),
    dateModified: input.updatedAt.toISOString(),
    author: organization,
    publisher: organization,
    ...(section ? { articleSection: section } : {}),
    ...(keywords.length > 0 ? { keywords: keywords.join(', ') } : {}),
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Blog', item: `${input.origin}/blog` },
      { '@type': 'ListItem', position: 2, name: input.title, item: url },
    ],
  }

  return [posting, breadcrumb]
}
