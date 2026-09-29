import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { AgentAsset, AgentSuggestion } from './tradeAgentRules'

/**
 * Where the nightly trade agent keeps its suggestions: `trade_agent_suggestions`.
 *
 * 🛑 THE CODE CAN SHIP BEFORE ITS MIGRATION, AND MUST DO NOTHING WHEN IT DOES. Until
 * `20260928000000_trade_agent_suggestions` is applied the table does not exist, and a query against it
 * raises P2021. So every reader and writer asks `tradeAgentTableReady()` first: the agent does not run
 * and the Trades screen shows no suggestions. The probe re-checks every 10 minutes, so applying the
 * migration takes effect without a deploy — the same pattern as `receiptColumnsReady()`.
 */

const RECHECK_MS = 10 * 60_000
let readyCache: { ready: boolean; at: number } | null = null

type Probe = () => Promise<boolean>

const defaultProbe: Probe = async () => {
  const rows = await prisma.$queryRaw<Array<{ n: number | bigint }>>`
    SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'trade_agent_suggestions'`
  return Number(rows[0]?.n ?? 0) === 1
}

/** True once the table exists. Never throws: an unanswerable probe is "not ready". */
export async function tradeAgentTableReady(opts: { probe?: Probe; now?: () => number } = {}): Promise<boolean> {
  const now = (opts.now ?? Date.now)()
  if (readyCache?.ready) return true
  if (readyCache && now - readyCache.at < RECHECK_MS) return false
  let ready = false
  try {
    ready = await (opts.probe ?? defaultProbe)()
  } catch {
    ready = false
  }
  readyCache = { ready, at: now }
  return ready
}

/** Test seam: forget the cached answer. */
export function resetTradeAgentTableCache(): void {
  readyCache = null
}

/** Leagues that already have suggestions for this night — done, so a later pass skips them. */
export async function leaguesDoneTonight(runDate: string): Promise<Set<string>> {
  const rows = await prisma.tradeAgentSuggestion
    .findMany({ where: { runDate }, select: { leagueId: true }, distinct: ['leagueId'] })
    .catch(() => [] as Array<{ leagueId: string }>)
  return new Set(rows.map((r) => r.leagueId))
}

/*
 * ── Leagues fully visited tonight ─────────────────────────────────────────────────────────────────
 *
 * 🛑 A LEAGUE WITH NO QUALIFYING DEAL USED TO BE RE-GRADED EVERY HOUR. `leaguesDoneTonight` counts only
 * leagues that SAVED a suggestion, so on the first night (2026-09-29) every pass after the first full one
 * re-graded ~290 leagues — ~3,000 grades and 3–4 minutes of worker CPU an hour, for 3–11 new ideas. One
 * heavy job on the worker's single core stalls every other route on it, so that load is not free.
 *
 * So a league the pass visits COMPLETELY is recorded here and skipped for the rest of the night (Guap,
 * 2026-09-29: "mark leagues done after one full visit"). A visit the budget interrupted, or that threw,
 * is not recorded, and the league is retried next hour.
 *
 * Kept in `SportsDataCache` rather than a new table: one row per night, expiring after two days, which
 * the hourly reaper purges on its own. Losing it — an unreadable row, a failed write, a race between two
 * passes — only means a league is graded again, which is today's behaviour. It can never hide a league
 * that was not visited.
 */
const VISITED_TTL_MS = 2 * 24 * 60 * 60 * 1000

export const visitedCacheKey = (runDate: string) => `trade-agent:visited:${runDate}`

/** Leagues this night's passes have already visited in full. Empty when unreadable. */
export async function leaguesVisitedTonight(runDate: string): Promise<Set<string>> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: visitedCacheKey(runDate) }, select: { data: true } })
    .catch(() => null)
  const ids = (row?.data as { leagueIds?: unknown } | null)?.leagueIds
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
}

/** Add leagues to tonight's visited list. Never throws: a lost write only costs a re-grade. */
export async function markLeaguesVisited(runDate: string, leagueIds: readonly string[], now: Date = new Date()): Promise<boolean> {
  if (leagueIds.length === 0) return true
  try {
    const merged = [...new Set([...(await leaguesVisitedTonight(runDate)), ...leagueIds])]
    const data = { leagueIds: merged } as unknown as Prisma.InputJsonValue
    const expiresAt = new Date(now.getTime() + VISITED_TTL_MS)
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: visitedCacheKey(runDate) },
      create: { cacheKey: visitedCacheKey(runDate), data, expiresAt },
      update: { data, expiresAt },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Replace one manager's suggestions in one league with tonight's — including with none. A night that
 * found nothing clears yesterday's list, because yesterday's deals were built on rosters that may have
 * changed since. A night whose run FAILS never calls this, so a failure leaves the last list standing.
 */
export async function saveTradeAgentSuggestions(args: {
  leagueId: string
  userId: string
  rosterId: string
  runDate: string
  suggestions: readonly AgentSuggestion[]
}): Promise<number> {
  const data = args.suggestions.map((s, i) => ({
    leagueId: args.leagueId,
    userId: args.userId,
    rosterId: args.rosterId,
    partnerRosterId: s.partnerRosterId,
    partnerName: s.partnerName ? s.partnerName.slice(0, 128) : null,
    give: s.give as unknown as Prisma.InputJsonValue,
    get: s.get as unknown as Prisma.InputJsonValue,
    dealKey: s.dealKey.slice(0, 512),
    letter: s.letter,
    partnerLetter: s.partnerLetter,
    percentDiff: Math.round(s.percentDiff),
    giveValue: Math.round(s.giveValue),
    getValue: Math.round(s.getValue),
    viewerFitPct: Math.round(s.viewerFitPct),
    partnerFitPct: Math.round(s.partnerFitPct),
    basis: s.basis,
    runDate: args.runDate,
    rank: i + 1,
  }))
  await prisma.$transaction([
    prisma.tradeAgentSuggestion.deleteMany({ where: { leagueId: args.leagueId, userId: args.userId } }),
    prisma.tradeAgentSuggestion.createMany({ data, skipDuplicates: true }),
  ])
  return data.length
}

export type StoredTradeSuggestion = {
  id: string
  partnerName: string | null
  give: AgentAsset[]
  get: AgentAsset[]
  letter: string
  partnerLetter: string
  percentDiff: number
  viewerFitPct: number
  partnerFitPct: number
  basis: string
  runDate: string
}

const asAssets = (v: unknown): AgentAsset[] =>
  Array.isArray(v)
    ? v.flatMap((a) =>
        a && typeof a === 'object' && typeof (a as AgentAsset).name === 'string'
          ? [{ playerId: String((a as AgentAsset).playerId ?? ''), name: (a as AgentAsset).name, position: String((a as AgentAsset).position ?? '') }]
          : [],
      )
    : []

/** The viewer's latest night of suggestions in a league, best first. Empty until the table exists. */
export async function readTradeAgentSuggestions(leagueId: string, userId: string): Promise<StoredTradeSuggestion[]> {
  if (!(await tradeAgentTableReady())) return []
  const latest = await prisma.tradeAgentSuggestion
    .findFirst({ where: { leagueId, userId }, orderBy: { runDate: 'desc' }, select: { runDate: true } })
    .catch(() => null)
  if (!latest) return []
  const rows = await prisma.tradeAgentSuggestion
    .findMany({
      where: { leagueId, userId, runDate: latest.runDate, dismissedAt: null },
      orderBy: { rank: 'asc' },
      select: {
        id: true,
        partnerName: true,
        give: true,
        get: true,
        letter: true,
        partnerLetter: true,
        percentDiff: true,
        viewerFitPct: true,
        partnerFitPct: true,
        basis: true,
        runDate: true,
      },
    })
    .catch(() => [])
  return rows.map((r) => ({ ...r, give: asAssets(r.give), get: asAssets(r.get) }))
}
