import 'server-only'
import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'

/**
 * TRADES, POSTED INTO LEAGUE CHAT AS CARDS PEOPLE CAN REACT TO.
 *
 * Draft picks have done this since they were written — production holds 157
 * `draft_pick` rows in league chat — and nothing else ever did. A trade, the
 * single most argued-about event in a fantasy league, produced no message at
 * all, so the conversation about it happened somewhere else or not at all.
 *
 * ⚠ IT CANNOT POST HISTORY, AND THAT IS THE WHOLE DESIGN. Every trade we hold
 * is ingested, not created here: production has 7,829 `LeagueTrade` rows dating
 * back to 2022. A first run that simply looked for "trades without a card"
 * would dump years of old trades into 36 live league chats at once. So the
 * FIRST run for a league posts NOTHING — it records a watermark and stops.
 * Only trades that arrive after that are ever carded. Fail-safe by
 * construction: the failure mode of a bug here is silence, not a flood.
 *
 * ⚠ ONE CARD PER TRADE, NOT ONE PER SIDE. `LeagueTrade` is stored per owner —
 * the same `transactionId` appears once for each roster involved, each row
 * describing that side's give and take. Carding rows would post every trade
 * twice, from both directions, which reads like two different trades.
 *
 * ⚠ MOST TRADES WE HOLD BELONG TO NO LEAGUE OF OURS. `LeagueTradeHistory` is
 * keyed by Sleeper league id and was populated far more widely than our own
 * imports: only 715 of those 7,829 rows (36 of 227 leagues) map to a `League`.
 * The rest have no chat to post into, which is correct and not a gap to close.
 */

/** Watermark + throttle live here; a chat card stream is not worth a migration. */
const CACHE_PREFIX = 'trade-cards:'

/** How often a read is allowed to trigger a scan. */
const SCAN_INTERVAL_MS = 5 * 60 * 1000

/** Never card more than this in one pass, however far behind we are. */
const MAX_CARDS_PER_RUN = 5

type Watermark = {
  /** ISO. Trades at or before this are considered already handled. */
  since: string
  /** ISO. When a scan last ran, so a busy chat does not scan on every poll. */
  checkedAt: string
}

export type TradeCardSyncResult =
  | { status: 'seeded' }
  | { status: 'throttled' }
  | { status: 'scanned'; posted: number }
  | { status: 'skipped'; reason: 'no-league' | 'not-sleeper' | 'error' }

function cacheKey(leagueId: string): string {
  return `${CACHE_PREFIX}${leagueId}`
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

/**
 * A readable summary of one side of a trade.
 *
 * Names, never ids. Every traded player id in production resolves against
 * `SportsPlayer.sleeperId` — all 1,830 of them — so a card reading "traded 4035
 * for 6794" would be a rendering failure, not a data limitation.
 */
function describeSide(players: string[], picks: unknown, nameOf: Map<string, string>): string {
  const named = players.map((id) => nameOf.get(id) ?? 'an unknown player')
  const pickCount = Array.isArray(picks) ? picks.length : 0

  if (named.length === 0 && pickCount === 0) return 'nothing'
  if (pickCount === 0) return named.join(', ')
  const pickPart = `${pickCount} pick${pickCount === 1 ? '' : 's'}`
  return named.length === 0 ? pickPart : `${named.join(', ')} + ${pickPart}`
}

async function readWatermark(leagueId: string): Promise<Watermark | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: cacheKey(leagueId) } })
    .catch(() => null)
  const data = row?.data as Watermark | null
  if (!data?.since) return null
  return data
}

async function writeWatermark(leagueId: string, mark: Watermark): Promise<void> {
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: cacheKey(leagueId) },
      update: { data: mark as never, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
      create: {
        cacheKey: cacheKey(leagueId),
        data: mark as never,
        /*
         * A year. This is a watermark, not a cache: if it expired, the next run
         * would re-seed and every trade since would look new. Long TTL keeps it
         * inside the one keyed store we have without pretending it is cacheable.
         */
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    })
    .catch(() => undefined)
}

/**
 * Post cards for trades that arrived since the last run.
 *
 * Safe to call on a read path: it throttles itself, and it never throws — a
 * chat that failed to load because a card could not be written would be a far
 * worse outcome than a chat missing a card.
 */
export async function syncTradeCardsForLeague(leagueId: string): Promise<TradeCardSyncResult> {
  if (!leagueId) return { status: 'skipped', reason: 'no-league' }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, userId: true, platformLeagueId: true },
    })
    if (!league?.platformLeagueId) return { status: 'skipped', reason: 'not-sleeper' }

    const now = Date.now()
    const mark = await readWatermark(leagueId)

    /*
     * First sight of this league: remember where we are and post nothing. This
     * is what stops years of ingested history landing in a live chat.
     */
    if (!mark) {
      await writeWatermark(leagueId, {
        since: new Date(now).toISOString(),
        checkedAt: new Date(now).toISOString(),
      })
      return { status: 'seeded' }
    }

    const checkedAt = Date.parse(mark.checkedAt)
    if (Number.isFinite(checkedAt) && now - checkedAt < SCAN_INTERVAL_MS) {
      return { status: 'throttled' }
    }

    const since = new Date(mark.since)

    const rows = await prisma.leagueTrade.findMany({
      where: {
        history: { sleeperLeagueId: league.platformLeagueId },
        tradeDate: { gt: since },
      },
      orderBy: { tradeDate: 'asc' },
      take: 100,
      select: {
        transactionId: true,
        tradeDate: true,
        week: true,
        season: true,
        playersGiven: true,
        playersReceived: true,
        picksGiven: true,
        picksReceived: true,
        history: { select: { sleeperUsername: true } },
      },
    })

    /* Nothing new: still move the throttle so the next poll does not re-scan. */
    if (rows.length === 0) {
      await writeWatermark(leagueId, { since: mark.since, checkedAt: new Date(now).toISOString() })
      return { status: 'scanned', posted: 0 }
    }

    /* One card per transaction, keeping the first side seen for its narrative. */
    const byTransaction = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (!byTransaction.has(row.transactionId)) byTransaction.set(row.transactionId, row)
    }

    const batch = [...byTransaction.values()].slice(0, MAX_CARDS_PER_RUN)

    const playerIds = new Set<string>()
    for (const row of batch) {
      for (const id of asStringArray(row.playersGiven)) playerIds.add(id)
      for (const id of asStringArray(row.playersReceived)) playerIds.add(id)
    }

    const players = playerIds.size
      ? await prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: [...playerIds] } },
            select: { sleeperId: true, name: true, position: true, team: true },
          })
          .catch(() => [])
      : []

    const nameOf = new Map<string, string>()
    const metaOf = new Map<string, { position: string | null; team: string | null }>()
    for (const p of players) {
      if (!p.sleeperId) continue
      nameOf.set(p.sleeperId, p.name)
      metaOf.set(p.sleeperId, { position: p.position ?? null, team: p.team ?? null })
    }

    let posted = 0
    let newest = since

    for (const row of batch) {
      const gave = asStringArray(row.playersGiven)
      const got = asStringArray(row.playersReceived)
      const manager = row.history?.sleeperUsername || 'A manager'

      const body = `${manager} traded ${describeSide(gave, row.picksGiven, nameOf)} for ${describeSide(got, row.picksReceived, nameOf)}`

      const created = await createLeagueChatMessage(leagueId, league.userId, body, {
        type: 'trade',
        metadata: {
          tradeCard: {
            transactionId: row.transactionId,
            manager,
            season: row.season,
            week: row.week,
            gave: gave.map((id) => ({ id, name: nameOf.get(id) ?? null, ...(metaOf.get(id) ?? {}) })),
            got: got.map((id) => ({ id, name: nameOf.get(id) ?? null, ...(metaOf.get(id) ?? {}) })),
            picksGave: Array.isArray(row.picksGiven) ? row.picksGiven.length : 0,
            picksGot: Array.isArray(row.picksReceived) ? row.picksReceived.length : 0,
            tradedAt: row.tradeDate ? row.tradeDate.toISOString() : null,
          },
          /* Same flag draft picks carry: never resynced outward as user content. */
          leagueChatSyncExcluded: true,
        },
      }).catch(() => null)

      if (created) posted += 1
      if (row.tradeDate && row.tradeDate > newest) newest = row.tradeDate
    }

    await writeWatermark(leagueId, {
      since: newest.toISOString(),
      checkedAt: new Date(now).toISOString(),
    })

    return { status: 'scanned', posted }
  } catch {
    return { status: 'skipped', reason: 'error' }
  }
}
