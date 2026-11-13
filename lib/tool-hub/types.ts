/**
 * Tool Hub — types for tools, categories, and discovery.
 */

import type { ToolSlug } from '@/lib/seo-landing/config'

export type ToolCategoryId =
  | 'trade'
  | 'waiver'
  | 'draft'
  | 'simulate'
  | 'bracket'
  | 'rankings'
  | 'legacy'
  | 'ai'
  | 'transfer'

export type ToolCardDisplay = {
  slug: ToolSlug
  headline: string
  description: string
  openToolHref: string
  toolLandingHref: string
  category: ToolCategoryId
  categories?: ToolCategoryId[]
  icon?: string
  badge?: string
}

