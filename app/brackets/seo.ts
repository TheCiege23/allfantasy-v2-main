/**
 * The /brackets title and description, in one place because two files need them
 * and this audit has already caught the same string hand-copied into two config
 * files three times (/waiver-ai vs /tools/waiver-wire-advisor being the worst,
 * where they had gone byte-identical and both were in the sitemap).
 *
 * WHY TWO FILES NEED THEM, which is the whole point:
 *
 *   layout.tsx  title + description + OpenGraph, and NO canonical
 *   page.tsx    the same, PLUS canonicalPath: '/brackets'
 *
 * The canonical must sit on the page, not the layout. Next merges metadata by
 * top-level field, so a canonical declared on the layout is inherited by every
 * route beneath it — and /brackets has five: discover, join, world-cup,
 * world-cup/create, world-cup/discover. Measured when the canonical was briefly
 * on the layout, all five declared `canonical .../brackets`, including
 * /brackets/world-cup, which has its own title and its own metadata export.
 * That is 39ab1f8's defect one level down: distinct pages telling crawlers they
 * are duplicates of their parent. A missing canonical lets a page
 * self-canonicalise; a wrong one asks for the page to be dropped.
 *
 * The layout still carries OpenGraph so the subtree stops inheriting the
 * HOMEPAGE's share preview, which is what it did before any of this.
 */
export const BRACKETS_TITLE = "Bracket Pools | AllFantasy"

export const BRACKETS_DESCRIPTION =
  "Create or join bracket pools — FIFA World Cup, NBA/NHL playoffs, and more. AI analysis, live leaderboards, invite codes. Free forever."
