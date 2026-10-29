import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const flags = ['needsChallengeLock', 'needsTribalLock', 'needsExileScore', 'needsPhaseAdvance', 'needsWeeklyRecap', 'needsWaiverProcess', 'needsPowerRankings'] as const

function readSnapshot(value: unknown, lastError: string | null): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (!lastError?.startsWith('PAUSED:')) return null
  try {
    const legacy = JSON.parse(lastError.slice('PAUSED:'.length))
    if (legacy.snapshot && typeof legacy.snapshot === 'object') return legacy.snapshot
  } catch { /* Older pauses used a plain text marker. */ }
  return { needsChallengeLock: true, needsTribalLock: true, needsExileScore: true, needsPhaseAdvance: true }
}

/** Preserve the existing pause snapshot contract, including time remaining on Council clocks. */
export async function setCouncilPaused(leagueId: string, actorUserId: string, paused: boolean) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const game = await tx.survivorGameState.findUnique({ where: { leagueId } })
    if (!game) return { ok: false, status: 409, error: 'Season state unavailable' }
    const existing = readSnapshot(game.pausedSnapshot, game.lastError)
    if ((existing != null) === paused) return { ok: true, changed: false }
    const now = new Date()
    const snapshot = existing ?? {}
    const restored = Object.fromEntries(flags.map(flag => [flag, paused ? false : typeof snapshot[flag] === 'boolean' ? snapshot[flag] : game[flag]]))
    if (!paused && typeof snapshot.pausedAt === 'string') {
      const elapsed = Math.max(0, now.getTime() - new Date(snapshot.pausedAt).getTime())
      const councils = await tx.survivorTribalCouncil.findMany({ where: { leagueId, isRevealed: false, status: { in: ['scheduled', 'voting_open', 'closed', 'tie_pending'] } }, select: { id: true, voteDeadlineAt: true, votingOpensAt: true } })
      for (const council of councils) {
        const deadline = new Date(council.voteDeadlineAt.getTime() + elapsed)
        await tx.survivorTribalCouncil.update({ where: { id: council.id }, data: { voteDeadlineAt: deadline, votingDeadline: deadline, ...(council.votingOpensAt && council.votingOpensAt > new Date(snapshot.pausedAt) ? { votingOpensAt: new Date(council.votingOpensAt.getTime() + elapsed) } : {}) } })
        const readDeadline = game.tribalDeadline ? new Date(game.tribalDeadline.getTime() + elapsed) : deadline
        await tx.survivorGameState.updateMany({ where: { leagueId, activeCouncilId: council.id }, data: { tribalDeadline: readDeadline } })
      }
    }
    const nextSnapshot = { ...Object.fromEntries(flags.map(flag => [flag, game[flag]])), pausedAt: now.toISOString() }
    await tx.survivorGameState.update({ where: { leagueId }, data: { ...restored,
      pausedSnapshot: paused ? nextSnapshot : Prisma.JsonNull,
      lastError: paused ? `PAUSED:${JSON.stringify({ notes: 'Season paused by commissioner', snapshot: nextSnapshot })}` : null,
    } })
    await tx.survivorCommissionerAction.create({ data: { leagueId, commissionerId: actorUserId, week: game.currentWeek, actionType: paused ? 'pause_season' : 'resume_season', description: paused ? 'League paused; Council clock frozen' : 'League resumed; Council clock restored' } })
    return { ok: true, changed: true }
  })
}
