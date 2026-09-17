import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName } from './leagueHome'
import { NO_CAREER_FILTER, normalizeCareerSport, type CareerFilter } from './careerModel'
import type { DraftCardFact, DraftStealFact, GradedTradeFact } from './careerRecordBook'
import { describeSide, pickLabel, playerIds, tradeAssetCount, type CareerTradeEvent } from './careerTrades'
import { hasNoSignal } from '@/lib/trade-intel/tradeGradeEmail'
import type { TradeGradesPayload, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { DraftReportPayload } from '@/lib/draft-intel/draftReportService'

/**
 * Career history — the dated events behind the timeline and the trade and draft
 * halves of the record book.
 *
 * ⚠ READS CACHES AND FACT TABLES, NEVER A PROVIDER. The grade builders
 * (`sleeperTradeGradeService`, `draftReportService`) fall through to the Sleeper
 * API on a miss; this file imports their TYPES only and reads their stored
 * payloads, exactly as `leagueCareer.ts` does. A league nobody has graded yet is
 * reported as ungraded, not graded on the spot from a page render.
 *
 * ── Sources ─────────────────────────────────────────────────────────────────
 *
 *   graded trades   `trade-grades:v2:<provider league id>` — dated, named, and
 *                   net points while held. Your side is found by the claimed
 *                   team's `platformUserId`.
 *   other trades    `LeagueTrade` histories keyed on YOUR Sleeper id — every
 *                   imported Sleeper league back to 2019, named through
 *                   `PlayerIdentityMap`. Deduplicated against the graded ones on
 *                   `<season league id>:<transaction id>`, the grade cache's own key.
 *   draft picks     `DraftFact` for your claimed teams (managerId = the team's
 *                   `externalId`, historical slots already remapped).
 *   draft grades    `draft-report:v1:<provider league id>` — Sleeper only.
 */

const TRADE_GRADES_PREFIX = 'trade-grades:v2:'
const DRAFT_REPORT_PREFIX = 'draft-report:v1:'
/**
 * The timeline lists trades, it is not the provider's ledger. Measured
 * 2026-09-16: the busiest account holds 649 trades, so this cap is headroom, and
 * anything past it is counted in `tradesOmitted` rather than dropped silently.
 */
const MAX_TRADE_EVENTS = 1000

export type CareerDraftEvent = {
  season: number
  leagueName: string
  leagueKey: string
  /** Your earliest pick that draft. */
  firstPick: { round: number; pickNumber: number; player: string } | null
  picks: number
  grade: string | null
}

export type CareerHistory = {
  trades: CareerTradeEvent[]
  /** Trades the timeline did not list because the cap was reached. */
  tradesOmitted: number
  graded: GradedTradeFact[]
  /** Claimed Sleeper leagues whose trades have never been graded. */
  ungradedLeagues: number
  drafts: CareerDraftEvent[]
  draftCards: DraftCardFact[]
  steals: DraftStealFact[]
  picksOnFile: number
  /** Seasons with draft picks on file — for the completeness panel. */
  draftSeasons: number[]
  /** Seasons with any trade on file — for the completeness panel. */
  tradeSeasons: number[]
}

type LeagueMeta = {
  id: string
  name: string
  key: string
  providerId: string | null
  platform: string
  slots: Set<string>
  platformUserIds: Set<string>
}

function inEra(season: number, f: CareerFilter): boolean {
  if (f.fromSeason != null && season < f.fromSeason) return false
  if (f.toSeason != null && season > f.toSeason) return false
  return true
}

function sideAssets(side: TradeSideGrade, dir: 'in' | 'out'): string[] {
  const players = dir === 'in' ? side.playersIn : side.playersOut
  const picks = dir === 'in' ? side.picksIn : side.picksOut
  return [...players.map((p) => p.name), ...picks.map((p) => p.label)].filter(Boolean)
}

async function playerNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const out = new Map<string, string>()
  if (unique.length === 0) return out
  const rows = await prisma.playerIdentityMap
    .findMany({ where: { sleeperId: { in: unique } }, select: { sleeperId: true, canonicalName: true } })
    .catch(() => [] as Array<{ sleeperId: string | null; canonicalName: string }>)
  for (const r of rows) if (r.sleeperId) out.set(r.sleeperId, r.canonicalName)
  return out
}

export async function loadCareerHistory(
  userId: string,
  opts: {
    filter?: CareerFilter
    /** Your Sleeper ids for `LeagueTrade` histories (see `careerProfile.sleeperTradeKeys`). */
    tradeKeys: string[]
    /** Provider league id → league key, from the profile rows, to name legacy trades. */
    leagueByProvider: Map<string, { key: string; name: string; platform: string; sport: string | null }>
  },
): Promise<CareerHistory> {
  const filter = opts.filter ?? NO_CAREER_FILTER

  const claimed = await prisma.leagueTeam
    .findMany({
      where: { claimedByUserId: userId },
      select: {
        externalId: true,
        platformUserId: true,
        league: { select: { id: true, name: true, platform: true, sport: true, platformLeagueId: true } },
      },
    })
    .catch(() => [])

  const leagues = new Map<string, LeagueMeta>()
  for (const t of claimed) {
    const l = t.league
    if (!l?.id) continue
    const platform = String(l.platform ?? 'unknown').toLowerCase()
    const sport = normalizeCareerSport(l.sport ? String(l.sport) : null)
    const key = (l.name ?? '').trim().toLowerCase()
    if (filter.platform && platform !== filter.platform) continue
    if (filter.sport && sport !== filter.sport) continue
    if (filter.league && key !== filter.league) continue
    const meta = leagues.get(l.id) ?? {
      id: l.id,
      name: leagueDisplayName(l.name),
      key,
      providerId: l.platformLeagueId || null,
      platform,
      slots: new Set<string>(),
      platformUserIds: new Set<string>(),
    }
    if (t.externalId) meta.slots.add(String(t.externalId))
    if (t.platformUserId) meta.platformUserIds.add(t.platformUserId)
    leagues.set(l.id, meta)
  }

  /*
   * ⚠ ONE ENTRY PER PROVIDER LEAGUE. Two `League` rows can carry the same Sleeper
   * id (a re-import beside a shadow league), and reading the grade cache once per
   * row listed every trade in it twice — measured on the production copy.
   */
  const byProvider = new Map<string, LeagueMeta>()
  for (const l of leagues.values()) {
    if (l.platform !== 'sleeper' || !l.providerId) continue
    const held = byProvider.get(l.providerId)
    if (!held) {
      byProvider.set(l.providerId, { ...l, slots: new Set(l.slots), platformUserIds: new Set(l.platformUserIds) })
      continue
    }
    for (const x of l.slots) held.slots.add(x)
    for (const x of l.platformUserIds) held.platformUserIds.add(x)
  }
  const sleeperLeagues = [...byProvider.values()]
  const cacheKeys = sleeperLeagues.flatMap((l) => [
    `${TRADE_GRADES_PREFIX}${l.providerId}`,
    `${DRAFT_REPORT_PREFIX}${l.providerId}`,
  ])

  const [cacheRows, draftFacts, legacyTrades] = await Promise.all([
    cacheKeys.length
      ? prisma.sportsDataCache
          .findMany({ where: { cacheKey: { in: cacheKeys } }, select: { cacheKey: true, data: true } })
          .catch(() => [] as Array<{ cacheKey: string; data: unknown }>)
      : Promise.resolve([] as Array<{ cacheKey: string; data: unknown }>),
    leagues.size
      ? prisma.draftFact
          .findMany({
            /*
             * ⚠ NARROWED TO YOUR SLOTS IN THE QUERY, NOT AFTER IT. A draft fact is
             * every manager's pick, so `leagueId IN (...)` alone returned the whole
             * table for a big account (127k rows across 222 leagues measured).
             */
            where: {
              OR: [...leagues.values()]
                .filter((l) => l.slots.size > 0)
                .map((l) => ({ leagueId: l.id, managerId: { in: [...l.slots] } })),
            },
            select: { leagueId: true, season: true, round: true, pickNumber: true, playerId: true, managerId: true },
            take: 50_000,
          })
          .catch(() => [])
      : Promise.resolve([]),
    opts.tradeKeys.length && (!filter.platform || filter.platform === 'sleeper')
      ? prisma.leagueTrade
          .findMany({
            where: { history: { sleeperUsername: { in: opts.tradeKeys } } },
            select: {
              transactionId: true,
              season: true,
              week: true,
              tradeDate: true,
              playersGiven: true,
              playersReceived: true,
              picksGiven: true,
              picksReceived: true,
              history: { select: { sleeperLeagueId: true } },
            },
            orderBy: { tradeDate: 'desc' },
            take: 20_000,
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])
  const cache = new Map(cacheRows.map((r) => [r.cacheKey, r.data]))

  /* ── graded trades ─────────────────────────────────────────────────────── */
  const graded: GradedTradeFact[] = []
  const trades: CareerTradeEvent[] = []
  const seenTradeIds = new Set<string>()
  let ungradedLeagues = 0
  for (const l of sleeperLeagues) {
    const payload = cache.get(`${TRADE_GRADES_PREFIX}${l.providerId}`) as TradeGradesPayload | undefined
    if (!payload || payload.version !== 2 || !Array.isArray(payload.trades)) {
      ungradedLeagues += 1
      continue
    }
    for (const t of payload.trades) {
      if (seenTradeIds.has(t.id)) continue
      const season = Number(t.season)
      if (!Number.isFinite(season) || !inEra(season, filter)) continue
      const side = t.sides.find((s) => s.ownerId && l.platformUserIds.has(s.ownerId))
      if (!side) continue
      seenTradeIds.add(t.id)
      /*
       * ⚠ NO SIGNAL IS NOT A C. A trade none of whose pieces has scored yet grades
       * C with a net of zero, which reads as "an average trade". It is listed, but
       * with no verdict, and it is kept out of best and worst.
       */
      const signal = !hasNoSignal(t)
      const partner =
        t.sides
          .filter((s) => s !== side)
          .map((s) => s.teamName?.trim() || s.managerName?.trim() || 'another team')
          .join(', ') || 'another team'
      const received = sideAssets(side, 'in')
      const sent = sideAssets(side, 'out')
      if (signal) graded.push({
        id: t.id,
        date: t.createdIso,
        season,
        leagueName: l.name,
        net: side.cumulativeNet,
        initialGrade: side.initialGrade,
        currentGrade: side.currentGrade,
        received,
        sent,
        partner,
      })
      trades.push({
        id: t.id,
        season,
        week: t.week,
        date: t.createdIso,
        leagueName: l.name,
        leagueKey: l.key,
        gave: sent,
        got: received,
        assets: received.length + sent.length,
        partner,
        net: signal ? side.cumulativeNet : null,
        grade: signal ? side.currentGrade : null,
      })
    }
  }

  /* ── every other trade of yours ────────────────────────────────────────── */
  const ungradedTrades = legacyTrades.filter((t) => {
    if (seenTradeIds.has(`${t.history.sleeperLeagueId}:${t.transactionId}`)) return false
    if (!inEra(t.season, filter)) return false
    const league = opts.leagueByProvider.get(t.history.sleeperLeagueId)
    if (filter.league && league?.key !== filter.league) return false
    if (filter.sport && league?.sport && league.sport !== filter.sport) return false
    if (filter.sport && !league) return false
    return true
  })
  const names = await playerNames(
    ungradedTrades.slice(0, MAX_TRADE_EVENTS).flatMap((t) => [...playerIds(t.playersGiven), ...playerIds(t.playersReceived)]),
  )
  const label = (ids: string[], picks: unknown) => {
    const known = ids.map((id) => names.get(id)).filter((n): n is string => !!n)
    const pickLabels = (Array.isArray(picks) ? picks : []).map(pickLabel).filter((p): p is string => !!p)
    return { list: [...known, ...pickLabels], unresolved: ids.length - known.length }
  }
  const listable = Math.max(0, MAX_TRADE_EVENTS - trades.length)
  for (const t of ungradedTrades.slice(0, listable)) {
    const league = opts.leagueByProvider.get(t.history.sleeperLeagueId)
    const gave = label(playerIds(t.playersGiven), t.picksGiven)
    const got = label(playerIds(t.playersReceived), t.picksReceived)
    trades.push({
      id: `${t.history.sleeperLeagueId}:${t.transactionId}`,
      season: t.season,
      week: t.week,
      date: t.tradeDate ? t.tradeDate.toISOString() : null,
      leagueName: league?.name ?? null,
      leagueKey: league?.key ?? null,
      gave: gave.unresolved ? [describeSide(gave.list, gave.unresolved)] : gave.list,
      got: got.unresolved ? [describeSide(got.list, got.unresolved)] : got.list,
      assets: tradeAssetCount(t),
      partner: null,
      net: null,
      grade: null,
    })
  }
  const tradesOmitted = Math.max(0, ungradedTrades.length - listable)
  trades.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.season - a.season)

  /* ── drafts ────────────────────────────────────────────────────────────── */
  // The same provider league through two rows carries the same picks twice — see `byProvider`.
  const seenPicks = new Set<string>()
  const providerKey = (leagueId: string) => leagues.get(leagueId)?.providerId ?? leagueId
  const mine = draftFacts.filter((d) => {
    if (d.season == null || !inEra(d.season, filter)) return false
    const l = leagues.get(d.leagueId)
    if (!l || d.managerId == null || !l.slots.has(String(d.managerId))) return false
    const k = `${providerKey(d.leagueId)}|${d.season}|${d.round}|${d.pickNumber}`
    if (seenPicks.has(k)) return false
    seenPicks.add(k)
    return true
  })
  const draftNames = await playerNames(mine.map((d) => d.playerId))
  const byDraft = new Map<string, typeof mine>()
  for (const d of mine) {
    const k = `${providerKey(d.leagueId)}:${d.season}`
    const list = byDraft.get(k)
    if (list) list.push(d)
    else byDraft.set(k, [d])
  }

  const draftCards: DraftCardFact[] = []
  const steals: DraftStealFact[] = []
  const gradeByDraft = new Map<string, string>()
  for (const l of sleeperLeagues) {
    const payload = cache.get(`${DRAFT_REPORT_PREFIX}${l.providerId}`) as DraftReportPayload | undefined
    if (!payload || payload.version !== 1 || !Array.isArray(payload.seasons)) continue
    for (const s of payload.seasons) {
      const season = Number(s.season)
      if (!Number.isFinite(season) || !inEra(season, filter)) continue
      const card = s.managers.find((m) => l.platformUserIds.has(m.ownerId))
      if (card && card.picks > 0) {
        draftCards.push({
          season,
          leagueName: l.name,
          grade: card.currentGrade,
          score: card.currentScore,
          picks: card.picks,
          scoringNote: payload.scoringNote,
        })
        gradeByDraft.set(`${l.providerId}:${season}`, card.currentGrade)
      }
      for (const st of s.steals ?? []) {
        if (!st.byOwnerId || !l.platformUserIds.has(st.byOwnerId)) continue
        if (st.currentValueOver == null) continue
        steals.push({
          season,
          leagueName: l.name,
          playerName: st.playerName,
          round: st.round,
          pickNo: st.pickNo,
          valueOver: st.currentValueOver,
        })
      }
    }
  }

  const drafts: CareerDraftEvent[] = [...byDraft.entries()].map(([, picks]) => {
    const l = leagues.get(picks[0].leagueId)!
    const first = [...picks].sort((a, b) => a.pickNumber - b.pickNumber)[0]
    return {
      season: picks[0].season as number,
      leagueName: l.name,
      leagueKey: l.key,
      firstPick: first
        ? {
            round: first.round,
            pickNumber: first.pickNumber,
            player: draftNames.get(first.playerId) ?? 'a player we could not name',
          }
        : null,
      picks: picks.length,
      grade: gradeByDraft.get(`${l.providerId ?? l.id}:${picks[0].season}`) ?? null,
    }
  })
  drafts.sort((a, b) => b.season - a.season || (a.firstPick?.pickNumber ?? 999) - (b.firstPick?.pickNumber ?? 999))

  return {
    trades,
    tradesOmitted,
    graded,
    ungradedLeagues,
    drafts,
    draftCards,
    steals,
    picksOnFile: mine.length,
    draftSeasons: [...new Set(drafts.map((d) => d.season))].sort((a, b) => b - a),
    tradeSeasons: [...new Set([...trades.map((t) => t.season), ...ungradedTrades.map((t) => t.season)])].sort((a, b) => b - a),
  }
}
