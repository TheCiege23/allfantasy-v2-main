/**
 * What the league rail should speculate on, and what it should stop speculating on.
 *
 * 🛑 THE RAIL'S LINKS HAVE ALWAYS "PREFETCHED", AND IT HAS ALWAYS BEEN THE WRONG THING.
 * `LeagueTabsPrewarm` already read this out of Next's source for the tab strip: a `<Link>`
 * with no explicit `prefetch` resolves to `PrefetchKind.AUTO` (`link.js`: `prefetchProp ===
 * null ? AUTO : FULL`), and AUTO on a dynamic route stops at the nearest `loading.tsx` —
 * which `/core/[[...screen]]` has. So a rail tile entering the viewport fetches the skeleton
 * the page is already showing, and warms none of the league data the click actually needs.
 *
 * ⚠ AND THE RAIL IS NOT A TAB STRIP — IT IS UNCAPPED. `page.tsx` builds it with
 * `playedLeagues.map(...)`, and one production account carries sixty-odd teams. Scrolling
 * that rail issues up to sixty speculative requests that cannot help, on the most-visited
 * surface in the product. Twelve tabs were judged too many to warm; sixty skeletons is the
 * same waste with none of the benefit.
 *
 * So the rule has two halves, and they pull in opposite directions on purpose:
 *
 *   - a SHORT rail keeps Next's automatic prefetch. The skeleton round-trip is small, it is
 *     bounded by the number of leagues, and on a touch device — where there is no hover —
 *     it is the only warming that happens at all. Turning it off there would trade a real
 *     saving for a real cost.
 *   - a LONG rail turns it off, because "bounded by the number of leagues" stops being a
 *     bound, and because a reader scrolling sixty crests is not about to open all sixty.
 *
 *   - and either way, POINTING AT a league is a statement of intent that a viewport
 *     intersection is not. That one gets a FULL prefetch, which is the only kind that warms
 *     the data.
 *
 * 🛑 NONE OF IT RUNS IN `next dev` — both paths short-circuit on
 * `process.env.NODE_ENV === "development"` (app-router.js, link.js). A dev probe of this
 * observes nothing and reads exactly like a change that does nothing, which is why the
 * decisions live here as pure functions and are tested directly.
 */

/**
 * Above this many rail tiles, automatic (viewport) prefetch is turned off.
 *
 * ⚠ A JUDGEMENT, NOT A MEASUREMENT, AND IT IS WRITTEN DOWN AS ONE. Twelve is the largest
 * rail where the worst case — every tile scrolled past — stays in the same order of
 * magnitude as the twelve tab links the page already carries. It is not derived from a
 * measured fetch cost, because that measurement cannot be taken in `next dev` (above) and
 * nobody has taken it in production.
 */
export const RAIL_AUTO_PREFETCH_LIMIT = 12

/**
 * How many leagues one mounted rail will warm on intent.
 *
 * Each is a FULL server render of `/core` for that league — the shell reads plus the home
 * loader. A reader sweeping the mouse down a long rail would otherwise order one render per
 * crest passed, which is the 244-HTTP shape this repo already has a note about.
 */
export const MAX_RAIL_WARMS = 6

/**
 * Whether Next's automatic prefetch should stay on for a rail of this length.
 *
 * Exported for the boundary test: the cost this guards against is proportional to the rail,
 * so the interesting cases are exactly at the edge.
 */
export function railAutoPrefetchEnabled(railLength: number): boolean {
  return railLength <= RAIL_AUTO_PREFETCH_LIMIT
}

/**
 * Whether to spend a FULL prefetch on the league the reader is pointing at.
 *
 * ⚠ EVERY REFUSAL HERE IS A RENDER THAT WOULD HAVE BEEN WASTED, and each is a different
 * kind of waste — re-warming the screen already open, warming the same league twice because
 * a pointer crossed it twice, sweeping past forty crests on the way to one, and spending a
 * reader's metered data on a guess. They are listed separately rather than collapsed so a
 * later change to one cannot silently remove another.
 */
export function shouldWarmRailLeague(args: {
  leagueId: string
  /** The league the page is already scoped to, if any. */
  selectedLeagueId: string | null
  /** Leagues this mounted rail has already warmed. */
  warmed: ReadonlySet<string>
  /** `navigator.connection.saveData` — the reader asked to spend less. */
  saveData: boolean
}): boolean {
  if (!args.leagueId) return false
  /* Warming the screen you are looking at is a second render of it. */
  if (args.leagueId === args.selectedLeagueId) return false
  /* A pointer crossing the same tile twice is not a second intent. */
  if (args.warmed.has(args.leagueId)) return false
  /* A sweep down the rail is not sixty intents either. */
  if (args.warmed.size >= MAX_RAIL_WARMS) return false
  /* Speculative traffic is the first thing to drop when someone is paying per megabyte. */
  if (args.saveData) return false
  return true
}
