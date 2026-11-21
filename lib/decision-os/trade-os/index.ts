import 'server-only'

import { loadTradeWorldFacts } from '../trade/loader'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { MINUTES } from '../domain-os/types'
import type { TradeWorldFacts } from '../trade/loader'

/**
 * Trade OS — maintained fact state for `manager.trade.evaluate`.
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-ui/*` points the other way.
 *
 * WHAT IT GATHERS, AND AT WHICH LEVEL
 *
 *   USER    the two rosters in the proposal (record, points, FAAB), with the league's trade settings
 *           and week. (The league-level settings entry was deleted 2026-11-20 — nothing read it.)
 *           Changes with every transaction, so it is held briefly.
 *
 * ⚠ TRADE IS THE HIGHEST-STAKES DOMAIN, so the TTLs here are the shortest of the three feeds.
 * Under the confirmed product direction, money and roster consequences are permanently
 * explanation-only for AI — the same caution applies to cached facts. A trade graded on a stale
 * roster is a wrong answer delivered confidently, and the deadline in particular must never be
 * served from a copy taken before it passed.
 */

type TradeOsArgs = {
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
}

async function deriveWorldFacts(args: TradeOsArgs): Promise<TradeWorldFacts | null> {
  return loadTradeWorldFacts(args).catch(() => null)
}

/*
 * 🗑 `tradeSettingsSource` (league rules + deadline, 2h, league level) was DELETED 2026-11-20. Nothing read it: the
 * proposals route reads the roster entry below, and the graded inbox grades against the canonical world, which it
 * must load live — `checkRosters` tests each offered player against `world.rosters`, so a stored world would pass a
 * player already traded away (and its Dates would not survive JSON). A league-level entry nobody reads is the waste
 * retired on 2026-09-06; the deadline in particular must never be served from a copy taken before it passed.
 */

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
  // Every sport's facts land here, so 'ALL' (2026-11-20): this column labels a row for audit and pruning only.
  sport: () => 'ALL',
  derive: deriveWorldFacts,
}

function createTradeOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('trade', deps)
}

/**
 * Shaped for `TradeShadowDeps.loadWorldFacts`, so the feed can be adopted without touching the
 * decision path.
 *
 * ⚠ THREE MINUTES, BECAUSE THE WHOLE OBJECT IS AS OLD AS ITS ROSTERS. A roster changes the moment
 * either side moves a player, and evaluating a trade against a stale roster grades a deal that
 * cannot be made.
 */
export function createTradeOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createTradeOs(deps)
  return {
    loadWorldFacts: (input: TradeOsArgs) => feed.get(tradeRosterSource, input),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const tradeOsSources = [tradeRosterSource] as const
