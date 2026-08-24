import 'server-only'

import { loadTradeWorldFacts } from '../trade/loader'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS, MINUTES } from '../domain-os/types'
import type { TradeWorldFacts } from '../trade/loader'

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

/** League rules + deadline: shared, slow, and the reason this feed is worth having. */
export const tradeSettingsSource: OsFactSource<TradeOsArgs, TradeWorldFacts> = {
  kind: 'settings',
  level: 'league',
  ttlMs: 2 * HOURS,
  scopeKey: (a) => `${a.leagueId}:${a.seasonId}`,
  sport: () => 'NFL',
  derive: deriveWorldFacts,
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

export const tradeOsSources = [tradeSettingsSource, tradeRosterSource] as const
