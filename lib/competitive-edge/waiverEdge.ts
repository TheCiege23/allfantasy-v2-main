/**
 * Competitive Edge for a WAIVER decision — what the other managers in this league have actually
 * done on waivers this season, and how much FAAB each has left, stated as counts. Pure: the loader
 * (./waiverEdgeLoader.ts) supplies the season's winning claims and every roster's budget.
 *
 * 🛑 THE SAME CONTRACT AS THE TRADE EDGE (./tradeEdge.ts, Milestone 32):
 *   - FACTS, NEVER LABELS. "won 7 waiver claims, spending $64" — never "aggressive", "a FAAB hoarder".
 *   - NO PREDICTIONS. Nothing here says what anyone will bid next.
 *   - WINNING CLAIMS ONLY, AND IT SAYS SO. Sleeper publishes a claim once it is won; a losing bid is
 *     never recorded (SleeperHistoricalTransactionSyncService keeps completed transactions only). So
 *     "their biggest winning bid" is a fact and "their biggest bid" would not be.
 *   - THIS SEASON ONLY. A waiver row's manager is that season's Sleeper roster slot, which is the
 *     current team only for the current season — earlier seasons would credit a slot's old owner's
 *     claims to whoever holds it now.
 *   - FAAB LINES ONLY IN A FAAB LEAGUE. A rolling-priority league still carries a default budget on
 *     every roster; "$100 of FAAB left" there would be a number nobody can spend.
 */

import type { EdgeFact } from './tradeEdge'

/** Winning claims before a manager's claim pattern (positions, biggest bid) is shown. */
export const WAIVER_FLOOR = 3

export type EdgeWaiverClaim = {
  /** `LeagueTeam.externalId` — the Sleeper roster the claim was won by. */
  teamExternalId: string
  position: string | null
  /** The winning bid in FAAB dollars; null when the league does not bid. */
  bid: number | null
  atIso: string
}

export type EdgeWaiverManager = {
  teamExternalId: string
  name: string
  faabRemaining: number | null
}

export type WaiverEdgeRival = {
  manager: { name: string; teamExternalId: string }
  faabRemaining: number | null
  claims: number
  sufficient: boolean
  facts: EdgeFact[]
}

export type WaiverEdge = {
  season: number
  usesFaab: boolean
  viewer: { teamExternalId: string | null; faabRemaining: number | null }
  /** Lines about the whole league, against you — `bearsOnDeal` when they bear on your bid. */
  leagueFacts: EdgeFact[]
  /** Every other manager: most FAAB left first in a FAAB league, else most claims first. */
  rivals: WaiverEdgeRival[]
  coverage: {
    source: 'sleeper_waiver_history'
    season: number
    /** Winning claims on file for the whole league this season. */
    claims: number
    asOf: string | null
    stale: boolean
  }
}

const SKIP_POSITIONS = new Set(['', 'PICK', 'FAAB', 'UNKNOWN', 'N/A'])

function pos(p: string | null | undefined): string | null {
  const v = String(p ?? '').trim().toUpperCase()
  return v && !SKIP_POSITIONS.has(v) ? v : null
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function positionPlural(p: string): string {
  return /S$/.test(p) ? p : `${p}s`
}

function rivalFacts(
  name: string,
  mine: EdgeWaiverClaim[],
  usesFaab: boolean,
  faabRemaining: number | null,
  viewerFaab: number | null,
): EdgeFact[] {
  const facts: EdgeFact[] = []
  const n = mine.length

  if (usesFaab && faabRemaining != null) {
    const vs =
      viewerFaab == null
        ? ''
        : faabRemaining > viewerFaab
          ? ` — more than your ${money(viewerFaab)}`
          : faabRemaining < viewerFaab
            ? ` — less than your ${money(viewerFaab)}`
            : ' — the same as yours'
    facts.push({ key: 'waiver.faab_left', text: `${name} has ${money(faabRemaining)} of FAAB left${vs}.`, bearsOnDeal: true })
  }

  if (n === 0) {
    facts.push({ key: 'waiver.claims', text: `${name} hasn't won a waiver claim this season.`, bearsOnDeal: false })
    return facts
  }

  const bids = mine.map((c) => c.bid).filter((b): b is number => b != null && Number.isFinite(b))
  const spent = bids.reduce((s, b) => s + Math.max(0, b), 0)
  facts.push({
    key: 'waiver.claims',
    text: usesFaab
      ? `${name} has won ${plural(n, 'waiver claim')} this season, spending ${money(spent)} in all.`
      : `${name} has won ${plural(n, 'waiver claim')} this season.`,
    bearsOnDeal: false,
  })

  if (n < WAIVER_FLOOR) return facts

  if (usesFaab) {
    const top = [...mine].filter((c) => (c.bid ?? 0) > 0).sort((a, b) => (b.bid ?? 0) - (a.bid ?? 0))[0]
    if (top) {
      const p = pos(top.position)
      facts.push({
        key: 'waiver.biggest_bid',
        text: `Their biggest winning bid was ${money(top.bid!)}${p ? ` (${p})` : ''}.`,
        bearsOnDeal: false,
      })
    }
    const zero = mine.filter((c) => (c.bid ?? 0) === 0).length
    if (zero > 0) {
      facts.push({
        key: 'waiver.zero_bids',
        text: `${zero} of their ${n} claims ${zero === 1 ? 'was a $0 bid' : 'were $0 bids'}.`,
        bearsOnDeal: false,
      })
    }
  }

  const counts = new Map<string, number>()
  for (const c of mine) {
    const p = pos(c.position)
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  const [topPos, topCount] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0]
  if (topPos && topCount >= 2) {
    facts.push({
      key: `waiver.position.${topPos}`,
      text: `${topCount} of their ${n} claims were ${positionPlural(topPos)}.`,
      bearsOnDeal: false,
    })
  }
  return facts
}

export function buildWaiverEdge(input: {
  season: number
  usesFaab: boolean
  claims: EdgeWaiverClaim[]
  managers: EdgeWaiverManager[]
  viewerTeamExternalId: string | null
  asOf: string | null
  stale: boolean
}): WaiverEdge {
  const viewer = input.viewerTeamExternalId
    ? (input.managers.find((m) => m.teamExternalId === input.viewerTeamExternalId) ?? null)
    : null
  const viewerFaab = input.usesFaab ? (viewer?.faabRemaining ?? null) : null

  const byTeam = new Map<string, EdgeWaiverClaim[]>()
  for (const c of input.claims) {
    const list = byTeam.get(c.teamExternalId) ?? []
    list.push(c)
    byTeam.set(c.teamExternalId, list)
  }

  const rivals: WaiverEdgeRival[] = input.managers
    .filter((m) => m.teamExternalId !== input.viewerTeamExternalId)
    .map((m) => {
      const mine = byTeam.get(m.teamExternalId) ?? []
      const faab = input.usesFaab ? m.faabRemaining : null
      return {
        manager: { name: m.name, teamExternalId: m.teamExternalId },
        faabRemaining: faab,
        claims: mine.length,
        sufficient: mine.length >= WAIVER_FLOOR,
        facts: rivalFacts(m.name, mine, input.usesFaab, faab, viewerFaab),
      }
    })
    .sort((a, b) =>
      input.usesFaab
        ? (b.faabRemaining ?? -1) - (a.faabRemaining ?? -1) || b.claims - a.claims || a.manager.name.localeCompare(b.manager.name)
        : b.claims - a.claims || a.manager.name.localeCompare(b.manager.name),
    )

  const leagueFacts: EdgeFact[] = []
  if (input.usesFaab && viewerFaab != null) {
    const withBudget = rivals.filter((r) => r.faabRemaining != null)
    const more = withBudget.filter((r) => (r.faabRemaining ?? 0) > viewerFaab).length
    leagueFacts.push({
      key: 'waiver.outbid_by',
      text:
        more === 0
          ? `No other manager has more FAAB left than your ${money(viewerFaab)}.`
          : `${more} of the ${withBudget.length} other managers ${more === 1 ? 'has' : 'have'} more FAAB left than your ${money(viewerFaab)}.`,
      bearsOnDeal: true,
    })
  }
  leagueFacts.push({
    key: 'waiver.league_claims',
    text:
      input.claims.length === 0
        ? 'No winning waiver claims are on file for this league this season yet.'
        : `This league has made ${plural(input.claims.length, 'winning waiver claim')} this season.`,
    bearsOnDeal: false,
  })

  return {
    season: input.season,
    usesFaab: input.usesFaab,
    viewer: { teamExternalId: viewer?.teamExternalId ?? null, faabRemaining: viewerFaab },
    leagueFacts,
    rivals,
    coverage: {
      source: 'sleeper_waiver_history',
      season: input.season,
      claims: input.claims.length,
      asOf: input.asOf,
      stale: input.stale,
    },
  }
}
