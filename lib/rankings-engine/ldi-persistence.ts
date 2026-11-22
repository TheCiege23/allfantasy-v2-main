import { prisma } from '@/lib/prisma'
import { computeLeagueDemandIndex, type LeagueDemandIndex } from './league-demand-index'

function getMonday(d: Date): Date {
  const dt = new Date(d)
  dt.setUTCHours(0, 0, 0, 0)
  const day = dt.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diff)
  return dt
}

export async function persistLeagueDemand(
  leagueId: string,
  rangeDays: number = 90,
): Promise<LeagueDemandIndex> {
  const ldi = await computeLeagueDemandIndex(leagueId, rangeDays)
  const weekStart = getMonday(new Date())

  await prisma.leagueDemandWeekly.upsert({
    where: {
      leagueId_weekStart_rangeDays: { leagueId, weekStart, rangeDays },
    },
    create: {
      leagueId,
      weekStart,
      rangeDays,
      positionDemand: ldi.positionDemand as any,
      pickDemand: ldi.pickDemand as any,
      hotPlayers: ldi.hotPlayers as any,
      demandByPosition: ldi.demandJson as any,
      tradesAnalyzed: ldi.tradesAnalyzed,
    },
    update: {
      positionDemand: ldi.positionDemand as any,
      pickDemand: ldi.pickDemand as any,
      hotPlayers: ldi.hotPlayers as any,
      demandByPosition: ldi.demandJson as any,
      tradesAnalyzed: ldi.tradesAnalyzed,
    },
  })

  return ldi
}

interface DemandTrend {
  position: string
  weeks: { weekStart: string; demandScore: number; tradeVolume: number }[]
}

export async function getDemandTrends(
  leagueId: string,
  rangeDays: number = 90,
  weeksBack: number = 8,
): Promise<DemandTrend[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - weeksBack * 7)

  const rows = await prisma.leagueDemandWeekly.findMany({
    where: {
      leagueId,
      rangeDays,
      weekStart: { gte: cutoff },
    },
    orderBy: { weekStart: 'asc' },
  })

  const positions = ['QB', 'RB', 'WR', 'TE', 'PICK']
  const trends: DemandTrend[] = positions.map(pos => ({
    position: pos,
    weeks: rows.map(row => {
      const dj = row.demandByPosition as any
      if (dj && typeof dj === 'object' && dj[pos] && typeof dj[pos] === 'object') {
        return {
          weekStart: row.weekStart.toISOString().split('T')[0],
          demandScore: dj[pos].ldi ?? 50,
          tradeVolume: dj[pos].sample ?? 0,
        }
      }
      const pd = (row.positionDemand as any[]) ?? []
      const match = pd.find((p: any) => p.position === pos)
      return {
        weekStart: row.weekStart.toISOString().split('T')[0],
        demandScore: match?.demandScore ?? 50,
        tradeVolume: match?.tradeVolume ?? 0,
      }
    }),
  }))

  return trends
}

export async function getLatestDemandSnapshot(
  leagueId: string,
  rangeDays: number = 90,
) {
  const row = await prisma.leagueDemandWeekly.findFirst({
    where: { leagueId, rangeDays },
    orderBy: { weekStart: 'desc' },
  })

  if (!row) return null

  const dj = row.demandByPosition as any
  const hasDemandJson = dj && typeof dj === 'object' && dj.QB && typeof dj.QB === 'object'

  return {
    leagueId: row.leagueId,
    weekStart: row.weekStart.toISOString().split('T')[0],
    rangeDays: row.rangeDays,
    positionDemand: row.positionDemand as any[],
    pickDemand: row.pickDemand as any[],
    hotPlayers: row.hotPlayers as any[],
    demandByPosition: hasDemandJson ? dj : (row.demandByPosition as Record<string, number>),
    demandJson: hasDemandJson ? dj : null,
    tradesAnalyzed: row.tradesAnalyzed,
  }
}
