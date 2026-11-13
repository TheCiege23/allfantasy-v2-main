import 'server-only'
import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
export {
  resolveKeeperPolicy,
  supportsKeeperDeclarations,
} from './keeper-policy'

const prismaAny = prisma as any

export async function expireOverdueKeeperDeclarations(now = new Date()): Promise<number> {
  const result = await prismaAny.keeperDeclaration.updateMany({
    where: {
      status: 'declared',
      deadlineAt: {
        lt: now,
      },
    },
    data: {
      status: 'expired',
      updatedAt: now,
    },
  })

  return result.count
}

export async function auditDynastyCutdowns(): Promise<
  Array<{ leagueId: string; rosterId: string; overBy: number }>
> {
  const leagues = await prisma.league.findMany({
    where: {
      isDynasty: true,
    },
    select: {
      id: true,
      rosterSize: true,
      rosters: {
        select: {
          id: true,
          playerData: true,
        },
      },
    },
  })

  const flagged: Array<{ leagueId: string; rosterId: string; overBy: number }> = []
  for (const league of leagues) {
    const rosterSize = league.rosterSize ?? 0
    if (rosterSize <= 0) continue
    for (const roster of league.rosters) {
      const size = getRosterPlayerIds(roster.playerData).length
      if (size > rosterSize) {
        flagged.push({
          leagueId: league.id,
          rosterId: roster.id,
          overBy: size - rosterSize,
        })
      }
    }
  }

  return flagged
}
