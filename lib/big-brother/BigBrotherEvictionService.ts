import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { tallyEvictionVotes } from './BigBrotherVoteEngine'
import { announceEviction } from './BigBrotherChatAnnouncements'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import type { BigBrotherEvictionResult } from './types'

export interface CloseEvictionOptions { systemUserId?: string | null; evictedDisplayName?: string; postToChat?: boolean; commissionerTieBreakRosterId?: string }

/** Commit eviction, roster archive/release and jury enrollment together. A competing closer loses the guarded update. */
export async function closeEviction(cycleId: string, options?: CloseEvictionOptions): Promise<{ ok: boolean; result?: BigBrotherEvictionResult; error?: string }> {
  const cycle = await prisma.bigBrotherCycle.findUnique({ where: { id: cycleId } })
  if (!cycle) return { ok: false, error: 'Cycle not found' }
  if (cycle.closedAt || cycle.evictedRosterId) return { ok: false, error: 'Eviction already closed' }
  if (cycle.phase !== 'VOTING_OPEN' && cycle.phase !== 'VOTING_LOCKED') return { ok: false, error: 'Voting is not open' }
  const config = await getBigBrotherConfig(cycle.leagueId)
  if (!config) return { ok: false, error: 'Not a Big Brother league' }
  // Lock before tally: submitEvictionVote serializes its write against this same cycle row.
  const lock = await prisma.bigBrotherCycle.updateMany({ where: { id: cycleId, closedAt: null, phase: { in: ['VOTING_OPEN', 'VOTING_LOCKED'] } }, data: { phase: 'VOTING_LOCKED' } })
  if (lock.count !== 1) return { ok: false, error: 'Cycle changed; refresh and retry' }
  const tally = await tallyEvictionVotes(cycleId)
  let evictedRosterId = tally.evictedRosterId
  if (options?.commissionerTieBreakRosterId) {
    const maxVotes = Math.max(...Object.values(tally.votesByTarget))
    if (config.evictionTieBreakMode !== 'commissioner' || !tally.tied || tally.votesByTarget[options.commissionerTieBreakRosterId] !== maxVotes) {
      return { ok: false, error: 'Commissioner selection must be a tied nominee under the commissioner tie-break rule' }
    }
    evictedRosterId = options.commissionerTieBreakRosterId
  }
  if (!evictedRosterId) return { ok: false, error: 'No valid eviction result; commissioner review required' }
  let releasedPlayerCount = 0
  try {
    const result = await prisma.$transaction(async tx => {
      const changed = await tx.bigBrotherCycle.updateMany({ where: { id: cycleId, closedAt: null, evictedRosterId: null, phase: 'VOTING_LOCKED' }, data: {
        phase: 'EVICTION_RESOLVED', closedAt: new Date(), evictedRosterId,
        tieBreakSeasonPoints: tally.tieBreakSeasonPoints ? tally.tieBreakSeasonPoints as Prisma.InputJsonValue : Prisma.JsonNull,
      } })
      if (changed.count !== 1) throw new Error('Eviction already closed')
      const roster = await tx.roster.findFirst({ where: { id: evictedRosterId, leagueId: cycle.leagueId }, select: { id: true, playerData: true, platformUserId: true } })
      if (!roster) throw new Error('Evicted roster does not belong to this league')
      releasedPlayerCount = getRosterPlayerIds(roster.playerData).length
      await tx.bigBrotherAuditLog.create({ data: { leagueId: cycle.leagueId, configId: cycle.configId, eventType: 'roster_archived', metadata: { cycleId, week: cycle.week, rosterId: roster.id, playerDataSnapshot: roster.playerData } as Prisma.InputJsonValue } })
      // Clear every playable representation, preserving identity and other roster metadata.
      const cleared = Array.isArray(roster.playerData) ? [] : { ...(roster.playerData as object), players: [], starters: [], reserve: [], taxi: [], lineup_sections: { starters: [], bench: [], ir: [], taxi: [], devy: [] } }
      await tx.roster.update({ where: { id: roster.id }, data: { playerData: cleared } })
      const [rosters, evictions] = await Promise.all([
        tx.roster.findMany({ where: { leagueId: cycle.leagueId }, select: { id: true } }),
        tx.bigBrotherCycle.findMany({ where: { leagueId: cycle.leagueId, configId: cycle.configId, evictedRosterId: { not: null } }, select: { evictedRosterId: true } }),
      ])
      const known = new Set(rosters.map(r => r.id))
      const out = new Set(evictions.map(c => c.evictedRosterId).filter((id): id is string => !!id && known.has(id)))
      const remaining = rosters.length - out.size
      const juryEnrolled = config.juryStartMode === 'after_eliminations' ? out.size >= (config.juryStartAfterEliminations ?? 0)
        : config.juryStartMode === 'when_remaining' ? remaining <= (config.juryStartWhenRemaining ?? 0) : cycle.week >= (config.juryStartWeek ?? 0)
      if (juryEnrolled) {
        await tx.bigBrotherJuryMember.upsert({ where: { leagueId_rosterId: { leagueId: cycle.leagueId, rosterId: evictedRosterId } }, create: { leagueId: cycle.leagueId, configId: cycle.configId, rosterId: evictedRosterId, evictedWeek: cycle.week }, update: {} })
        await tx.bigBrotherAuditLog.create({ data: { leagueId: cycle.leagueId, configId: cycle.configId, eventType: 'jury_enrolled', metadata: { rosterId: evictedRosterId, evictedWeek: cycle.week } } })
      }
      await tx.bigBrotherAuditLog.create({ data: { leagueId: cycle.leagueId, configId: cycle.configId, eventType: 'eviction', metadata: { cycleId, week: cycle.week, evictedRosterId, voteCount: tally.votesByTarget, tied: tally.tied, commissionerTieBreak: !!options?.commissionerTieBreakRosterId, juryEnrolled, releasedPlayerCount } } })
      return { cycleId, week: cycle.week, evictedRosterId, voteCount: tally.votesByTarget, tieBreakUsed: tally.tied, juryEnrolled }
    })
    // Keep the existing optional warehouse history, using the actual season and pre-release count.
    try {
      const league = await prisma.league.findUnique({ where: { id: cycle.leagueId }, select: { sport: true, season: true } })
      if (league) await prisma.transactionFact.create({ data: { leagueId: cycle.leagueId, sport: league.sport, type: 'big_brother_eviction', rosterId: evictedRosterId,
        season: league.season, weekOrPeriod: cycle.week, payload: { cycleId, week: cycle.week, voteCount: tally.votesByTarget, tied: tally.tied, releasedPlayerCount } } })
    } catch { /* Warehouse history is optional; the transactional game audit is authoritative. */ }
    if (options?.postToChat !== false) {
      // The committed result remains authoritative if chat is temporarily unavailable.
      await announceEviction({ leagueId: cycle.leagueId, week: cycle.week, evictedRosterId, evictedName: options?.evictedDisplayName,
        voteCount: tally.votesByTarget, showExactTotals: config.publicVoteTotalsVisibility === 'exact', tieBreakUsed: tally.tied,
        juryEnrolled: result.juryEnrolled, systemUserId: options?.systemUserId }).catch(() => {})
    }
    return { ok: true, result }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Eviction failed' } }
}
