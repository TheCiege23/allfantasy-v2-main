import 'server-only'

import { prisma } from '@/lib/prisma'
import { readFantasyCalcValuesFromDb } from '@/lib/fantasycalc-db'
import type { FantasyCalcPlayer, FantasyCalcSettings } from '@/lib/fantasycalc'
import { safeDisplayName } from '@/lib/chat-notifications/displayName'
import { postChimmyMoment, type PostChimmyMomentResult } from '@/lib/league-chat/chimmyMoments'
import { buildChimmyTradeTake, type TradeTakeAsset, type TradeTakeSide } from '@/lib/league-chat/chimmyTradeTake'

/**
 * Trades, as Chimmy moments: the card for a trade that just happened, with Chimmy's take on who won it
 * on paper folded into the SAME message — one post, never a card and then a separate opinion.
 *
 * Two writers use this:
 *   - `postNativeTradeMoment` — an AllFantasy league trade the moment its last manager accepts it
 *     (`acceptAfLeagueTrade` in lib/league-trade-engine/tradeService.ts, fire-and-forget).
 *   - `lib/league-chat/tradeChatCards.ts` — trades imported from Sleeper, carded on the league chat read.
 *
 * 🛑 VALUES ARE READ FROM THE DATABASE AND NOTHING ELSE. Both writers run on request paths (an accept
 * POST, a chat GET), so this reads the `SportsDataCache` rows `lib/fantasycalc-db.ts` keeps warm and
 * never calls FantasyCalc — not even on a cache miss, which is the one thing
 * `getFantasyCalcValuesDbFirst` would do. No cached values, or values older than
 * `MAX_VALUE_AGE_MS`, means no take: the card still posts, without a verdict.
 */

/** A take quoted from a month-old market is a stale opinion wearing today's date. */
export const MAX_VALUE_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** FantasyCalc publishes a fixed ladder of league sizes (see availablePlayersTool.ts). */
const SUPPORTED_TEAM_COUNTS = [8, 10, 12, 14, 16]

export type TradeLeagueFacts = {
  sport?: unknown
  isDynasty?: boolean | null
  scoring?: string | null
  leagueSize?: number | null
  settings?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

/** The FantasyCalc profile that best describes a league, from what its row already says. */
export function fantasyCalcSettingsForTradeLeague(league: TradeLeagueFacts): FantasyCalcSettings {
  const settings = record(league.settings)
  const positions = settings.roster_positions ?? settings.rosterPositions
  const slots = Array.isArray(positions) ? positions.map((p) => String(p).toUpperCase()) : []
  const superflex =
    slots.includes('SUPER_FLEX') || slots.filter((s) => s === 'QB').length >= 2 || settings.superflex === true
  const size = league.leagueSize && league.leagueSize > 0 ? league.leagueSize : 12
  const numTeams = SUPPORTED_TEAM_COUNTS.find((n) => n >= size) ?? SUPPORTED_TEAM_COUNTS[SUPPORTED_TEAM_COUNTS.length - 1]!
  const scoring = String(league.scoring ?? '').toLowerCase()
  const ppr: 0 | 0.5 | 1 = /half/.test(scoring) ? 0.5 : /standard|non-ppr|^std$/.test(scoring) ? 0 : 1
  return { isDynasty: Boolean(league.isDynasty), numQbs: superflex ? 2 : 1, numTeams, ppr }
}

/**
 * Market values for a league's trades, DB ONLY. Tries the league's own profile, then the same profile
 * at 12 teams (the most-demanded size), then at full PPR. Null when none is cached and fresh.
 */
export async function readTradeMarketValues(
  league: TradeLeagueFacts,
  now: Date = new Date(),
): Promise<{ players: FantasyCalcPlayer[]; isDynasty: boolean } | null> {
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return null
  const exact = fantasyCalcSettingsForTradeLeague(league)
  const candidates: FantasyCalcSettings[] = [exact, { ...exact, numTeams: 12 }, { ...exact, numTeams: 12, ppr: 1 }]
  const seen = new Set<string>()
  for (const settings of candidates) {
    const key = JSON.stringify(settings)
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const row = await readFantasyCalcValuesFromDb(settings, { allowStale: true })
      const syncedMs = row.syncedAt ? Date.parse(row.syncedAt) : NaN
      if (row.players.length > 0 && Number.isFinite(syncedMs) && now.getTime() - syncedMs <= MAX_VALUE_AGE_MS) {
        return { players: row.players, isDynasty: settings.isDynasty }
      }
    } catch {
      return null
    }
  }
  return null
}

// ─── The card ───────────────────────────────────────────────────────────────────────────────────

export type TradeCardAsset = { id: string; name: string | null; position?: string | null; team?: string | null }

/**
 * `metadata.tradeCard` — the completed-trade shape `RichMessage` / `TradeCardView` render. The first
 * seven fields are the original imported-trade card; the rest are optional additions.
 */
export type ChimmyTradeCard = {
  transactionId: string
  manager: string
  season: number | null
  week: number | null
  gave: TradeCardAsset[]
  got: TradeCardAsset[]
  picksGave: number
  picksGot: number
  tradedAt: string | null
  /** The other side, when we know who it was. */
  partner?: string | null
  /** Assets with no player or pick shape — FAAB, specialty assets — as labels. */
  extrasGave?: string[]
  extrasGot?: string[]
  /** Market value of each side, from `manager`'s point of view. Present only with a take. */
  valueGave?: number | null
  valueGot?: number | null
  /** One line on where the trade stands ("Goes to commissioner review before it processes."). */
  note?: string | null
}

// ─── Native AllFantasy league trades ────────────────────────────────────────────────────────────

type NativeItem = {
  itemType: string
  itemReference: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount: number | null
  metadata: unknown
}

export type NativeTradeMomentResult =
  | PostChimmyMomentResult
  | { posted: false; reason: 'not_found' | 'not_two_team' }

function describeList(parts: string[]): string {
  if (parts.length === 0) return 'nothing'
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Post the Chimmy trade card (with the take, when every asset has a market value) for an accepted
 * AllFantasy league trade. Once per trade (`native:<tradeId>`). Never throws.
 */
export async function postNativeTradeMoment(input: {
  tradeId: string
  note?: string | null
  now?: Date
}): Promise<NativeTradeMomentResult> {
  const now = input.now ?? new Date()
  try {
    const trade = await prisma.afLeagueTrade.findUnique({ where: { id: input.tradeId }, include: { items: true } })
    if (!trade) return { posted: false, reason: 'not_found' }
    const items = trade.items as NativeItem[]
    const participants = new Set([trade.proposerRosterId, trade.receiverRosterId, ...items.flatMap((i) => [i.fromRosterId, i.toRosterId])])
    if (participants.size !== 2) return { posted: false, reason: 'not_two_team' }

    const [league, rosters] = await Promise.all([
      prisma.league.findUnique({
        where: { id: trade.leagueId },
        select: { id: true, sport: true, isDynasty: true, scoring: true, leagueSize: true, settings: true, season: true },
      }),
      prisma.roster.findMany({
        where: { id: { in: [trade.proposerRosterId, trade.receiverRosterId] } },
        select: { id: true, platformUserId: true },
      }),
    ])
    if (!league) return { posted: false, reason: 'not_found' }

    const receiverPlatformId = rosters.find((r) => r.id === trade.receiverRosterId)?.platformUserId ?? null
    const proposerPlatformId = rosters.find((r) => r.id === trade.proposerRosterId)?.platformUserId ?? null
    const userIds = [trade.proposedByUserId, receiverPlatformId].filter((v): v is string => Boolean(v))
    const [users, teams] = await Promise.all([
      prisma.appUser
        .findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } })
        .catch(() => [] as Array<{ id: string; displayName: string | null; username: string | null }>),
      prisma.leagueTeam
        .findMany({
          where: {
            leagueId: trade.leagueId,
            OR: [
              { externalId: { in: [trade.proposerRosterId, trade.receiverRosterId] } },
              { platformUserId: { in: [proposerPlatformId, receiverPlatformId].filter((v): v is string => Boolean(v)) } },
            ],
          },
          select: { externalId: true, platformUserId: true, ownerName: true, teamName: true },
        })
        .catch(() => [] as Array<{ externalId: string; platformUserId: string | null; ownerName: string; teamName: string }>),
    ])
    const nameFor = (rosterId: string, userId: string | null, platformId: string | null): string => {
      const user = userId ? users.find((u) => u.id === userId) : undefined
      const team = teams.find((t) => t.externalId === rosterId || (platformId && t.platformUserId === platformId))
      return safeDisplayName([user?.displayName, user?.username, team?.ownerName, team?.teamName], 'A league mate')
    }
    const proposerName = nameFor(trade.proposerRosterId, trade.proposedByUserId, proposerPlatformId)
    const receiverName = nameFor(trade.receiverRosterId, receiverPlatformId, receiverPlatformId)

    const playerIds = items.filter((i) => i.itemType === 'player' && i.itemReference).map((i) => i.itemReference as string)
    const players = playerIds.length
      ? await prisma.sportsPlayer
          .findMany({ where: { sleeperId: { in: playerIds } }, select: { sleeperId: true, name: true, position: true, team: true } })
          .catch(() => [] as Array<{ sleeperId: string | null; name: string; position: string | null; team: string | null }>)
      : []
    const playerById = new Map<string, { name: string; position: string | null; team: string | null }>()
    for (const p of players) if (p.sleeperId && !playerById.has(p.sleeperId)) playerById.set(p.sleeperId, p)

    type Parsed = { asset: TradeTakeAsset; card: TradeCardAsset | null; pick: boolean; extra: string | null; label: string }
    const parse = (item: NativeItem): Parsed => {
      const meta = record(item.metadata)
      const type = String(item.itemType ?? '').toLowerCase()
      if (type === 'player' && item.itemReference) {
        const known = playerById.get(item.itemReference)
        const name = str(meta.playerName) ?? str(meta.name) ?? known?.name ?? null
        const position = str(meta.position) ?? known?.position ?? null
        const team = str(meta.team) ?? known?.team ?? null
        return {
          asset: { kind: 'player', sleeperId: item.itemReference, name, position, team },
          card: { id: item.itemReference, name, position, team },
          pick: false,
          extra: null,
          label: name ?? 'an unknown player',
        }
      }
      if (type === 'rookie_pick' || type === 'future_pick') {
        const season = num(meta.pickSeason ?? meta.season)
        const round = num(meta.pickRound ?? meta.round)
        const label = season && round ? `a ${season} round ${round} pick` : round ? `a round ${round} pick` : 'a draft pick'
        return { asset: { kind: 'pick', season, round }, card: null, pick: true, extra: null, label }
      }
      const label =
        type === 'faab'
          ? `$${item.faabAmount ?? num(meta.amount) ?? 0} FAAB`
          : type === 'devy_pick'
            ? 'a devy pick'
            : (str(meta.label) ?? str(meta.name) ?? 'a special asset')
      return { asset: { kind: 'other', label }, card: null, pick: false, extra: label, label }
    }

    const toProposer = items.filter((i) => i.toRosterId === trade.proposerRosterId).map(parse)
    const toReceiver = items.filter((i) => i.toRosterId === trade.receiverRosterId).map(parse)

    const sides: [TradeTakeSide, TradeTakeSide] = [
      { manager: proposerName, receives: toProposer.map((p) => p.asset) },
      { manager: receiverName, receives: toReceiver.map((p) => p.asset) },
    ]
    const values = await readTradeMarketValues(league, now)
    const take = values
      ? buildChimmyTradeTake({ sides, players: values.players, isDynasty: values.isDynasty, seed: trade.id, now })
      : null

    const tradeCard: ChimmyTradeCard = {
      transactionId: trade.id,
      manager: proposerName,
      partner: receiverName,
      season: typeof league.season === 'number' ? league.season : null,
      week: null,
      gave: toReceiver.map((p) => p.card).filter((c): c is TradeCardAsset => c !== null),
      got: toProposer.map((p) => p.card).filter((c): c is TradeCardAsset => c !== null),
      picksGave: toReceiver.filter((p) => p.pick).length,
      picksGot: toProposer.filter((p) => p.pick).length,
      extrasGave: toReceiver.map((p) => p.extra).filter((e): e is string => Boolean(e)),
      extrasGot: toProposer.map((p) => p.extra).filter((e): e is string => Boolean(e)),
      valueGave: take ? take.sides[0].sent : null,
      valueGot: take ? take.sides[0].received : null,
      note: input.note ?? null,
      tradedAt: now.toISOString(),
    }
    const text =
      take?.text ??
      `${proposerName} traded ${describeList(toReceiver.map((p) => p.label))} to ${receiverName} for ${describeList(toProposer.map((p) => p.label))}.`

    return await postChimmyMoment({
      leagueId: trade.leagueId,
      kind: 'trade',
      dedupeKey: `native:${trade.id}`,
      text,
      card: { tradeCard },
      messageType: 'trade',
      now,
    })
  } catch (e) {
    console.warn('[chimmyTradeMoment] native trade take failed', {
      error: e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : typeof e,
    })
    return { posted: false, reason: 'error' }
  }
}
