/**
 * AF Legacy tab titles — the ONE place the 15 tab titles are written.
 *
 * These were authored as SEO titles and lived inside a `useEffect` in
 * app/af-legacy/page.tsx that assigned `document.title`. That is a real feature
 * for a signed-in user tabbing around the product — the browser tab label
 * follows them — but it delivers nothing to any crawler that does not execute
 * JavaScript, which is every social and link-preview scraper, and it cannot
 * reach the served HTML at all. So the served <title> for /af-legacy was the
 * ROOT LAYOUT'S homepage title, on a route published in sitemap.xml at 0.8.
 *
 * The map moved here so the page's runtime title and the route's static
 * metadata are the same strings rather than two copies that drift. The layout
 * imports LEGACY_TAB_TITLES[LEGACY_DEFAULT_TAB] for `metadata`; the page
 * imports the map for its per-tab `document.title`.
 *
 * ⚠ Every tab is a query variant of ONE path (`/af-legacy?tab=…`), and Next
 * 14.2 strips the search string when resolving `alternates`, so there is no
 * per-tab canonical to be had. The layout canonical is deliberately the bare
 * `/af-legacy`, which consolidates all 15 variants onto it. Do not try to
 * canonicalise a tab.
 */

export type LegacyTabId =
  | 'overview'
  | 'trade'
  | 'finder'
  | 'player-finder'
  | 'waiver'
  | 'rankings'
  | 'pulse'
  | 'compare'
  | 'chat'
  | 'share'
  | 'transfer'
  | 'strategy'
  | 'shop'
  | 'mock-draft'
  | 'ideas'

/** The tab rendered when `?tab=` is absent — so its title is the route's title. */
export const LEGACY_DEFAULT_TAB: LegacyTabId = 'overview'

export const LEGACY_TAB_TITLES: Record<LegacyTabId, string> = {
  overview: 'Fantasy Football Career Profile & Report Card | AllFantasy',
  trade: 'Fantasy Football Trade Analyzer (Dynasty & Redraft) | AllFantasy',
  finder: 'Fantasy Football Trade Finder Tool | Discover Winning Trades with Chimmy',
  'player-finder': 'Fantasy Football Player Finder & Value Tool | AllFantasy',
  waiver: 'Fantasy Football Waiver Wire AI | Best Pickup Suggestions',
  rankings: 'Fantasy Football League Rankings & Power Rankings | AllFantasy',
  pulse: 'Fantasy Football Market Pulse & Player Sentiment | AllFantasy',
  compare: 'Fantasy Football Player Comparison Tool | Start or Sit with Chimmy',
  chat: 'Chimmy, Your Fantasy Football Coach | Personalized Advice & Strategy',
  share: 'Share Your Fantasy Football Career Report Card | AllFantasy',
  transfer: 'Transfer Fantasy Football Leagues from Sleeper, Yahoo & More',
  strategy: 'Season Strategy Planner | Chimmy-Powered Fantasy Football Roadmap',
  shop: 'Official AllFantasy Merch | Shop AF Gear on Etsy',
  'mock-draft': 'Chimmy-Powered Mock Draft Simulator & Predict Board | AllFantasy',
  ideas: 'Submit League Ideas | AllFantasy Community',
}

/** Fallback when `activeTab` is somehow outside the union. */
export const LEGACY_FALLBACK_TITLE = 'AF Legacy | AllFantasy'

/**
 * Description for the route. Taken from what the overview tab actually renders
 * to a signed-out visitor — the hero line and the three value bullets — rather
 * than reusing AI_TOOL_PAGES['legacy-dynasty'].description, which belongs to
 * the marketing page at /tools/legacy-dynasty. Two pages sharing one
 * description is how they end up competing for the same query.
 */
export const LEGACY_DESCRIPTION =
  'Import your fantasy history and turn it into a Legacy Profile — career rank and trends, playoff and championship context, and Chimmy coaching insights.'

/**
 * Whether a raw `?tab=` value names a real tab.
 *
 * The deep-link handler in page.tsx used to carry its own inline copy of the
 * fifteen ids. Reading the map instead means a tab cannot be added to one list
 * and forgotten in the other.
 */
export function isLegacyTabId(value: string): value is LegacyTabId {
  return Object.prototype.hasOwnProperty.call(LEGACY_TAB_TITLES, value)
}
