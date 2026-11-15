/**
 * AutomatedBlogEngine — orchestrates topic planning, generation, SEO, internal links, draft, and publish.
 */

import { generateBlogDraft } from "./BlogContentGenerator"
import { createDraft, updateDraft } from "./BlogDraftWorkflowService"
import { publishArticle, scheduleArticle } from "./BlogPublishService"
import { buildBlogSEO } from "./BlogSEOMetadataBuilder"
import { suggestInternalLinks } from "./InternalLinkSuggestionService"
import type { BlogDraftInput, GeneratedDraft } from "./types"

export interface GenerateAndSaveResult {
  ok: boolean
  articleId?: string
  slug?: string
  error?: string
}

/**
 * Generate a draft with AI and save as draft article. Returns articleId and slug.
 */
export async function generateAndSaveDraft(
  input: BlogDraftInput
): Promise<GenerateAndSaveResult> {
  const draft = await generateBlogDraft(input)
  if (!draft) return { ok: false, error: "Generation failed" }

  const result = await createDraft({
    sport: input.sport,
    category: input.category,
    draft,
  })
  if (!result) return { ok: false, error: "Failed to create draft" }
  return { ok: true, articleId: result.articleId, slug: result.slug }
}

/**
 * Get SEO metadata for an article (for display or Next.js generateMetadata).
 */
export function getSEOForArticle(article: {
  title: string
  excerpt: string | null
  body: string
  sport: string
  category: string
  slug: string
  seoTitle?: string | null
  seoDescription?: string | null
}) {
  return buildBlogSEO(article)
}

/**
 * Get internal link suggestions for an article (for CMS panel or body insertion).
 */
export function getInternalLinkSuggestions(article: {
  sport: string
  category: string
  body: string
}) {
  return suggestInternalLinks(article)
}

export {
  generateBlogDraft,
  createDraft,
  updateDraft,
  publishArticle,
  scheduleArticle,
  buildBlogSEO,
  suggestInternalLinks,
}

export type { GeneratedDraft }
