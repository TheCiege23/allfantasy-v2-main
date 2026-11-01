import type { ZombieWeeklyResolution } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { loadNativeWeekResults } from '@/lib/zombie/ZombieInfectionEngine'
import { beta2025ContextFromSnapshot } from './beta2025Winnings'
import { computeWeeklyWinnings } from '@/lib/zombie/weeklyWinningsEngine'
import { parseZombieSettlementSnapshot } from '@/lib/zombie/weeklySettlementSnapshot'
import { planZombieOutcomeReplay } from '@/lib/zombie/outcomeCorrectionPlanner'

const pair = (home: string, away: string | null) => home + ':' + (away ?? '')
const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Replays a corrected native week from its pre-settlement snapshot in one DB transaction.
 * Combat decisions, auto-revival, later settled weeks, and post-week manager actions still
 * require commissioner reconciliation rather than a guessed rollback.
 */
export async function reconcileOutcomeChangingCorrection(input: {
  zombieLeagueId: string
  leagueId: string
  seasonId: string
  season: number
  week: number
  ownerUserId: string
  experienceMode: string | null
  previous: ZombieWeeklyResolution
}): Promise<ZombieWeeklyResolution | null> {
  const { zombieLeagueId, leagueId, seasonId, season, week, ownerUserId, experienceMode, previous } = input
  // A changed winner can alter 2025 cumulative loot and item ownership. The old replay
  // planner models infection shields; route this to explicit review until that planner is aligned.
  if (beta2025ContextFromSnapshot(previous.settlementSnapshot)) return null
  const snapshot = parseZombieSettlementSnapshot(previous.settlementSnapshot)
  if (!snapshot || !snapshot.config || !previous.resolvedAt) return null
  const [matchups, results, newer] = await Promise.all([
    prisma.redraftMatchup.findMany({
      where: { seasonId, week },
      select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
    }),
    loadNativeWeekResults(leagueId, week, season),
    prisma.zombieWeeklyResolution.findFirst({
      where: { zombieLeagueId, week: { gt: week }, status: 'complete' }, select: { id: true },
    }),
  ])
  if (newer || !results || !results.length || results.length !== matchups.length ||
      results.some(row => !row.final || !row.homeRosterId || !row.awayRosterId)) return null
  const prior = Array.isArray(previous.matchupResults) ? previous.matchupResults : []
  if (prior.length !== matchups.length || !matchups.every(row => prior.some(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    const before = raw as Record<string, unknown>
    return before.homeUserId === row.homeRosterId && before.awayUserId === row.awayRosterId
  }))) return null
  const resolvedResults = results.map(row => ({
    matchupId: row.matchupId,
    homeRosterId: row.homeRosterId!,
    awayRosterId: row.awayRosterId!,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
  }))
  const oldResults = resolvedResults.map(row => {
    const matchup = matchups.find(item => item.id === row.matchupId)
    const raw = prior.find(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !matchup) return false
      const value = item as Record<string, unknown>
      return value.homeUserId === matchup.homeRosterId && value.awayUserId === matchup.awayRosterId
    }) as Record<string, unknown> | undefined
    return { ...row, homeScore: Number(raw?.homeScore), awayScore: Number(raw?.awayScore) }
  })
  const oldPlan = planZombieOutcomeReplay(oldResults, snapshot, week, experienceMode)
  const plan = planZombieOutcomeReplay(resolvedResults, snapshot, week, experienceMode)
  if (!oldPlan || !plan) return null
  const expected = new Map(matchups.map(row => [row.id, row]))
  try {
    return await prisma.$transaction(async tx => {
      const live = await tx.zombieWeeklyResolution.findUnique({
        where: { zombieLeagueId_week: { zombieLeagueId, week } },
      })
      if (!live || live.status !== 'complete' || live.resolvedAt?.getTime() !== previous.resolvedAt?.getTime() ||
          JSON.stringify(live.matchupResults) !== JSON.stringify(previous.matchupResults)) return null
      const [now, later, bashings, maulings, laterActions, payoutRecords, owners, items, teams, oldLogs, oldEvents] = await Promise.all([
        tx.redraftMatchup.findMany({
          where: { seasonId, week },
          select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
        }),
        tx.zombieWeeklyResolution.count({ where: { zombieLeagueId, week: { gt: week }, status: 'complete' } }),
        tx.zombieBashingEvent.count({ where: { leagueId, week } }),
        tx.zombieMaulingEvent.count({ where: { leagueId, week } }),
        tx.zombieChimmyAction.count({
          where: { leagueId, week: { gte: week }, isValid: true, createdAt: { gt: live.resolvedAt! } },
        }),
        tx.zombieExternalWeeklyPayout.count({ where: { zombieLeagueId, week } }),
        tx.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
        tx.zombieTeamItem.findMany({ where: { zombieLeagueId } }),
        tx.zombieLeagueTeam.findMany({
          where: { leagueId },
          select: {
            id: true, rosterId: true, fantasyTeamName: true, displayName: true,
            status: true, weekBecameZombie: true, killedByRosterId: true,
          },
        }),
        tx.zombieInfectionLog.findMany({
          where: { leagueId, week }, select: { survivorRosterId: true, infectedByRosterId: true },
        }),
        tx.zombieInfectionEvent.findMany({
          where: { zombieLeagueId, week }, select: { victimUserId: true, infectorUserId: true },
        }),
      ])
      if (later || bashings || maulings || laterActions || payoutRecords || now.length !== expected.size) return null
      if (oldLogs.length !== oldPlan.infections.length || oldEvents.length !== oldPlan.infections.length ||
          oldPlan.infections.some(infection => !oldLogs.some(log =>
            log.survivorRosterId === infection.victimRosterId &&
            log.infectedByRosterId === infection.infectorRosterId))) return null
      if (now.some(row => {
        const old = expected.get(row.id)
        return !old || old.homeRosterId !== row.homeRosterId || old.awayRosterId !== row.awayRosterId ||
          old.homeScore !== row.homeScore || old.awayScore !== row.awayScore
      })) return null
      const ownerByRoster = new Map(owners.map(owner => [owner.id, owner.platformUserId]))
      if (snapshot.owners.length !== owners.length || snapshot.owners.some(owner =>
        ownerByRoster.get(owner.rosterId) !== owner.userId)) return null
      if (oldPlan.infections.some(infection => !oldEvents.some(event =>
        event.victimUserId === ownerByRoster.get(infection.victimRosterId) &&
        event.infectorUserId === ownerByRoster.get(infection.infectorRosterId)))) return null
      const beforeItem = new Map(snapshot.items.map(item => [item.id, item]))
      if (snapshot.items.some(item => {
        const current = items.find(row => row.id === item.id)
        if (!current || current.teamStatusId !== item.teamStatusId || current.userId !== item.userId) return true
        const wasPending = item.activationState === 'pending_activation' && item.activatesAtWeek === week
        const spentBefore = oldPlan.spentItemIds.includes(item.id)
        return current.isUsed !== (item.isUsed || spentBefore) ||
          (wasPending && (current.activationState !== 'ready' ||
            current.usedAtWeek !== (spentBefore ? week : item.usedAtWeek)))
      })) return null
      const extra = items.filter(item => !beforeItem.has(item.id))
      if (extra.some(item => item.acquiredAtWeek !== week || item.acquiredAt > live.resolvedAt! ||
          item.usedAtWeek != null || item.activatesAtWeek != null) ||
          items.some(item => (item.usedAtWeek ?? 0) > week || (item.activatesAtWeek ?? 0) > week)) return null
      const teamByRoster = new Map(teams.map(team => [team.rosterId, team]))
      if (snapshot.teams.length !== teams.length || snapshot.teams.some(team => {
        const liveTeam = teamByRoster.get(team.rosterId)
        const priorInfection = oldPlan.infections.find(infection => infection.victimRosterId === team.rosterId)
        return !liveTeam || liveTeam.id !== team.id || liveTeam.status !== oldPlan.statusByRoster.get(team.rosterId) ||
          liveTeam.weekBecameZombie !== (priorInfection ? week : team.weekBecameZombie) ||
          liveTeam.killedByRosterId !== (priorInfection ? priorInfection.infectorRosterId : team.killedByRosterId)
      })) return null
      // Only replace awards that the original final scores prove this settlement created.
      // A commissioner grant or another item earned during the week requires review.
      const expectedAwards = [
        ...oldPlan.serumAwards.map(award => ({
          teamStatusId: teamByRoster.get(award.rosterId)?.id,
          userId: ownerByRoster.get(award.rosterId),
          itemType: 'serum',
          awardKey: 'serum:' + zombieLeagueId + ':' + week + ':' + award.reason + ':' + award.rosterId,
        })),
        ...oldPlan.weaponAwards.map(award => ({
          teamStatusId: teamByRoster.get(award.rosterId)?.id,
          userId: ownerByRoster.get(award.rosterId),
          itemType: award.itemType,
          awardKey: null,
        })),
      ]
      const unmatched = [...expectedAwards]
      for (const item of extra) {
        const index = unmatched.findIndex(award =>
          award.teamStatusId === item.teamStatusId && award.userId === item.userId &&
          award.itemType === item.itemType && award.awardKey === item.awardKey)
        if (index < 0) return null
        unmatched.splice(index, 1)
      }
      if (unmatched.length) return null
      if (extra.length) {
        await tx.zombieTeamItem.deleteMany({ where: { id: { in: extra.map(item => item.id) } } })
      }
      for (const item of snapshot.items) {
        const spent = plan.spentItemIds.includes(item.id)
        const pending = item.activationState === 'pending_activation' && item.activatesAtWeek === week
        await tx.zombieTeamItem.update({
          where: { id: item.id },
          data: {
            teamStatusId: item.teamStatusId, userId: item.userId,
            isUsed: spent || item.isUsed, isExpired: item.isExpired,
            activationState: pending ? 'ready' : item.activationState,
            activatesAtWeek: pending && !spent ? null : item.activatesAtWeek,
            usedAtWeek: spent ? week : item.usedAtWeek,
            usedOnUserId: item.usedOnUserId,
            usedEffect: pending && !spent && item.itemType !== 'serum' ? null : item.usedEffect,
          },
        })
      }
      await tx.zombieInfectionEvent.deleteMany({ where: { zombieLeagueId, week } })
      await tx.zombieInfectionLog.deleteMany({ where: { leagueId, week } })
      const infectedByVictim = new Map(plan.infections.map(infection => [infection.victimRosterId, infection]))
      for (const team of snapshot.teams) {
        const infection = infectedByVictim.get(team.rosterId)
        await tx.zombieLeagueTeam.update({
          where: { id: team.id },
          data: {
            status: infection ? 'Zombie' : team.status,
            weekBecameZombie: infection ? week : team.weekBecameZombie,
            killedByRosterId: infection ? infection.infectorRosterId : team.killedByRosterId,
            revivedAt: team.revivedAt ? new Date(team.revivedAt) : null,
            ambushesRemaining: team.ambushesRemaining, ambushesUsed: team.ambushesUsed,
            infectionCount: team.infectionCount, isWhisperer: team.isWhisperer,
            killedAtWeek: team.killedAtWeek, killedByUserId: team.killedByUserId,
            survivorWinStreak: team.survivorWinStreak,
            zombieAttacksSurvived: team.zombieAttacksSurvived,
          },
        })
      }
      const { netByRoster, transfers } = computeWeeklyWinnings(results, plan.infections, snapshot.rules)
      for (const [rosterId, amount] of netByRoster) {
        await tx.zombieWeeklyWinnings.upsert({
          where: { leagueId_rosterId_week: { leagueId, rosterId, week } },
          create: { leagueId, zombieLeagueId, rosterId, week, amount, source: 'weekly_settlement' },
          update: { amount, source: 'weekly_settlement' },
        })
      }
      const ledger = await tx.zombieWeeklyWinnings.findMany({
        where: { leagueId }, select: { rosterId: true, amount: true },
      })
      const total = new Map<string, number>()
      for (const row of ledger) total.set(row.rosterId, (total.get(row.rosterId) ?? 0) + row.amount)
      for (const [rosterId, weeklyWinnings] of netByRoster) {
        await tx.zombieLeagueTeam.updateMany({
          where: { leagueId, rosterId },
          data: { weeklyWinnings, totalWinnings: round2(total.get(rosterId) ?? 0) },
        })
      }
      for (const infection of plan.infections) {
        const victimUserId = ownerByRoster.get(infection.victimRosterId)
        const infectorUserId = ownerByRoster.get(infection.infectorRosterId)
        if (!victimUserId || !infectorUserId) throw new Error('Correction roster owner missing')
        const transfer = transfers.find(row => row.kind === 'infection' &&
          row.fromRosterId === infection.victimRosterId && row.toRosterId === infection.infectorRosterId)
        await tx.zombieInfectionLog.create({
          data: {
            leagueId, zombieLeagueId, week, survivorRosterId: infection.victimRosterId,
            infectedByRosterId: infection.infectorRosterId, matchupId: infection.matchupId,
          },
        })
        await tx.zombieInfectionEvent.create({
          data: {
            zombieLeagueId, week, infectorUserId,
            infectorStatus: snapshot.teams.find(team => team.rosterId === infection.infectorRosterId)?.status ?? 'Zombie',
            infectorName: infectorUserId, victimUserId, victimName: victimUserId,
            victimPriorStatus: 'survivor', victimNewStatus: 'zombie',
            winningsTransferred: transfer?.amount ?? 0,
            infectorScore: infection.infectorScore, victimScore: infection.victimScore,
            scoreDifference: round2(infection.infectorScore - infection.victimScore),
            isStatCorrected: true, correctedAt: new Date(),
          },
        })
      }
      for (const award of plan.serumAwards) {
        const team = teamByRoster.get(award.rosterId)
        const userId = ownerByRoster.get(award.rosterId)
        if (!team || !userId) throw new Error('Serum award owner missing')
        await tx.zombieTeamItem.create({
          data: {
            teamStatusId: team.id, zombieLeagueId, userId,
            itemType: 'serum', itemLabel: '🧪 Serum', acquiredReason: award.reason,
            acquiredAtWeek: week,
            awardKey: 'serum:' + zombieLeagueId + ':' + week + ':' + award.reason + ':' + award.rosterId,
          },
        })
      }
      for (const award of plan.weaponAwards) {
        const team = teamByRoster.get(award.rosterId)
        const userId = ownerByRoster.get(award.rosterId)
        if (!team || !userId) throw new Error('Weapon award owner missing')
        await tx.zombieTeamItem.create({
          data: {
            teamStatusId: team.id, zombieLeagueId, userId,
            itemType: award.itemType, itemLabel: award.label, acquiredAtWeek: week,
          },
        })
      }
      const survivorCount = [...plan.statusByRoster.values()].filter(status => status === 'Survivor').length
      const hordeSize = [...plan.statusByRoster.values()].filter(status => status === 'Zombie').length
      if (snapshot.whisperer) {
        await tx.whispererRecord.update({
          where: { id: snapshot.whisperer.id },
          data: { hordeSizeAtPeak: Math.max(snapshot.whisperer.hordeSizeAtPeak, hordeSize) },
        })
      }
      const byMatchupId = new Map(results.map(row => [row.matchupId, row]))
      const corrected = matchups.map(matchup => {
        const mapped = byMatchupId.get(matchup.id)
        if (!mapped?.homeRosterId || !mapped.awayRosterId) throw new Error('Correction matchup mapping missing')
        const homeWon = matchup.homeScore > matchup.awayScore
        const awayWon = matchup.awayScore > matchup.homeScore
        const winnerRosterId = homeWon ? mapped.homeRosterId : awayWon ? mapped.awayRosterId : null
        const loserRosterId = homeWon ? mapped.awayRosterId : awayWon ? mapped.homeRosterId : null
        const winner = winnerRosterId ? teamByRoster.get(winnerRosterId) : null
        const loser = loserRosterId ? teamByRoster.get(loserRosterId) : null
        return {
          homeUserId: matchup.homeRosterId, awayUserId: matchup.awayRosterId,
          homeScore: matchup.homeScore, awayScore: matchup.awayScore,
          outcome: homeWon ? 'home' : awayWon ? 'away' : 'tie',
          winnerStatus: winnerRosterId ? plan.statusByRoster.get(winnerRosterId) ?? null : null,
          winnerName: winner?.fantasyTeamName || winner?.displayName || null,
          loserName: loser?.fantasyTeamName || loser?.displayName || null,
          winnerScore: homeWon ? matchup.homeScore : awayWon ? matchup.awayScore : null,
          loserScore: homeWon ? matchup.awayScore : awayWon ? matchup.homeScore : null,
        }
      })
      const resolution = await tx.zombieWeeklyResolution.update({
        where: { zombieLeagueId_week: { zombieLeagueId, week } },
        data: {
          matchupResults: toPrismaJsonInput(corrected),
          newZombies: plan.infections.map(infection => ownerByRoster.get(infection.victimRosterId)!).filter(Boolean),
          infectionCount: plan.infections.length, survivorCount, hordeSize,
          weeklyWinningsPool: round2([...netByRoster.values()].reduce((sum, amount) => sum + amount, 0)),
          winningsDistribution: toPrismaJsonInput(Object.fromEntries(netByRoster)),
          requiresStatCorrection: false,
        },
      })
      await tx.zombieAnnouncement.updateMany({
        where: { zombieLeagueId, week, type: 'weekly_recap' },
        data: { content: 'Week ' + week + ': ' + plan.infections.length +
          ' new infection(s). Horde ~' + hordeSize + ', Survivors ~' + survivorCount + '.' },
      })
      const body = 'Week ' + week + ' was recalculated after a score correction. ' +
        plan.infections.length + ' infection(s), ' + plan.serumAwards.length +
        ' serum award(s), and ' + plan.weaponAwards.length +
        ' weapon award(s) now reflect the final scores. Weekly winnings were reconciled.'
      const ann = await tx.zombieAnnouncement.upsert({
        where: { idempotencyKey: 'zombie-outcome-correction:' + zombieLeagueId + ':' + week },
        create: {
          zombieLeagueId, week, type: 'stat_correction', title: 'Week ' + week + ' outcome correction',
          content: body, isPublic: true, isPosted: true, postedAt: new Date(),
          idempotencyKey: 'zombie-outcome-correction:' + zombieLeagueId + ':' + week,
        },
        update: { content: body },
      })
      await tx.leagueChatMessage.upsert({
        where: { zombieWeeklyAnnouncementId: ann.id },
        create: {
          leagueId, userId: ownerUserId, message: body, type: 'host_announcement',
          zombieWeeklyAnnouncementId: ann.id,
          metadata: toPrismaJsonInput({
            senderIsHost: true, contentType: 'host_announcement', zombieOutcomeCorrection: true, week,
          }),
        },
        update: { message: body },
      })
      return resolution
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 })
  } catch {
    return null
  }
}
