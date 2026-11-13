import 'server-only'

import { prisma } from '@/lib/prisma'
import { isShadowLeague, sourcePlatformLabel } from '@/lib/league/write-authority'
import { playerIdSpaceFor, resolveTradePlayers } from '@/lib/decision-os/trade/tradePlayers'

/**
 * TRADES MADE IN ALLFANTASY → CHIMMY, for a league whose history is not synced from Sleeper.
 *
 * 🛑 CHIMMY TOLD EVERY NON-SLEEPER LEAGUE "COMPLETED-TRADE HISTORY IS ONLY SYNCED FOR SLEEPER LEAGUES".
 * `buildLeagueTradeHistoryOutcome` reads `LeagueTrade`, which only Sleeper ingestion writes, and refused
 * every other platform — native AllFantasy leagues included, whose trades ARE real and live in
 * `AfLeagueTrade`. Found by the dynasty and Fantrax-scale simulations (2026-11-07): five processed trades
 * in the league, and Chimmy's history tool said it could see none.
 *
 * ⚠ IN AN IMPORTED LEAGUE THESE ARE SHADOW TRADES, AND THAT IS NOT A DETAIL. A trade made here in a
 * Fantrax, ESPN, Yahoo or MFL league "lives only in AllFantasy" (`app/api/leagues/[leagueId]/trades`):
 * the provider's rosters change only if the managers also make it there. So they are listed under their
 * own heading and never as the league's trade history — a model told they "happened" would say a player
 * changed teams in Fantrax when nobody knows that.
 */

const MAX_SCAN = 200

export type AfHistoryQuery = {
  season?: number | null
  manager?: string | null
  player?: string | null
  maxShown: number
}

export type AfHistoryResult =
  | { kind: 'ok'; text: string; uniqueTrades: number; shown: number; unresolvedPlayers: number }
  | { kind: 'none' }
  | { kind: 'failed' }

type AfItem = { itemType: string; itemReference: string | null; fromRosterId: string; toRosterId: string; faabAmount: number | null; metadata: unknown }

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** "2027 round 1 pick" from metadata, or from a self-describing reference (`fdp:2027:1:<roster>`). */
function pickLabel(item: AfItem): string {
  const meta = record(item.metadata)
  const ref = /^(?:fdp|pick):(\d{4}):(\d{1,2})(?::|$)/.exec(item.itemReference ?? '')
  const year = Number(meta.pickSeason ?? meta.season ?? ref?.[1])
  const round = Number(meta.pickRound ?? meta.round ?? ref?.[2])
  return Number.isFinite(year) && Number.isFinite(round) && year > 0 && round > 0 ? `${year} round ${round} pick` : 'a draft pick'
}

export async function buildAfTradeHistoryOutcome(
  leagueId: string,
  league: { platform: string; sport: string; season: number | null },
  query: AfHistoryQuery,
): Promise<AfHistoryResult> {
  // Native leagues, and providers whose writes AllFantasy makes for real, hold real trades here.
  const real = !isShadowLeague(league.platform)
  const platformLabel = sourcePlatformLabel(league.platform) ?? 'the source platform'

  let trades: Array<{ id: string; processedAt: Date | null; proposerRosterId: string; receiverRosterId: string; items: AfItem[] }>
  let rosters: Array<{ id: string; platformUserId: string; redraftRoster: { teamName: string | null; ownerName: string | null } | null }>
  try {
    ;[trades, rosters] = await Promise.all([
      prisma.afLeagueTrade.findMany({
        where: { leagueId, status: 'processed' },
        orderBy: { processedAt: 'desc' },
        take: MAX_SCAN,
        select: {
          id: true,
          processedAt: true,
          proposerRosterId: true,
          receiverRosterId: true,
          items: { select: { itemType: true, itemReference: true, fromRosterId: true, toRosterId: true, faabAmount: true, metadata: true } },
        },
      }),
      prisma.roster.findMany({
        where: { leagueId },
        select: { id: true, platformUserId: true, redraftRoster: { select: { teamName: true, ownerName: true } } },
      }),
    ])
  } catch {
    return { kind: 'failed' }
  }
  // Every AllFantasy trade is on THIS league row, which is one season.
  if (query.season != null && league.season != null && query.season !== league.season) return { kind: 'none' }
  if (trades.length === 0) return { kind: 'none' }

  const teamOf = new Map<string, { label: string; names: string[] }>()
  for (const r of rosters) {
    const team = r.redraftRoster?.teamName?.trim() ?? ''
    const owner = r.redraftRoster?.ownerName?.trim() ?? ''
    const label = team && owner && team.toLowerCase() !== owner.toLowerCase() ? `${team} (${owner})` : team || owner
    if (label) teamOf.set(r.id, { label, names: [team, owner].filter(Boolean) })
  }
  const labelOf = (rosterId: string) => teamOf.get(rosterId)?.label ?? 'a team'

  const ids = [...new Set(trades.flatMap((t) => t.items.filter((i) => !/pick|faab/i.test(i.itemType)).map((i) => i.itemReference).filter((x): x is string => Boolean(x))))]
  const resolved = ids.length
    ? await resolveTradePlayers(ids, { space: playerIdSpaceFor({ platform: league.platform, sport: league.sport }), sport: league.sport }).catch(() => new Map())
    : new Map()
  let unresolved = 0
  const nameOf = (item: AfItem): string | null => {
    const hit = item.itemReference ? resolved.get(item.itemReference) : null
    if (hit?.ok) return hit.name
    const meta = record(item.metadata)
    const stored = typeof meta.playerName === 'string' ? meta.playerName.trim() : typeof meta.name === 'string' ? meta.name.trim() : ''
    return stored || null
  }
  const describe = (items: AfItem[]): string => {
    const parts = items.map((i) => {
      if (/faab/i.test(i.itemType)) return i.faabAmount != null ? `$${i.faabAmount} FAAB` : 'FAAB'
      if (/pick/i.test(i.itemType)) return pickLabel(i)
      const name = nameOf(i)
      if (!name) unresolved += 1
      return name ?? 'an unnamed player'
    })
    return parts.length ? parts.join(', ') : 'nothing'
  }

  const managerFilter = query.manager?.trim().toLowerCase() || null
  const playerFilter = query.player?.trim().toLowerCase() || null
  const matching = trades.filter((t) => {
    if (managerFilter) {
      const sides = [t.proposerRosterId, t.receiverRosterId].flatMap((id) => teamOf.get(id)?.names ?? [])
      if (!sides.some((n) => n.toLowerCase().includes(managerFilter))) return false
    }
    if (playerFilter && !t.items.some((i) => (nameOf(i) ?? '').toLowerCase().includes(playerFilter))) return false
    return true
  })
  const shown = matching.slice(0, Math.max(1, query.maxShown))

  const lines: string[] = real
    ? [
        'COMPLETED TRADE HISTORY for this league (made through AllFantasy).',
        'These trades ALREADY HAPPENED and are on the rosters. None of them is a pending offer.',
      ]
    : [
        `TRADES RECORDED IN ALLFANTASY for this ${platformLabel} league — NOT its ${platformLabel} trade history, which is not synced.`,
        `These are shadow trades: they were made here, and the ${platformLabel} rosters change only if the managers also made them in ${platformLabel}. Say that whenever you mention one; never say a player moved in ${platformLabel}.`,
      ]
  lines.push(`Processed in AllFantasy: ${trades.length}${trades.length >= MAX_SCAN ? ' or more' : ''}.`)
  if (managerFilter || playerFilter) {
    lines.push(`Filtered${managerFilter ? ` to manager "${query.manager!.trim()}"` : ''}${playerFilter ? ` to player "${query.player!.trim()}"` : ''}: ${matching.length}.`)
  }
  lines.push(shown.length === 0 ? 'No trade matches that filter.' : shown.length < matching.length ? `Most recent ${shown.length} of ${matching.length}:` : `All ${shown.length}, most recent first:`)
  for (const t of shown) {
    const when = t.processedAt ? t.processedAt.toISOString().slice(0, 10) : 'date not recorded'
    const a = labelOf(t.proposerRosterId)
    const b = labelOf(t.receiverRosterId)
    const got = describe(t.items.filter((i) => i.toRosterId === t.proposerRosterId))
    const gave = describe(t.items.filter((i) => i.fromRosterId === t.proposerRosterId))
    lines.push(`- ${when}: ${a} got [${got}] from ${b} for [${gave}].`)
  }
  lines.push('LIMITS: no values or grades are listed here — do NOT state what any of these was worth, who won, or assign a grade.')
  if (unresolved > 0) lines.push(`${unresolved} traded player(s) could not be named. Say so if it matters; never guess who they were.`)
  return { kind: 'ok', text: lines.join('\n'), uniqueTrades: trades.length, shown: shown.length, unresolvedPlayers: unresolved }
}
