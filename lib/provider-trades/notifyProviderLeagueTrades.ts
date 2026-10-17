import 'server-only'

import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push-notifications'
import { decidePushForUser } from '@/lib/notifications/pushGate'
import { resolveProviderRosterPlayers } from '@/lib/player-identity/resolveProviderRosterPlayers'
import { groupProviderTrades, renderProviderTrade, type ProviderTrade, type ProviderTradeRow } from './providerTradeAlerts'

/**
 * Push a new trade in a non-Sleeper imported league to every AllFantasy member of it (see
 * providerTradeAlerts.ts for the source and the grouping). Rides `/api/cron/trade-grade-notify`, the
 * Sleeper trade sweep's own route — no new route — every 15 minutes.
 *
 * ── HOW "NEW" IS DECIDED ─────────────────────────────────────────────────────────────────────────
 * A WATERMARK on `LeagueTrade.createdAt` (one SportsDataCache row), read with a 15-minute overlap so a
 * trade written mid-sweep is never skipped. Re-reading is safe because every send is CLAIMED first,
 * per trade per recipient, exactly as the Sleeper sweep does it — a second sweep reaches only the
 * people the first did not.
 *
 * 🛑 NO RETRO SPAM. The first run records the watermark and sends nothing; history is browsable in
 * the app. And a row only counts if its trade is under FRESH_TRADE_MS old: a historical backfill that
 * writes last season's trades today must not announce them.
 *
 * ── WHO, AND THROUGH WHICH SWITCH ────────────────────────────────────────────────────────────────
 * Every AF user attached to any AF copy of the league — the row's owner and every claimed team —
 * each linked to THEIR OWN copy (imported leagues are per-user rows). Gated per recipient by
 * `decidePushForUser` under `trade_accept_reject`, against that user's own league row, the same
 * category and gate the Sleeper sweep uses: one "trade alerts" switch, whichever platform.
 */

const WATERMARK_KEY = 'provider-trade-notify:v1:watermark'
const SENT_PREFIX = 'provider-trade-notify:sent:v1:'
const OVERLAP_MS = 15 * 60 * 1000
export const FRESH_TRADE_MS = 48 * 60 * 60 * 1000
const SENT_CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_ROWS = 500

export type ProviderTradeNotifyResult = {
  bootstrapped: boolean
  rows: number
  trades: number
  sent: number
  /** Recipients whose settings refused the push, or who were already sent this trade. */
  skipped: number
  noRecipients: number
  errors: string[]
}

export interface ProviderTradeNotifyDeps {
  now: () => Date
  readWatermark: () => Promise<Date | null>
  writeWatermark: (at: Date) => Promise<void>
  loadRows: (since: Date, freshAfter: Date) => Promise<Array<ProviderTradeRow & { createdAt: Date }>>
  loadLeagues: (platform: string, platformLeagueId: string) => Promise<
    Array<{
      id: string
      name: string | null
      ownerUserId: string
      teams: Array<{ claimedByUserId: string | null; platformUserId: string | null; externalId: string | null; name: string | null }>
    }>
  >
  resolvePlayers: (platform: string, ids: string[], sport: string) => Promise<Map<string, { name: string }>>
  allowPush: (userId: string, leagueId: string) => Promise<boolean>
  claim: (key: string) => Promise<'ours' | 'taken' | 'unavailable'>
  release: (key: string) => Promise<void>
  send: (userId: string, push: { title: string; body: string; href: string; tag: string; type: 'trade'; leagueId: string }) => Promise<boolean>
}

const defaultDeps: ProviderTradeNotifyDeps = {
  now: () => new Date(),
  readWatermark: async () => {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: WATERMARK_KEY }, select: { data: true } })
    const at = (row?.data as { at?: string } | null)?.at
    const d = at ? new Date(at) : null
    return d && Number.isFinite(d.getTime()) ? d : null
  },
  writeWatermark: async (at) => {
    const data = { at: at.toISOString() }
    const expiresAt = new Date(at.getTime() + 365 * 24 * 60 * 60 * 1000)
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: WATERMARK_KEY },
      update: { data, expiresAt },
      create: { cacheKey: WATERMARK_KEY, data, expiresAt },
    })
  },
  loadRows: async (since, freshAfter) => {
    const rows = await prisma.leagueTrade.findMany({
      where: { platform: { not: 'sleeper' }, createdAt: { gt: since }, tradeDate: { gte: freshAfter } },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS,
      select: {
        platform: true,
        sport: true,
        transactionId: true,
        tradeDate: true,
        createdAt: true,
        playersReceived: true,
        picksReceived: true,
        history: { select: { sleeperLeagueId: true, sleeperUsername: true } },
      },
    })
    return rows.flatMap((r) =>
      r.tradeDate
        ? [
            {
              platform: r.platform,
              platformLeagueId: r.history.sleeperLeagueId,
              sideId: r.history.sleeperUsername,
              transactionId: r.transactionId,
              tradeDate: r.tradeDate,
              createdAt: r.createdAt,
              sport: String(r.sport ?? 'nfl'),
              playersReceived: Array.isArray(r.playersReceived) ? r.playersReceived.map(String) : [],
              picksReceived: Array.isArray(r.picksReceived) ? r.picksReceived.length : 0,
            },
          ]
        : [],
    )
  },
  loadLeagues: async (platform, platformLeagueId) => {
    const leagues = await prisma.league.findMany({
      where: { platform, platformLeagueId },
      select: { id: true, name: true, userId: true },
    })
    if (leagues.length === 0) return []
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagues.map((l) => l.id) } },
      select: { leagueId: true, claimedByUserId: true, platformUserId: true, externalId: true, teamName: true, ownerName: true },
    })
    return leagues.map((l) => ({
      id: l.id,
      name: l.name,
      ownerUserId: l.userId,
      teams: teams
        .filter((t) => t.leagueId === l.id)
        .map((t) => ({ claimedByUserId: t.claimedByUserId, platformUserId: t.platformUserId, externalId: t.externalId, name: t.teamName || t.ownerName })),
    }))
  },
  resolvePlayers: (platform, ids, sport) => resolveProviderRosterPlayers(platform, ids, sport),
  allowPush: async (userId, leagueId) => {
    const gate = await decidePushForUser(userId, { category: 'trade_accept_reject', leagueId, severity: 'medium' }).catch(() => null)
    return gate?.allowed === true
  },
  claim: async (key) => {
    try {
      await prisma.sportsDataCache.create({
        data: { cacheKey: key, data: { claimedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + SENT_CLAIM_TTL_MS) },
      })
      return 'ours'
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
      return code === 'P2002' ? 'taken' : 'unavailable'
    }
  },
  release: async (key) => {
    await prisma.sportsDataCache.deleteMany({ where: { cacheKey: key } }).catch(() => undefined)
  },
  send: async (userId, push) => {
    const results = await sendPushToUser(userId, push).catch(() => [])
    return results.some((r) => r.ok)
  },
}

/** Each AF member of the league, linked to their own copy of it. */
function recipientsOf(leagues: Awaited<ReturnType<ProviderTradeNotifyDeps['loadLeagues']>>): Map<string, string> {
  const out = new Map<string, string>()
  for (const l of leagues) {
    const users = [l.ownerUserId, ...l.teams.map((t) => t.claimedByUserId)].filter((u): u is string => Boolean(u))
    for (const u of users) if (!out.has(u)) out.set(u, l.id)
  }
  return out
}

export async function notifyProviderLeagueTrades(
  opts: { dryRun?: boolean } = {},
  overrides: Partial<ProviderTradeNotifyDeps> = {},
): Promise<ProviderTradeNotifyResult> {
  const deps: ProviderTradeNotifyDeps = { ...defaultDeps, ...overrides }
  const now = deps.now()
  const result: ProviderTradeNotifyResult = { bootstrapped: false, rows: 0, trades: 0, sent: 0, skipped: 0, noRecipients: 0, errors: [] }

  const watermark = await deps.readWatermark()
  if (!watermark) {
    // First run: remember where we are and announce nothing (see the header).
    if (!opts.dryRun) await deps.writeWatermark(now)
    result.bootstrapped = true
    return result
  }

  const rows = await deps.loadRows(new Date(watermark.getTime() - OVERLAP_MS), new Date(now.getTime() - FRESH_TRADE_MS))
  result.rows = rows.length
  const trades = groupProviderTrades(rows)
  result.trades = trades.length

  for (const trade of trades) {
    try {
      await announce(trade, deps, result, Boolean(opts.dryRun))
    } catch (e) {
      result.errors.push(`${trade.key}: ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`)
    }
  }

  // Advance to the newest row read. A sweep that hit MAX_ROWS resumes from its last row next time.
  const newest = rows.reduce<Date | null>((m, r) => (!m || r.createdAt > m ? r.createdAt : m), null)
  if (!opts.dryRun && newest && newest > watermark) await deps.writeWatermark(newest)
  return result
}

async function announce(trade: ProviderTrade, deps: ProviderTradeNotifyDeps, result: ProviderTradeNotifyResult, dryRun: boolean) {
  const leagues = await deps.loadLeagues(trade.platform, trade.platformLeagueId)
  const recipients = recipientsOf(leagues)
  if (recipients.size === 0) {
    result.noRecipients += 1
    return
  }
  const players = await deps
    .resolvePlayers(trade.platform, [...new Set(trade.sides.flatMap((s) => s.players))], trade.sport.toUpperCase())
    .catch(() => new Map<string, { name: string }>())

  for (const [userId, leagueId] of recipients) {
    const league = leagues.find((l) => l.id === leagueId)!
    // Team names from the recipient's OWN copy: the side id is the provider's team id.
    const teamName = (sideId: string) =>
      league.teams.find((t) => t.platformUserId === sideId || t.externalId === sideId)?.name ?? 'A team'
    const message = renderProviderTrade(trade, league.name ?? 'your league', teamName, (id) => players.get(id)?.name ?? null)
    if (dryRun) {
      result.skipped += 1
      continue
    }
    if (!(await deps.allowPush(userId, leagueId))) {
      result.skipped += 1
      continue
    }
    const key = `${SENT_PREFIX}${trade.key}:${userId}`
    const claim = await deps.claim(key)
    if (claim !== 'ours') {
      result.skipped += 1
      continue
    }
    const ok = await deps.send(userId, {
      ...message,
      href: `/core/trades?league=${encodeURIComponent(leagueId)}`,
      tag: `trade:${leagueId}:${trade.key}`,
      type: 'trade',
      leagueId,
    })
    // A push nobody received gives its claim back, so the next sweep tries that person again.
    if (ok) result.sent += 1
    else await deps.release(key)
  }
}
