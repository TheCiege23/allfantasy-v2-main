import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { buildNextGameMap, type FixtureRow } from './nextGameMap'
import { getRosteredMarket } from './rosteredMarket'
import { latestProjectionWeek, lookupProjections } from './playerProjections'
import { CROSS_LEAGUE_BOOK, valueBookFor, type ValueBook } from './valueBook'
import type { SectionState } from './leagueHome'

/**
 * The player card pop-up — STATE 6 / STATE 7 of the 2026-09-07 design handoff
 * (`AF Trade Price Transparency.dc.html`). One payload, two flavours: universal
 * (opened from anywhere outside a league) and league (opened from inside one).
 *
 * ⚠ EVERY SECTION IS A `SectionState`, AND THAT IS THE POINT OF THIS FILE. The
 * design draws a confident four-tile stat row with a trade price, two ranks and
 * an ownership percentage. Three of those four do not exist for a defender or a
 * kicker, and the fourth is computed over a sample small enough to be noise
 * early on. A card that renders `0` or `—` where it means "we never priced this
 * class of player" is the failure this codebase keeps having to undo, so each
 * section carries its own reason instead.
 *
 * ── What was measured before any of this was written (production, 2026-09-07) ─
 *
 *   PlayerValueSnapshot   18,955 rows · 16 distinct days · newest 2026-09-06
 *                         but only ~475 dynasty / ~214 redraft PLAYERS.
 *   fantasy_projections    2,558 rows — season 2026, **week 1 only**
 *   AFProjectionSnapshot  21,136 rows — likewise **one** distinct week
 *   SportsGame  sport='NFL'  857 rows, weeks 0–18, season 2026
 *   SportsNews            11,932 rows · 6,657 carrying a player name
 *   LeagueTrade           18,290 rows
 *
 * 🛑 THE PROJECTION FINDING IS WHY "NEXT 5 · PROJECTED" IS NOT BUILT AS DRAWN.
 * Both projection tables hold exactly the current week. A five-row projected
 * column would render one number and four blanks every week of the season, for
 * every player, forever. What IS on disk is the full 2026 schedule, so the
 * section ships as the next five OPPONENTS — real, and useful for exactly the
 * bye/road-trip read the design wanted — with a projection attached only to the
 * week a projection actually exists for. See `schedule` below.
 */

/* ── the payload ─────────────────────────────────────────────────────────── */

export type PlayerCardIdentity = {
  externalId: string
  sleeperId: string | null
  sport: string
  name: string
  position: string | null
  team: string | null
  number: number | null
  imageUrl: string | null
}

export type PlayerCardBio = {
  age: number | null
  height: string | null
  weight: string | null
  /** Seasons of experience. 0 is a rookie; null is "we do not know". Never conflate. */
  yearsExp: number | null
  college: string | null
}

/**
 * ⚠ THE FORMAT TRAVELS WITH THE PRICE AND THE UI MUST RENDER IT. "Worth 6,840"
 * is a fact about the superflex dynasty book, not about the world — the same
 * player is a different number in one-QB, and a materially different one in
 * redraft. A card that drops the basis turns a conditional reading into a claim
 * nobody can support. `valueBook.ts` says which book and why.
 */
export type PlayerCardMarket = {
  value: number
  overallRank: number | null
  positionRank: number | null
  /** Change against the closest snapshot to `deltaDays` before the newest one. Null when history is too short. */
  delta: { change: number; days: number } | null
  format: string
  qbFormat: string
  source: string
  capturedAt: string
}

export type PlayerCardOwnership = {
  ownPct: number
  startPct: number | null
  rosteredIn: number
  startedIn: number
  /** The denominator, and the honesty gate — see rosteredMarket.ts. */
  leaguesCounted: number
}

export type PlayerCardWeek = {
  week: number
  /** Folded club abbreviation, or null on a bye. */
  opponent: string | null
  home: boolean
  bye: boolean
  /** Only ever set for a week a projection actually exists for — see the header note. */
  projection: number | null
}

export type PlayerCardTrade = {
  transactionId: string
  platform: string
  leagueName: string | null
  tradeDate: string | null
  /** Named from our own player table; an id we cannot resolve is dropped, never printed raw. */
  acquired: string[]
  sent: string[]
  picks: string[]
}

export type PlayerCardComp = {
  sleeperId: string
  name: string
  position: string | null
  value: number
}

export type PlayerCardNews = {
  title: string
  source: string
  url: string | null
  publishedAt: string | null
}

/**
 * The tappable line at the top of the card.
 *
 * 🛑 DERIVED, NEVER GENERATED. The design shows a Decision-OS style sentence
 * ("snap share up 9% — trade price hasn't caught up"). AI spend on this repo is
 * ratcheted to zero, so every headline here is arithmetic over numbers already
 * on the card, and `basis` names the numbers it used. A sentence whose inputs a
 * reader cannot check is indistinguishable from one we invented.
 */
export type PlayerCardInsight = {
  headline: string
  detail: string
  basis: string
}

/** Everything only a league can answer. Null on the universal card. */
export type PlayerCardLeague = {
  leagueId: string
  leagueName: string
  platform: string
  /** STARTER / BENCH / IR SLOT / TAXI / NOT ROSTERED */
  slot: string
  isYours: boolean
  owner: { teamName: string | null; ownerName: string | null } | null
  /** Priced under THIS league's variant/scoring/teams, via the DB-first market value service. */
  price: SectionState<{ value: number; mode: string; numQbs: 1 | 2; teams: number }>
  /**
   * Your own players at his position in this league, richest first.
   *
   * This is the honest half of the design's "YOUR NEED FIT" tile: rather than
   * grading the fit on a scale nobody can audit, the card shows what you already
   * have and lets the reader do the comparison the grade would have hidden.
   */
  yourRoster: Array<{ name: string; value: number | null }>
  trades: PlayerCardTrade[]
}

export type PlayerCardData = {
  context: 'universal' | 'league'
  player: PlayerCardIdentity
  bio: PlayerCardBio
  market: SectionState<PlayerCardMarket>
  ownership: SectionState<PlayerCardOwnership>
  schedule: SectionState<{ weeks: PlayerCardWeek[]; season: number; projectedWeek: number | null }>
  byeWeek: number | null
  trades: SectionState<PlayerCardTrade[]>
  comps: SectionState<PlayerCardComp[]>
  news: SectionState<PlayerCardNews[]>
  insight: PlayerCardInsight | null
  league: PlayerCardLeague | null
}

/* ── tuning ──────────────────────────────────────────────────────────────── */

const SCHEDULE_WEEKS = 5
const DELTA_DAYS = 7
const COMP_COUNT = 3
const NEWS_COUNT = 3
const TRADE_COUNT = 3

/**
 * Below this many leagues an ownership percentage is noise, not a market
 * signal — one manager's decision swings it by double digits. rosteredMarket.ts
 * ships `leaguesCounted` for exactly this gate; this is a surface choosing to
 * decline rather than publish a number it cannot stand behind.
 */
const MIN_LEAGUES_FOR_OWNERSHIP = 8

/**
 * 🛑 UPPERCASE, AND THIS COST A REAL DETOUR. `SportsGame.sport` stores `'NFL'`;
 * a lowercase `'nfl'` filter returns ZERO rows and reads exactly like "no
 * schedule has ever been ingested" — which is the wrong conclusion about a table
 * holding all 272 regular-season fixtures. Every other core module spells it
 * lowercase, so the mistake is the natural one to make.
 */
const SCHEDULE_SPORT = 'NFL'

/**
 * The book used when NO league is in context.
 *
 * 🛑 THIS FILE USED TO PIN `DYNASTY / SUPERFLEX` FOR EVERY READ, INCLUDING THE
 * LEAGUE FLAVOUR, AND THAT WAS WRONG FOR A REDRAFT LEAGUE. The pin existed for a
 * real reason — so this card could not quote a different number than the Trades
 * screen for the same player — and it achieved that by making all three surfaces
 * wrong together. The shared derivation in `valueBook.ts` keeps them consistent
 * AND correct: a league gets its own book, and only the league-less universal
 * card falls back to the stated default below, which it renders on screen.
 */
const UNIVERSAL_BOOK = CROSS_LEAGUE_BOOK

/* ── helpers ─────────────────────────────────────────────────────────────── */

function unavailable(reason: string): { available: false; reason: string } {
  return { available: false, reason }
}

/** Positions FantasyCalc does not publish. Named so the card can say WHY, not just fail. */
const UNPRICED_POSITIONS = new Set(['K', 'DEF', 'DST', 'D/ST', 'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'EDGE'])

function isUnpriced(position: string | null): boolean {
  return position != null && UNPRICED_POSITIONS.has(position.toUpperCase())
}

/* ── market: price, ranks, and a real delta ──────────────────────────────── */

/**
 * Price + ranks + the 7-day move, from `PlayerValueSnapshot`.
 *
 * The delta is computed against the snapshot CLOSEST to `DELTA_DAYS` before the
 * newest one, not against "the row 7 rows back" — captures are not evenly
 * spaced (16 distinct days across 18,955 rows), so counting rows would silently
 * compare a 4-day move against an 11-day one and label both "7d".
 */
async function loadMarket(
  sleeperId: string | null,
  position: string | null,
  book: ValueBook
): Promise<SectionState<PlayerCardMarket>> {
  const { format, qbFormat } = book
  if (!sleeperId) {
    return unavailable('No Sleeper id on file for this player, so no market row can be matched.')
  }

  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: { sleeperId, source: book.source, format, qbFormat },
      orderBy: { capturedAt: 'desc' },
      take: 40,
      select: { value: true, overallRank: true, positionRank: true, capturedAt: true, source: true },
    })
    .catch(() => [])

  if (rows.length === 0) {
    return unavailable(
      isUnpriced(position)
        ? 'FantasyCalc publishes no value for kickers or defenders, so this player has no market price.'
        : 'No market snapshot on file for this player.'
    )
  }

  const newest = rows[0]!
  const target = newest.capturedAt.getTime() - DELTA_DAYS * 86_400_000

  let prior: (typeof rows)[number] | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const r of rows.slice(1)) {
    const gap = Math.abs(r.capturedAt.getTime() - target)
    if (gap < bestGap) {
      bestGap = gap
      prior = r
    }
  }

  // A "7d" label on a 2-day comparison is a small lie that compounds; only
  // claim the delta when a snapshot actually sits near the window.
  const priorDays = prior ? Math.round((newest.capturedAt.getTime() - prior.capturedAt.getTime()) / 86_400_000) : 0
  const delta =
    prior && priorDays >= 3 ? { change: newest.value - prior.value, days: priorDays } : null

  return {
    available: true,
    data: {
      value: newest.value,
      overallRank: newest.overallRank,
      positionRank: newest.positionRank,
      delta,
      format,
      qbFormat,
      source: newest.source,
      capturedAt: newest.capturedAt.toISOString(),
    },
  }
}

/* ── comps: who else costs about this much ───────────────────────────────── */

async function loadComps(
  sleeperId: string,
  value: number,
  format: string,
  qbFormat: string,
  capturedAt: string
): Promise<SectionState<PlayerCardComp[]>> {
  // Same capture instant on both sides, or the comparison drifts across days.
  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: {
        source: 'FANTASYCALC',
        format,
        qbFormat,
        capturedAt: new Date(capturedAt),
        NOT: { sleeperId },
      },
      select: { sleeperId: true, name: true, position: true, value: true },
    })
    .catch(() => [])

  if (rows.length === 0) return unavailable('No other players priced in this capture.')

  const near = rows
    .map((r) => ({ ...r, gap: Math.abs(r.value - value) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, COMP_COUNT)
    .map((r) => ({ sleeperId: r.sleeperId, name: r.name, position: r.position, value: r.value }))

  return near.length > 0 ? { available: true, data: near } : unavailable('No comparable prices found.')
}

/* ── schedule: real opponents, honest projections ────────────────────────── */

/**
 * The next `SCHEDULE_WEEKS` fixtures for this player's club.
 *
 * ⚠ A CLUB ABSENT FROM A WEEK IS ON BYE — but only when the week has fixtures at
 * all. An un-ingested week and a bye look identical from one club's row, so a
 * week with no fixtures for ANYBODY is skipped rather than reported as a bye.
 * `buildNextGameMap` does the four-rows-per-fixture reconciliation.
 */
async function loadSchedule(
  team: string | null,
  season: number,
  fromWeek: number,
  projectedWeek: number | null,
  projection: number | null
): Promise<{ schedule: SectionState<{ weeks: PlayerCardWeek[]; season: number; projectedWeek: number | null }>; byeWeek: number | null }> {
  const club = normalizeTeamAbbrev(team)
  if (!club) {
    return {
      schedule: unavailable('No club on file for this player, so his fixtures cannot be looked up.'),
      byeWeek: null,
    }
  }

  const lastWeek = fromWeek + SCHEDULE_WEEKS - 1
  const games = await prisma.sportsGame
    .findMany({
      where: {
        sport: SCHEDULE_SPORT,
        season,
        week: { gte: fromWeek, lte: lastWeek },
        OR: [{ seasonType: 'regular' }, { seasonType: null }],
      },
      select: { homeTeam: true, awayTeam: true, startTime: true, seasonType: true, venue: true, week: true },
    })
    .catch(() => [] as Array<FixtureRow & { week: number | null }>)

  if (games.length === 0) {
    return { schedule: unavailable('No fixtures on file for these weeks.'), byeWeek: null }
  }

  const only = new Set([club])
  const weeks: PlayerCardWeek[] = []
  let bye: number | null = null

  for (let w = fromWeek; w <= lastWeek; w += 1) {
    const inWeek = games.filter((g) => g.week === w)
    if (inWeek.length === 0) continue // week not ingested — not a bye claim

    const found = buildNextGameMap(inWeek, only).get(club)
    if (found) {
      weeks.push({
        week: w,
        opponent: found.opponent,
        home: found.home,
        bye: false,
        projection: projectedWeek === w ? projection : null,
      })
    } else {
      if (bye == null) bye = w
      weeks.push({ week: w, opponent: null, home: false, bye: true, projection: null })
    }
  }

  if (weeks.length === 0) return { schedule: unavailable('No fixtures on file for these weeks.'), byeWeek: null }
  return { schedule: { available: true, data: { weeks, season, projectedWeek } }, byeWeek: bye }
}

/* ── trades ──────────────────────────────────────────────────────────────── */

/**
 * Trades that moved this player, across the leagues AllFantasy has imported.
 *
 * ⚠ NOT A GLOBAL MARKET FEED, AND THE CARD SAYS SO. These are our own imported
 * leagues' transactions. That is a real and useful signal — it is what people
 * actually paid — but "leaguewide" in the design means the whole sport, and this
 * is not that.
 *
 * ⚠ EVERY TRADE IS STORED TWICE, ONCE PER SIDE. Both rows carry the same
 * `transactionId` with `playersGiven`/`playersReceived` mirrored, so an
 * un-deduped list shows each trade as two contradictory events. Measured on
 * production: the newest pair is literally `["12484"]→["2133"]` and
 * `["2133"]→["12484"]`.
 */
async function loadTrades(sleeperId: string | null, leagueId?: string): Promise<SectionState<PlayerCardTrade[]>> {
  if (!sleeperId) return unavailable('No Sleeper id on file, so trades cannot be matched to this player.')

  const rows = await prisma.leagueTrade
    .findMany({
      where: {
        OR: [
          { playersGiven: { array_contains: sleeperId } },
          { playersReceived: { array_contains: sleeperId } },
        ],
        ...(leagueId ? { history: { sleeperLeagueId: leagueId } } : {}),
      },
      orderBy: { tradeDate: 'desc' },
      take: TRADE_COUNT * 4, // headroom for the two-rows-per-trade fold
      select: {
        transactionId: true,
        platform: true,
        tradeDate: true,
        playersGiven: true,
        playersReceived: true,
        picksGiven: true,
        picksReceived: true,
        history: { select: { sleeperLeagueId: true } },
      },
    })
    .catch(() => [])

  if (rows.length === 0) return unavailable('No trade involving this player in the leagues we hold.')

  const seen = new Set<string>()
  const folded = rows.filter((r) => {
    if (seen.has(r.transactionId)) return false
    seen.add(r.transactionId)
    return true
  })

  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []

  // Resolve every referenced id to a name in ONE query — an id printed raw
  // ("Traded for 2133") is worse than saying nothing.
  const referenced = [...new Set(folded.flatMap((r) => [...ids(r.playersGiven), ...ids(r.playersReceived)]))]
  const named = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: referenced } },
      distinct: ['sleeperId'],
      orderBy: [{ sleeperId: 'asc' }, { fetchedAt: 'desc' }],
      select: { sleeperId: true, name: true },
    })
    .catch(() => [])
  const nameOf = new Map(named.flatMap((p) => (p.sleeperId ? [[p.sleeperId, p.name] as const] : [])))

  // ⚠ `League` keys the provider's id as `platformLeagueId`; only
  // `LeagueTradeHistory` calls it `sleeperLeagueId`. Joining on the name the
  // trade table uses would not compile, and joining on the wrong one silently
  // returns no league names at all.
  const leagueIds = [...new Set(folded.map((r) => r.history?.sleeperLeagueId).filter((x): x is string => !!x))]
  const leagues = leagueIds.length
    ? await prisma.league
        .findMany({ where: { platformLeagueId: { in: leagueIds } }, select: { platformLeagueId: true, name: true } })
        .catch(() => [])
    : []
  const leagueName = new Map(leagues.map((l) => [l.platformLeagueId, l.name] as const))

  const pickLabels = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.flatMap((p) => {
          if (!p || typeof p !== 'object') return []
          const o = p as Record<string, unknown>
          const season = o.season == null ? null : String(o.season)
          const round = o.round == null ? null : Number(o.round)
          if (!season || !round) return []
          const suffix = round === 1 ? 'st' : round === 2 ? 'nd' : round === 3 ? 'rd' : 'th'
          return [`${season} ${round}${suffix}`]
        })
      : []

  const out: PlayerCardTrade[] = folded.slice(0, TRADE_COUNT).map((r) => {
    /*
     * Orient the row so it reads from the perspective of the side that GOT him.
     *
     * ⚠ THIS IS ALSO WHAT MAKES THE DEDUPE ABOVE SAFE, and it is worth stating
     * because the mirrors tie on `tradeDate`, so WHICH of the two rows survives
     * `folded` is not deterministic. It does not matter here: orientation is
     * decided by which side the SUBJECT is on, not by which row won. Mirror A
     * (given [X], received [him]) and mirror B (given [him], received [X]) both
     * yield acquired=[him], sent=[X].
     *
     * A surface that instead rendered "side 1 vs side 2" WOULD be affected —
     * see `lib/core-app/trades.ts`, which orders by `historyId` before grouping
     * for exactly that reason.
     */
    const gave = ids(r.playersGiven)
    const gotHim = ids(r.playersReceived).includes(sleeperId)
    const acquiredIds = gotHim ? ids(r.playersReceived) : gave
    const sentIds = gotHim ? gave : ids(r.playersReceived)

    return {
      transactionId: r.transactionId,
      platform: r.platform,
      leagueName: r.history?.sleeperLeagueId ? (leagueName.get(r.history.sleeperLeagueId) ?? null) : null,
      tradeDate: r.tradeDate ? r.tradeDate.toISOString() : null,
      acquired: acquiredIds.flatMap((id) => (nameOf.has(id) ? [nameOf.get(id)!] : [])),
      sent: sentIds.flatMap((id) => (nameOf.has(id) ? [nameOf.get(id)!] : [])),
      picks: [...pickLabels(r.picksGiven), ...pickLabels(r.picksReceived)],
    }
  })

  return { available: true, data: out }
}

/* ── news ────────────────────────────────────────────────────────────────── */

async function loadNews(name: string, sport: string): Promise<SectionState<PlayerCardNews[]>> {
  const rows = await prisma.sportsNews
    .findMany({
      where: {
        sport: { equals: sport, mode: 'insensitive' },
        OR: [{ playerName: { equals: name, mode: 'insensitive' } }, { playerNames: { has: name } }],
      },
      orderBy: { publishedAt: 'desc' },
      take: NEWS_COUNT,
      select: { title: true, source: true, sourceUrl: true, publishedAt: true },
    })
    .catch(() => [])

  if (rows.length === 0) return unavailable('No recent item mentions this player.')

  return {
    available: true,
    data: rows.map((r) => ({
      title: r.title,
      source: r.source,
      url: r.sourceUrl,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    })),
  }
}

/* ── the insight line ────────────────────────────────────────────────────── */

/**
 * The card's one sentence, derived from the card's own numbers.
 *
 * Ordered by how much the reader can act on it, and it returns null rather than
 * reaching for a weaker fact — a card with no line is better than a line that
 * says nothing. `basis` names the inputs so the claim is checkable.
 */
export function deriveInsight(args: {
  name: string
  market: SectionState<PlayerCardMarket>
  ownership: SectionState<PlayerCardOwnership>
  byeWeek: number | null
  comps: SectionState<PlayerCardComp[]>
}): PlayerCardInsight | null {
  const { market, ownership, byeWeek, comps } = args
  const last = args.name.trim().split(/\s+/).slice(-1)[0] ?? args.name

  if (market.available && market.data.delta && market.data.delta.change !== 0) {
    const d = market.data.delta
    const up = d.change > 0
    const pct = market.data.value - d.change !== 0 ? Math.abs(d.change / (market.data.value - d.change)) * 100 : 0
    if (pct >= 3) {
      return {
        headline: `${last}'s price is ${up ? 'up' : 'down'} ${Math.abs(d.change).toLocaleString()} over ${d.days} days.`,
        detail: up
          ? `He now prices at ${market.data.value.toLocaleString()}, a ${pct.toFixed(1)}% rise. If you are buying, the window that existed ${d.days} days ago has already closed.`
          : `He now prices at ${market.data.value.toLocaleString()}, a ${pct.toFixed(1)}% fall. A dip this size is a buy window if you believe the role is intact.`,
        basis: `${market.data.format.toLowerCase()} · ${market.data.qbFormat === 'SUPERFLEX' ? 'superflex' : '1QB'} · ${market.data.source.toLowerCase()} snapshots ${d.days} days apart`,
      }
    }
  }

  if (
    ownership.available &&
    ownership.data.leaguesCounted >= MIN_LEAGUES_FOR_OWNERSHIP &&
    ownership.data.startPct != null
  ) {
    const own = Math.round(ownership.data.ownPct * 100)
    const start = Math.round(ownership.data.startPct * 100)
    if (own >= 50 && start <= 60) {
      return {
        headline: `Rostered in ${own}% of our leagues but started in only ${start}% of them.`,
        detail: `${ownership.data.rosteredIn} of ${ownership.data.leaguesCounted} leagues hold him and ${ownership.data.startedIn} start him. Managers are hedging — which is what a buy-low looks like before the price moves.`,
        basis: `own% and start% across ${ownership.data.leaguesCounted} AllFantasy leagues`,
      }
    }
  }

  if (byeWeek != null) {
    return {
      headline: `Bye in week ${byeWeek} — check it against your own before you trade for him.`,
      detail: `He does not play in week ${byeWeek}. A bye that collides with the rest of your starters at this position is the cost that never shows up in a trade grade.`,
      basis: `2026 schedule, club absent from week ${byeWeek} fixtures`,
    }
  }

  if (comps.available && comps.data.length > 0) {
    const names = comps.data.map((c) => c.name).join(', ')
    return {
      headline: `Priced alongside ${names}.`,
      detail: `Those are the closest prices in the same capture. If you would not make the swap straight across, the market disagrees with you about one of them.`,
      basis: 'nearest values in the same market snapshot',
    }
  }

  return null
}

/* ── league context ──────────────────────────────────────────────────────── */

const SLOT_KEYS = ['starters', 'reserve', 'taxi', 'players'] as const

function slotOf(pd: Record<string, unknown>, id: string): string | null {
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
  if (ids(pd.starters).includes(id)) return 'STARTER'
  if (ids(pd.reserve).includes(id)) return 'IR SLOT'
  if (ids(pd.taxi).includes(id)) return 'TAXI'
  if (ids(pd.players).includes(id)) return 'BENCH'
  return null
}

export { SLOT_KEYS }

/**
 * The league half of the card: who holds him here, what he costs under THIS
 * league's settings, what you already have at the position, and this league's
 * own trade history for him.
 *
 * ⚠ THE PRICE IS RE-DERIVED, NOT REUSED. The universal tile is a FantasyCalc
 * dynasty/1QB snapshot; this one asks `getMarketValues` for the league's actual
 * variant, scoring and size. In a superflex league those two numbers are not
 * close, and showing the universal one under a "LEAGUE PRICE" label would be a
 * plain falsehood rather than a rounding error.
 */
async function loadLeague(
  leagueId: string,
  sleeperId: string | null,
  position: string | null,
  userId: string | null,
  book: ValueBook
): Promise<PlayerCardLeague | null> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { id: true, name: true, platform: true, settings: true, leagueType: true, platformLeagueId: true },
    })
    .catch(() => null)
  if (!league) return null

  const [rosters, teams] = await Promise.all([
    prisma.roster
      .findMany({ where: { leagueId }, select: { id: true, playerData: true, platformUserId: true } })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: { externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true, teamName: true },
      })
      .catch(() => []),
  ])

  /*
   * ⚠ OWNERSHIP RESOLVES FROM THE ROSTER, NOT FROM THE TEAM ROW, and the team
   * row is joined afterwards only for a name — the same rule playerLeagueView
   * states. `LeagueTeam` is the import's list of managers; `Roster.playerData`
   * is who actually holds whom.
   */
  let slot = 'NOT ROSTERED'
  let holderKey: string | null = null
  if (sleeperId) {
    for (const r of rosters) {
      const found = slotOf((r.playerData ?? {}) as Record<string, unknown>, sleeperId)
      if (found) {
        slot = found
        holderKey = r.platformUserId
        break
      }
    }
  }

  /*
   * ⚠ THE SAME THREE-CANDIDATE PREDICATE EVERY OTHER OWNERSHIP READ HERE USES.
   * `LeagueTeam` carries no `userId` column — the claim lives on
   * `claimedByUserId`, and a roster is matched to a team through EITHER
   * `platformUserId` or `externalId` because imports populate them
   * inconsistently. Inventing a `userId` join here would have compiled against
   * nothing and silently called every card "not yours".
   */
  const yours = userId ? (teams.find((t) => t.claimedByUserId === userId) ?? null) : null
  const yourIds = new Set(
    [yours?.platformUserId, yours?.externalId, userId].filter((x): x is string => Boolean(x))
  )
  const team = holderKey
    ? (teams.find((t) => t.platformUserId === holderKey || t.externalId === holderKey) ?? null)
    : null
  const isYours = holderKey != null && yourIds.has(holderKey)

  // League-context price. `marketContextFor` lives in playerTradeVisual, which
  // also pulls the trade ENGINE — imported lazily so opening a card never drags
  // the grading path in behind it.
  let price: PlayerCardLeague['price'] = unavailable('No market values for this league configuration.')
  if (sleeperId) {
    try {
      const [{ marketContextFor }, { getMarketValues, playerValue }] = await Promise.all([
        import('./playerTradeVisual'),
        import('@/lib/trade-intel/marketValueService'),
      ])
      const ctx = marketContextFor(league.settings, league.leagueType, rosters.length || 12)
      const values = await getMarketValues(ctx)
      const v = values ? playerValue(values, sleeperId) : null
      if (values && v != null) {
        price = {
          available: true,
          data: {
            value: v,
            mode: values.mode,
            numQbs: values.numQbs,
            teams: ctx.teams,
          },
        }
      } else if (values) {
        price = unavailable(
          isUnpriced(position)
            ? 'No published value for kickers or defenders in this format.'
            : 'This player is not in the value set for this league format.'
        )
      }
    } catch {
      price = unavailable('League values could not be read.')
    }
  }

  // Your own players at his position — the auditable half of "need fit".
  let yourRoster: PlayerCardLeague['yourRoster'] = []
  if (yourIds.size > 0 && position) {
    const mine = rosters.find((r) => yourIds.has(r.platformUserId))
    if (mine) {
      const pd = (mine.playerData ?? {}) as Record<string, unknown>
      const all = [...new Set(SLOT_KEYS.flatMap((k) => {
        const v = pd[k]
        return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
      }))].filter((id) => id !== sleeperId)

      if (all.length > 0) {
        const samePos = await prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: all }, position: { equals: position, mode: 'insensitive' } },
            distinct: ['sleeperId'],
            orderBy: [{ sleeperId: 'asc' }, { fetchedAt: 'desc' }],
            select: { sleeperId: true, name: true },
          })
          .catch(() => [])

        const prices = samePos.length
          ? await prisma.playerValueSnapshot
              .findMany({
                where: {
                  sleeperId: { in: samePos.flatMap((p) => (p.sleeperId ? [p.sleeperId] : [])) },
                  source: book.source,
                  format: book.format,
                  qbFormat: book.qbFormat,
                },
                orderBy: { capturedAt: 'desc' },
                distinct: ['sleeperId'],
                select: { sleeperId: true, value: true },
              })
              .catch(() => [])
          : []
        const priceOf = new Map(prices.map((p) => [p.sleeperId, p.value] as const))

        yourRoster = samePos
          .map((p) => ({ name: p.name, value: p.sleeperId ? (priceOf.get(p.sleeperId) ?? null) : null }))
          .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
          .slice(0, 5)
      }
    }
  }

  const leagueTrades = league.platformLeagueId ? await loadTrades(sleeperId, league.platformLeagueId) : null

  return {
    leagueId: league.id,
    leagueName: league.name ?? 'This league',
    platform: league.platform,
    slot,
    isYours,
    owner: team ? { teamName: team.teamName, ownerName: team.ownerName } : null,
    price,
    yourRoster,
    trades: leagueTrades?.available ? leagueTrades.data : [],
  }
}

/* ── entry point ─────────────────────────────────────────────────────────── */

export type PlayerCardRequest = {
  sport: string
  /** `SportsPlayer.externalId`. Unique only WITHIN a sport, which is why sport is required. */
  externalId?: string | null
  sleeperId?: string | null
  /** Present → the league flavour of the card. */
  leagueId?: string | null
  userId?: string | null
}

/**
 * Assemble the card.
 *
 * Every section is loaded concurrently and every loader swallows its own
 * failure into an unavailable reason, so one cold table cannot blank the card —
 * the modal has to render something the moment it opens.
 */
export async function getPlayerCard(req: PlayerCardRequest): Promise<PlayerCardData | null> {
  const sport = req.sport.trim()
  if (!sport) return null
  if (!req.externalId && !req.sleeperId) return null

  const player = await prisma.sportsPlayer
    .findFirst({
      where: {
        sport: { equals: sport, mode: 'insensitive' },
        ...(req.externalId
          ? { externalId: req.externalId }
          : { sleeperId: { equals: req.sleeperId!, mode: 'insensitive' } }),
      },
      // Newest row wins: the same player arrives from several providers.
      orderBy: [{ fetchedAt: 'desc' }],
      select: {
        externalId: true,
        sleeperId: true,
        sport: true,
        name: true,
        position: true,
        team: true,
        number: true,
        imageUrl: true,
        age: true,
        height: true,
        weight: true,
        yearsExp: true,
        college: true,
      },
    })
    .catch(() => null)

  if (!player) return null

  const identity: PlayerCardIdentity = {
    externalId: player.externalId,
    sleeperId: player.sleeperId,
    sport: player.sport,
    name: player.name,
    position: player.position,
    team: player.team,
    number: player.number,
    imageUrl: player.imageUrl,
  }

  const projWeek = await latestProjectionWeek().catch(() => null)

  /*
   * ⚠ THE BOOK IS RESOLVED BEFORE ANYTHING IS PRICED, and that ordering is the
   * point rather than an optimisation. `market` supplies OVERALL RK and POS RK,
   * which are properties of a BOOK — a player is not "#31 overall" full stop, he
   * is #31 in dynasty superflex and a different number in redraft. Loading the
   * ranks in parallel with the league (as this first did) meant the league card
   * showed a league-correct price beside two ranks from the wrong book, which is
   * a subtler version of the bug being fixed.
   *
   * One extra small query when a league is in context; nothing when it is not.
   */
  const leagueBookRow = req.leagueId
    ? await prisma.league
        .findUnique({ where: { id: req.leagueId }, select: { settings: true, leagueType: true } })
        .catch(() => null)
    : null
  const book = leagueBookRow
    ? valueBookFor(leagueBookRow.settings, leagueBookRow.leagueType)
    : UNIVERSAL_BOOK

  const [market, ownershipBoard, projections, news, trades, league] = await Promise.all([
    loadMarket(player.sleeperId, player.position, book),
    getRosteredMarket({ sport: 'NFL', dynastyOnly: null }).catch(() => null),
    player.sleeperId && projWeek
      ? lookupProjections([player.sleeperId], projWeek, null, player.sport).catch(() => new Map())
      : Promise.resolve(new Map()),
    loadNews(player.name, player.sport),
    loadTrades(player.sleeperId),
    req.leagueId
      ? loadLeague(req.leagueId, player.sleeperId, player.position, req.userId ?? null, book).catch(() => null)
      : Promise.resolve(null),
  ])

  const own = ownershipBoard && player.sleeperId ? ownershipBoard.byPlayerId.get(player.sleeperId) : undefined
  const ownership: SectionState<PlayerCardOwnership> = !ownershipBoard
    ? unavailable('Ownership could not be read.')
    : ownershipBoard.leaguesCounted < MIN_LEAGUES_FOR_OWNERSHIP
      ? unavailable(
          `Only ${ownershipBoard.leaguesCounted} leagues imported — too few for an ownership rate to mean anything yet.`
        )
      : own
        ? { available: true, data: { ...own, leaguesCounted: ownershipBoard.leaguesCounted } }
        : {
            available: true,
            data: {
              ownPct: 0,
              startPct: null,
              rosteredIn: 0,
              startedIn: 0,
              leaguesCounted: ownershipBoard.leaguesCounted,
            },
          }

  const projected = player.sleeperId ? (projections.get(player.sleeperId)?.projectedPoints ?? null) : null

  const { schedule, byeWeek } = await loadSchedule(
    player.team,
    projWeek ? Number(projWeek.season) : new Date().getFullYear(),
    projWeek ? projWeek.week : 1,
    projWeek ? projWeek.week : null,
    projected
  )

  const comps =
    market.available && player.sleeperId
      ? await loadComps(
          player.sleeperId,
          market.data.value,
          market.data.format,
          market.data.qbFormat,
          market.data.capturedAt
        )
      : unavailable('No price for this player, so there is nothing to compare against.')

  return {
    context: league ? 'league' : 'universal',
    player: identity,
    bio: {
      age: player.age,
      height: player.height,
      weight: player.weight,
      yearsExp: player.yearsExp,
      college: player.college,
    },
    market,
    ownership,
    schedule,
    byeWeek,
    trades,
    comps,
    news,
    insight: deriveInsight({ name: player.name, market, ownership, byeWeek, comps }),
    league,
  }
}
