import type { DevyDraftPick, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type PickInventoryYear = {
  year: number
  rookiePicks: PickSummary[]
  devyPicks: PickSummary[]
}

export type PickSummary = {
  id: string
  round: number
  originalOwnerId: string
  currentOwnerId: string
  pickType: string
  isTradeable: boolean
  isUsed: boolean
}

export type PickInventory = {
  leagueId: string
  seasonStart: number
  yearsAhead: number
  years: PickInventoryYear[]
}

const DEFAULT_ROUNDS = 4

async function latestRedraftSeasonId(leagueId: string): Promise<string | null> {
  const s = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true },
  })
  return s?.id ?? null
}

export async function generatePickInventory(
  leagueId: string,
  season: number,
  yearsAhead: number = 3,
): Promise<PickInventory> {
  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  const settings = await prisma.leagueSettings.findUnique({ where: { leagueId } })
  const rounds = settings?.rounds ?? DEFAULT_ROUNDS

  const seasonId = await latestRedraftSeasonId(leagueId)
  const rosters = seasonId
    ? await prisma.redraftRoster.findMany({
        where: { seasonId },
        select: { id: true },
      })
    : []
  const rosterIds = rosters.map(r => r.id)

  const existing = await prisma.devyDraftPick.findMany({
    where: { leagueId, season: { gte: season, lte: season + yearsAhead } },
    orderBy: [{ season: 'asc' }, { round: 'asc' }],
  })

  const years: PickInventoryYear[] = []
  for (let y = 0; y <= yearsAhead; y++) {
    const year = season + y
    const yearRows = existing.filter(p => p.season === year)
    const rookiePicks = yearRows
      .filter(p => p.pickType === 'rookie')
      .map(p => summarizePick(p))
    const devyPicks = yearRows
      .filter(p => p.pickType === 'devy')
      .map(p => summarizePick(p))

    if (cfg && yearRows.length === 0 && rosterIds.length > 0) {
      // Structural template when picks not materialized yet (IDs are placeholders only in API consumers).
      for (const rid of rosterIds) {
        for (let r = 1; r <= rounds; r++) {
          rookiePicks.push({
            id: `template-rookie-${year}-${r}-${rid}`,
            round: r,
            originalOwnerId: rid,
            currentOwnerId: rid,
            pickType: 'rookie',
            isTradeable: cfg.rookiePickTradingEnabled,
            isUsed: false,
          })
          if (cfg.futureDraftFormat === 'separate') {
            devyPicks.push({
              id: `template-devy-${year}-${r}-${rid}`,
              round: r,
              originalOwnerId: rid,
              currentOwnerId: rid,
              pickType: 'devy',
              isTradeable: cfg.devyPickTradingEnabled,
              isUsed: false,
            })
          }
        }
      }
    }

    years.push({ year, rookiePicks, devyPicks })
  }

  return { leagueId, seasonStart: season, yearsAhead, years }
}

function summarizePick(p: DevyDraftPick): PickSummary {
  return {
    id: p.id,
    round: p.round,
    originalOwnerId: p.originalOwnerId,
    currentOwnerId: p.currentOwnerId,
    pickType: p.pickType,
    isTradeable: p.isTradeable,
    isUsed: p.isUsed,
  }
}

/**
 * Move a devy pick's ownership. ⚠ AUTHORIZES NOTHING: it checks only that `fromRosterId` currently
 * owns the pick — not who is asking, and not that the receiving team agreed. Its one caller,
 * `PATCH /api/devy/picks`, was removed on 2026-09-25 for exactly that reason. Call it only from a path
 * that has already established consent and authority (the trade engine), never from a request body.
 */
export async function processPickTrade(
  leagueId: string,
  fromRosterId: string,
  toRosterId: string,
  pickId: string,
): Promise<DevyDraftPick> {
  const pick = await prisma.devyDraftPick.findFirst({
    where: { id: pickId, leagueId },
  })
  if (!pick) throw new Error('Pick not found')
  if (!pick.isTradeable) throw new Error('Pick is not tradeable')
  if (pick.isUsed) throw new Error('Pick already used')
  if (pick.currentOwnerId !== fromRosterId) throw new Error('Pick not owned by fromRosterId')

  const history = Array.isArray(pick.tradeHistory)
    ? ([...(pick.tradeHistory as unknown[])] as { fromOwnerId: string; toOwnerId: string; tradeDate: string }[])
    : []
  history.push({
    fromOwnerId: fromRosterId,
    toOwnerId: toRosterId,
    tradeDate: new Date().toISOString(),
  })

  return prisma.devyDraftPick.update({
    where: { id: pickId },
    data: {
      currentOwnerId: toRosterId,
      tradeHistory: history as unknown as Prisma.InputJsonValue,
    },
  })
}
