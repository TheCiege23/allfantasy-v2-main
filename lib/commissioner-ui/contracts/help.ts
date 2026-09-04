import type { CommissionerModuleId } from './navigation'
import type { CommissionerRelatedLink } from './relatedLink'

/**
 * Help & Knowledge Center's content contracts, per the approved blueprint
 * (lib/commissioner-ui/help/BLUEPRINT.md §3-4). Two distinct shapes, not
 * one — an article explains a workflow or feature, a glossary term defines
 * a single concept, different shaped questions that stay separate rather
 * than being merged into one contract.
 *
 * Both reference other modules only through `relatedModuleIds`/
 * `relatedLinks` — an id, a label, and an href back to the real thing —
 * never by embedding that module's own data. A glossary entry for "League
 * Health Score" explains the concept in prose; it never carries a live
 * score.
 */
export type CommissionerHelpCategory =
  | 'getting-started'
  | 'workflows'
  | 'glossary'
  | 'troubleshooting'
  | 'module-guide'

export interface CommissionerHelpArticleContract {
  id: string
  slug: string
  title: string
  category: CommissionerHelpCategory
  summary: string
  body: string
  relatedModuleIds?: CommissionerModuleId[]
  relatedLinks?: CommissionerRelatedLink[]
  updatedAt: string
}

/**
 * A standalone content type, not an article category — a term/definition
 * pair has no `category` of its own; the 'glossary' category above tags
 * an *article* that's about terminology as a topic (see "Commissioner OS
 * Terminology Overview" in the demo catalog), while the terms themselves
 * live in this separate, flat list.
 */
export interface CommissionerGlossaryTermContract {
  id: string
  term: string
  definition: string
  relatedModuleIds?: CommissionerModuleId[]
}
