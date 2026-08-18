import { prisma } from '@/lib/prisma'
import type { SleeperTransaction } from '@/lib/sleeper-client'
import { getAllPlayers, getLeagueRosters, getLeagueTransactions, getLeagueUsers } from '@/lib/api-cache/SleeperCacheLayer'
import type {
  PendingTrade,
  PendingTradeLeague,
  TradeAsset,
  TradesDashboardResponse,
} from '@/app/dashboard/dashboardStripApiTypes'

const TRADES_DASHBOARD_TTL_MS = 15 * 60 * 1000

type TradesLeagueCacheEntry = {
  league: PendingTradeLeague | null
  totalPending: number
}

function buildTradesDashboardCacheKey(leagueId: string): string {
  return `sleeper:dashboard:trades:${leagueId}`
}

type SleeperRoster = {
  roster_id?: number
  owner_id?: string
}

type SleeperUser = {
  user_id: string
  display_name?: string
  metadata?: { team_name?: string }
}

function isPendingTradeStatus(s: string | undefined): boolean {
  if (!s) return false
  const u = s.toLowerCase()
  return u === 'pending' || u === 'proposed' || u === 'waiting' || u === 'requested'
}

function buildTradeAssetsForRoster(args: {
  tx: SleeperTransaction
  userRosterId: number
  players: Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string }>
}): { assetsGiven: TradeAsset[]; assetsReceived: TradeAsset[] } {
  const { tx, userRosterId, players } = args
  const assetsGiven: TradeAsset[] = []
  const assetsReceived: TradeAsset[] = []

  const drops = tx.drops ?? {}
  const adds = tx.adds ?? {}

  for (const [playerId, rosterId] of Object.entries(drops)) {
    if (Number(rosterId) !== userRosterId) continue
    const pl = players[playerId]
    const name =
      pl?.full_name ?? ([pl?.first_name, pl?.last_name].filter(Boolean).join(' ') || playerId)
    assetsGiven.push({
      playerId,
      playerName: name,
      position: pl?.position ?? '—',
      team: pl?.team ?? '—',
    })
  }

  for (const [playerId, rosterId] of Object.entries(adds)) {
    if (Number(rosterId) !== userRosterId) continue
    const pl = players[playerId]
    const name =
      pl?.full_name ?? ([pl?.first_name, pl?.last_name].filter(Boolean).join(' ') || playerId)
    assetsReceived.push({
      playerId,
      playerName: name,
      position: pl?.position ?? '—',
      team: pl?.team ?? '—',
    })
  }

  for (const pick of tx.draft_picks ?? []) {
    const roundLabel = `${pick.season} ${pick.round}${pick.round === 1 ? 'st' : pick.round === 2 ? 'nd' : pick.round === 3 ? 'rd' : 'th'}`
    if (pick.roster_id === userRosterId) {
      assetsReceived.push({
        playerId: null,
        playerName: `Draft pick`,
        position: 'PICK',
        team: '—',
        isPick: true,
        pickRound: roundLabel,
      })
    }
  }

  return { assetsGiven, assetsReceived }
}

/** Pending Sleeper trades for the user’s teams (dashboard / Today Actions). */
export async function fetchTradesDashboard(userId: string): Promise<TradesDashboardResponse> {
  const leagues = await prisma.league.findMany({
    // Stable, total ordering: season and id are non-null and id is unique, so
    // the result set cannot silently reorder between requests. Mirrors
    // lib/dashboard/get-dashboard-league-list.ts so this set lines up with the
    // league list the user actually sees. Deliberately not lastSyncedAt: it is
    // nullable, and Postgres sorts NULLS FIRST on DESC, so never-synced leagues
    // would sort to the top.
    orderBy: [{ season: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    where: {
      platform: 'sleeper',
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: {
      id: true,
      name: true,
      sport: true,
      platformLeagueId: true,
      avatarUrl: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { platformUserId: true },
        take: 1,
      },
    },
  })

  const nflPlayers = await getAllPlayers().catch(() => ({} as Record<string, unknown>))

  const weeksToScan = Array.from({ length: 18 }, (_, i) => i + 1)

  const tradesOut: PendingTradeLeague[] = []
  let totalPending = 0

  for (const league of leagues) {
    if (!league.platformLeagueId) continue

    const ownerSleeperId = league.teams[0]?.platformUserId?.trim()
    if (!ownerSleeperId) continue

    const cacheKey = buildTradesDashboardCacheKey(league.platformLeagueId)
    const cachedRow = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
    const staleTrades = cachedRow?.data as TradesLeagueCacheEntry | null
    if (cachedRow && cachedRow.expiresAt > new Date() && staleTrades) {
      console.log(`[dashboard/trades] cache hit { leagueId: '${league.platformLeagueId}' }`)
      totalPending += staleTrades.totalPending
      if (staleTrades.league) {
        tradesOut.push(staleTrades.league)
      }
      continue
    }

    const leagueTrades: PendingTrade[] = []
    const prismaSport = String(league.sport)

    try {
      console.log(`[dashboard/trades] live refresh { leagueId: '${league.platformLeagueId}', reason: '${cachedRow ? 'stale' : 'miss'}' }`)

      const [rosters, users] = await Promise.all([
        getLeagueRosters(league.platformLeagueId).catch(() => []),
        getLeagueUsers(league.platformLeagueId).catch(() => []),
      ])

      const roster = Array.isArray(rosters)
        ? (rosters as SleeperRoster[]).find((r) => String(r.owner_id) === String(ownerSleeperId))
        : undefined
      const userRosterId = Number(roster?.roster_id)
      if (!Number.isFinite(userRosterId)) continue

      const userById = new Map(
        (Array.isArray(users) ? (users as SleeperUser[]) : [])
          .filter((u) => typeof u.user_id === 'string')
          .map((u) => [u.user_id, u]),
      )
      const seenTx = new Set<string>()

      const playersMap: Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string }> =
        prismaSport.toUpperCase() === 'NFL' ? (nflPlayers as Record<string, any>) : {}

      for (const week of weeksToScan) {
        const transactions = (await getLeagueTransactions(league.platformLeagueId, week).catch(() => [])) as SleeperTransaction[]
        if (!Array.isArray(transactions)) continue

        for (const tx of transactions) {
          if (tx.type !== 'trade') continue
          if (!isPendingTradeStatus(tx.status)) continue
          if (!tx.roster_ids?.includes(userRosterId)) continue
          if (seenTx.has(tx.transaction_id)) continue
          seenTx.add(tx.transaction_id)

          const { assetsGiven, assetsReceived } = buildTradeAssetsForRoster({
            tx,
            userRosterId,
            players: playersMap,
          })

          const creator = tx.creator ? userById.get(tx.creator) : undefined
          const proposedBy =
            creator?.metadata?.team_name ||
            creator?.display_name ||
            (tx.creator ? `Manager ${tx.creator.slice(0, 6)}` : 'Another team')

          leagueTrades.push({
            transactionId: tx.transaction_id,
            proposedBy,
            proposedAt: tx.created ? new Date(tx.created).toISOString() : null,
            assetsGiven,
            assetsReceived,
            chimmyVerdict: null,
            chimmyReason: '',
          })
        }
      }
    } catch {
      if (staleTrades) {
        console.log(`[dashboard/trades] stale fallback { leagueId: '${league.platformLeagueId}' }`)
        totalPending += staleTrades.totalPending
        if (staleTrades.league) {
          tradesOut.push(staleTrades.league)
        }
        continue
      }
      /* skip league */
    }

    const leaguePayload =
      leagueTrades.length > 0
        ? {
            leagueId: league.id,
            leagueName: league.name ?? 'League',
            leagueAvatar: league.avatarUrl ?? null,
            sport: prismaSport,
            trades: leagueTrades,
          }
        : null

    await prisma.sportsDataCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        data: {
          league: leaguePayload,
          totalPending: leagueTrades.length,
        } as unknown as object,
        expiresAt: new Date(Date.now() + TRADES_DASHBOARD_TTL_MS),
      },
      update: {
        data: {
          league: leaguePayload,
          totalPending: leagueTrades.length,
        } as unknown as object,
        expiresAt: new Date(Date.now() + TRADES_DASHBOARD_TTL_MS),
      },
    }).catch(() => {})
    console.log(`[dashboard/trades] saved SportsDataCache { leagueId: '${league.platformLeagueId}', cacheKey: '${cacheKey}' }`)

    if (leagueTrades.length > 0) {
      totalPending += leagueTrades.length
      tradesOut.push({
        leagueId: league.id,
        leagueName: league.name ?? 'League',
        leagueAvatar: league.avatarUrl ?? null,
        sport: prismaSport,
        trades: leagueTrades,
      })
    }
  }

  return {
    totalPending,
    trades: tradesOut,
  }
}
