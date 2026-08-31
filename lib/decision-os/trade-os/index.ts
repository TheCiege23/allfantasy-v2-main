import 'server-only'

import { loadTradeWorldFacts, loadTradeLeagueFacts } from '../trade/loader'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS, MINUTES } from '../domain-os/types'
import type { TradeWorldFacts, TradeLeagueFacts } from '../trade/loader'

/**
 * Trade OS — maintained fact state for `manager.trade.evaluate`.
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-os/*` points the other way.
 *
 * WHAT IT GATHERS, AND AT WHICH LEVEL
 *
 *   LEAGUE  trade settings and the deadline state
 *           Rules and a date. Effectively static within a season, and shared by everyone in the
 *           league — the single best caching candidate in this domain.
 *
 *   USER    the two rosters in the proposal (record, points, FAAB)
 *           Changes with every transaction, so it is held briefly.
 *
 * ⚠ TRADE IS THE HIGHEST-STAKES DOMAIN, so the TTLs here are the shortest of the three feeds.
 * Under the confirmed product direction, money and roster consequences are permanently
 * explanation-only for AI — the same caution applies to cached facts. A trade graded on a stale
 * roster is a wrong answer delivered confidently, and the deadline in particular must never be
 * served from a copy taken before it passed.
 */

export type TradeOsArgs = {
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
}

async function deriveWorldFacts(args: TradeOsArgs): Promise<TradeWorldFacts | null> {
  return loadTradeWorldFacts(args).catch(() => null)
}

/** Args for the league+season source. No roster pair, deliberately — see below. */
export type TradeLeagueOsArgs = { leagueId: string; seasonId: string }

/**
 * League rules + deadline: shared, slow, and the reason this feed is worth having.
 *
 * 🛑 THIS USED TO SHARE `deriveWorldFacts` WITH THE ROSTER SOURCE, WHICH MADE ITS `level:
 * 'league'` UNDELIVERABLE. That derive needs an ordered pair of roster ids and returns BOTH
 * sides' record, points and FAAB, so warming this entry from a scheduler meant storing two
 * specific managers' standings under a key scoped to the whole league. In the domain this file
 * itself calls "the highest-stakes", that is precisely the confidently-wrong input the short TTLs
 * here exist to prevent.
 *
 * `loadTradeLeagueFacts` derives the league+season half from two deps and no rosters.
 *
 * ⚠ SCHEDULABLE IN PRINCIPLE, NOT YET SCHEDULED, AND THE GAP IS THE SCOPE KEY. This fact is keyed
 * `${leagueId}:${seasonId}` while `/api/cron/domain-os-refresh` walks LEAGUES. Bridging that means
 * deciding which season is "current" for a league and what to do when more than one qualifies —
 * a wrong answer warms the wrong season's entry, which is worse than warming nothing. That
 * belongs in its own change with its own reasoning, not smuggled into this split.
 */
export const tradeSettingsSource: OsFactSource<TradeLeagueOsArgs, TradeLeagueFacts> = {
  kind: 'settings',
  level: 'league',
  ttlMs: 2 * HOURS,
  scopeKey: (a) => `${a.leagueId}:${a.seasonId}`,
  sport: () => 'NFL',
  derive: (a) => loadTradeLeagueFacts({ leagueId: a.leagueId, seasonId: a.seasonId }).catch(() => null),
}

/**
 * The specific pair of rosters in this proposal.
 *
 * Scoped to the ORDERED pair: a proposal from A to B is not the same fact as B to A, because the
 * roster facts are carried per side and swapping them would attribute one manager's FAAB and
 * record to the other.
 */
export const tradeRosterSource: OsFactSource<TradeOsArgs, TradeWorldFacts> = {
  kind: 'rosters',
  level: 'user',
  ttlMs: 3 * MINUTES,
  scopeKey: (a) => `${a.leagueId}:${a.proposerRosterId}>${a.receiverRosterId}`,
  sport: () => 'NFL',
  derive: deriveWorldFacts,
}

export function createTradeOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('trade', deps)
}

/**
 * Shaped for `TradeShadowDeps.loadWorldFacts`, so the feed can be adopted without touching the
 * decision path.
 *
 * ⚠ READS THROUGH THE **ROSTER** SOURCE, NOT SETTINGS, for the same reason Waiver OS reads
 * through its user entry: both sources share one `derive` and return the same whole
 * `TradeWorldFacts`, so the source chosen decides how stale the WHOLE object may be. Settings
 * lives 2h; rosters lives 3min because a roster changes the moment either side moves a player,
 * and evaluating a trade against a stale roster grades a deal that cannot be made.
 *
 * The 2h settings entry is a `refresh()` target for a scheduler that does not exist yet.
 */
export function createTradeOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createTradeOs(deps)
  return {
    loadWorldFacts: (input: TradeOsArgs) => feed.get(tradeRosterSource, input),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const tradeOsSources = [tradeSettingsSource, tradeRosterSource] as const
