import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const tournamentCursorKey = 'season-tournament-worker:next-tournament'
const eligibleTournament = {
  status: 'rules_published',
  sport: { in: ['NFL', 'NBA'] },
  auditLogs: { some: { action: 'season_opening_field_frozen' } },
} satisfies Prisma.TournamentShellWhereInput

export async function claimNextSeasonTournament() {
  return prisma.$transaction(async tx => {
    // Keep selection and cursor advancement together across schedulers and retries.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tournamentCursorKey}, 0))::text`
    const cursor = await tx.platformConfig.findUnique({ where: { key: tournamentCursorKey }, select: { value: true } })
    const query = { orderBy: { id: 'asc' as const }, select: { id: true } }
    const after = cursor ? await tx.tournamentShell.findFirst({
      ...query, where: { ...eligibleTournament, id: { gt: cursor.value } },
    }) : null
    const next = after ?? await tx.tournamentShell.findFirst({ ...query, where: eligibleTournament })
    if (!next) return null
    await tx.platformConfig.upsert({
      where: { key: tournamentCursorKey },
      create: { key: tournamentCursorKey, value: next.id },
      update: { value: next.id },
    })
    return next
  })
}

/** Call under the tournament sweep lease. Every sweep gives a different room the first slot. */
export async function rotateSeasonRooms(tournamentId: string, ids: string[]) {
  if (ids.length < 2) return ids
  const key = 'season-tournament-worker:first-room:' + tournamentId
  const cursor = await prisma.platformConfig.findUnique({ where: { key }, select: { value: true } })
  const shift = cursor ? (ids.indexOf(cursor.value) + 1) % ids.length : 0
  const value = ids[shift]!
  await prisma.platformConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
  return [...ids.slice(shift), ...ids.slice(0, shift)]
}
