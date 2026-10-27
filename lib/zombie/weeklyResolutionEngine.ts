import type { ZombieWeeklyResolution } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { resolveWeeklyInfections } from '@/lib/zombie/infectionEngine'
import { autoReviveEligibleZombies, awardNativeSerumsForWeek, finalizePendingSerumsForWeek } from '@/lib/zombie/serumEngine'
import { detectAndProcessBashings } from '@/lib/zombie/bashingEngine'
import { detectAndProcessMaulings } from '@/lib/zombie/maulingEngine'
import { checkAndAwardWeapons, finalizePendingWeaponsForWeek } from '@/lib/zombie/weaponEngine'
import { tryPostWeeklyUpdateAfterResolution } from '@/lib/zombie/weeklyUpdateEngine'
import { syncUniverseStats } from '@/lib/zombie/universeStatEngine'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { getLastScheduledWeek, getZombieWeekReadiness } from '@/lib/zombie/matchupCompletion'
import { logAuditEntry } from '@/lib/zombie/auditService'
import { getLeagueMode } from '@/lib/zombie/zombieLeagueMode'
import { applyZombieHordeSitOutToScoring } from '@/lib/zombie/ZombieHordeSitOutEngine'
import { settleWeeklyWinnings } from '@/lib/zombie/weeklyWinningsEngine'
import { syncZombieTeamNames } from '@/lib/zombie/zombieTeamNames'
import { reconcileScoreOnlyCorrection } from '@/lib/zombie/statCorrectionReconciler'
import { captureZombieSettlementSnapshot } from '@/lib/zombie/weeklySettlementSnapshot'
import { reconcileOutcomeChangingCorrection } from '@/lib/zombie/outcomeCorrectionReconciler'

export type WeeklyResolutionOptions = {
  /** Re-run infections + recap even if this week already resolved (stat corrections / commissioner). */
  force?: boolean
  /** Optional reason for forced replay. */
  reason?: 'manual' | 'stat_correction'
}

export type WeeklyResolutionRunResult = {
  resolution: ZombieWeeklyResolution | null
  skipped?: boolean
  reason?: string
}

/**
 * Master weekly orchestrator — gated on finalized matchups, then infections → items → combat → audits → recap.
 */
export async function runWeeklyResolution(
  zombieLeagueId: string,
  week: number,
  opts?: WeeklyResolutionOptions,
): Promise<WeeklyResolutionRunResult> {
  const z = await prisma.zombieLeague.findUnique({
    where: { id: zombieLeagueId },
    include: { league: true },
  })
  if (!z) throw new Error('Zombie league not found')

  const existing = await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId, week } },
  })
  if (existing?.status === 'complete' && existing.resolvedAt) {
    if (!opts?.force) return { resolution: existing }
    // A completed week has already moved roles, items and winnings. Running the ordinary
    // settlement again would duplicate those effects. Until reversal is transactional, place
    // a changed score in the commissioner exception queue instead of silently replaying it.
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId: z.leagueId, season: z.season }, select: { id: true },
    })
    const current = season ? await prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, week }, select: {
        homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true,
      },
    }) : []
    const previous: unknown[] = Array.isArray(existing.matchupResults) ? existing.matchupResults : []
    const same = current.length === previous.length && current.every((matchup) =>
      previous.some((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const old = raw as Record<string, unknown>
        return old.homeUserId === matchup.homeRosterId &&
          old.awayUserId === matchup.awayRosterId &&
          old.homeScore === matchup.homeScore && old.awayScore === matchup.awayScore
      }))
    if (same) {
      if (existing.requiresStatCorrection) {
        const cleared = await prisma.zombieWeeklyResolution.update({
          where: { zombieLeagueId_week: { zombieLeagueId, week } },
          data: { requiresStatCorrection: false },
        })
        return { resolution: cleared }
      }
      return { resolution: existing }
    }
    if (opts.reason === 'stat_correction' && season && z.league.userId) {
      const reconciled = await reconcileScoreOnlyCorrection({
        zombieLeagueId, leagueId: z.leagueId, seasonId: season.id, season: z.season,
        sport: z.sport, week, ownerUserId: z.league.userId, previous: existing,
      }).catch(() => null)
      if (reconciled) return { resolution: reconciled }
      const replayed = await reconcileOutcomeChangingCorrection({
        zombieLeagueId, leagueId: z.leagueId, seasonId: season.id, season: z.season,
        week, ownerUserId: z.league.userId, experienceMode: z.experienceMode,
        previous: existing,
      }).catch(() => null)
      if (replayed) {
        if (z.universeId) await syncUniverseStats(z.universeId, week).catch(() => null)
        return { resolution: replayed }
      }
    }
    const marked = await prisma.zombieWeeklyResolution.updateMany({
      where: { zombieLeagueId, week, status: 'complete', requiresStatCorrection: false },
      data: { requiresStatCorrection: true },
    })
    if (marked.count > 0) {
      await notifyCommissioner(z.leagueId, 'commissioner_override_required',
        `Week ${week} score correction needs reconciliation`,
        'A finalized matchup changed. Review roles, items, and winnings before this week is replayed.',
        { urgency: 'critical', requiresAction: true, week }).catch(() => {})
    }
    return { resolution: { ...existing, requiresStatCorrection: true }, skipped: true, reason: 'stat_correction_reconciliation_required' }
  }

  /*
   * 🛑 `force` REPLAYS A RESOLVED WEEK; IT DOES NOT RESOLVE AN UNFINISHED ONE. This gate used to sit
   * under `!opts?.force`, so a forced run on a week whose matchups were not final skipped every one of
   * them (the infection engine reads only final scores), wrote "complete, 0 infections", and moved the
   * league on — a week of the game silently erased. A stat-correction replay is of a sealed week, so it
   * still passes.
   */
  const readiness = await getZombieWeekReadiness(z.leagueId, week, z.season)
  if (!readiness.ready) {
    return { resolution: null, skipped: true, reason: 'matchups_incomplete' }
  }

  // A completed week can only be replayed from the state before its first side effect.
  // Capture once. A retry of an already-resolving week must never replace the original snapshot.
  const settlementSnapshot = (!existing || (existing.status === 'pending' && !existing.settlementSnapshot))
    ? await captureZombieSettlementSnapshot(z.leagueId, zombieLeagueId, z.sport)
    : null
  if (existing?.status === 'pending' && settlementSnapshot) {
    await prisma.zombieWeeklyResolution.updateMany({
      where: { id: existing.id, status: 'pending' },
      data: { settlementSnapshot: toPrismaJsonInput(settlementSnapshot) },
    })
  }
  await prisma.zombieWeeklyResolution.upsert({
    where: { zombieLeagueId_week: { zombieLeagueId, week } },
    create: {
      zombieLeagueId,
      week,
      status: 'resolving',
      matchupResults: [],
      newZombies: [],
      infectionCount: 0,
      ...(settlementSnapshot ? { settlementSnapshot: toPrismaJsonInput(settlementSnapshot) } : {}),
    },
    update: { status: 'resolving' },
  })

  await logAuditEntry(zombieLeagueId, {
    category: 'weekly_update',
    action: 'RESOLUTION_STARTED',
    description: `Weekly resolution started for week ${week}.`,
    week,
    actorRole: 'system',
  }).catch(() => {})

  if (opts?.force === true && opts.reason === 'stat_correction') {
    await logAuditEntry(zombieLeagueId, {
      category: 'weekly_update',
      action: 'STAT_CORRECTION_REPLAY',
      description: `Week ${week} resolution replayed after score/stat correction ingest.`,
      week,
      actorRole: 'system',
    }).catch(() => {})
  }

  const mode = getLeagueMode(z)

  // Before anything below names a team: a seat claimed or a team renamed since last week catches up here.
  await syncZombieTeamNames(z.leagueId).catch(() => 0)

  const infection = await resolveWeeklyInfections(zombieLeagueId, week)

  await finalizePendingSerumsForWeek(z.leagueId, week, z.season)
  await finalizePendingWeaponsForWeek(z.leagueId, week, z.season)
  await detectAndProcessBashings(z.leagueId, week, zombieLeagueId)
  await detectAndProcessMaulings(z.leagueId, week, zombieLeagueId)
  await checkAndAwardWeapons(z.leagueId, week, zombieLeagueId)
  await awardNativeSerumsForWeek(z.leagueId, week, z.season)
  await autoReviveEligibleZombies(z.leagueId, week)
  // Bank the week and move what infections, maulings and bashings take. Before this existed nothing
  // wrote the winnings the sum below reads. See lib/zombie/weeklyWinningsEngine.ts.
  await settleWeeklyWinnings({
    zombieLeagueId,
    leagueId: z.leagueId,
    season: z.season,
    sport: z.sport,
    week,
    infected: infection.infected ?? [],
  })

  const infectionMoney = await prisma.zombieInfectionEvent.aggregate({
    where: { zombieLeagueId, week },
    _sum: { winningsTransferred: true },
  })
  const winningsSum = infectionMoney._sum.winningsTransferred ?? 0
  if (winningsSum !== 0 || infection.infectionsCreated > 0) {
    await logAuditEntry(zombieLeagueId, {
      category: 'winnings_transfer',
      action: 'WEEKLY_INFECTION_TRANSFERS',
      description:
        mode === 'paid'
          ? `Week ${week}: infection-related winnings movement (USD engine).`
          : `Week ${week}: symbolic points movement from infections.`,
      amount: winningsSum,
      week,
      actorRole: 'system',
    }).catch(() => {})
  }

  const pendingAmbush = await prisma.zombieAmbushAction.count({
    where: { zombieLeagueId, week, status: 'pending' },
  })
  if (pendingAmbush > 0) {
    await logAuditEntry(zombieLeagueId, {
      category: 'ambush_use',
      action: 'AMBUSH_PENDING',
      description: `${pendingAmbush} ambush action(s) still pending for week ${week}.`,
      week,
      actorRole: 'system',
    }).catch(() => {})
  }

  const sitOutScoring = await applyZombieHordeSitOutToScoring(z.leagueId, week)
  if (sitOutScoring.sitOutExcludedUserIds.length > 0) {
    await logAuditEntry(zombieLeagueId, {
      category: 'horde_sit_out',
      action: 'WEEKLY_SIT_OUT_EXCLUSION_APPLIED',
      description: `Applied horde sit-out exclusion for ${sitOutScoring.sitOutExcludedUserIds.length} manager(s).`,
      week,
      actorRole: 'system',
      newState: {
        sitOutExcludedUserIds: sitOutScoring.sitOutExcludedUserIds,
        hordeScoreBeforeSitOut: sitOutScoring.hordeScoreBeforeSitOut,
        hordeScoreAfterSitOut: sitOutScoring.hordeScoreAfterSitOut,
      },
    }).catch(() => {})
  }

  const teams = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId: z.leagueId },
  })
  const survivorCount = teams.filter((t) => (t.status ?? '').toLowerCase().includes('survivor')).length
  const zombieCount = teams.filter((t) => (t.status ?? '').toLowerCase().includes('zombie')).length
  const hordeSize = zombieCount

  const whisperer = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId } })
  const coWhisperers = await prisma.zombieCoWhisperer.findMany({ where: { zombieLeagueId } })
  if (whisperer && hordeSize > (whisperer.hordeSizeAtPeak ?? 0)) {
    await prisma.whispererRecord.update({
      where: { id: whisperer.id },
      data: { hordeSizeAtPeak: hordeSize },
    })
  }

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: z.leagueId, season: z.season },
  })

  const matchupsJson: unknown[] = []
  if (season) {
    const [seasonRosters, ownerRosters] = await Promise.all([
      prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, ownerId: true } }),
      prisma.roster.findMany({ where: { leagueId: z.leagueId }, select: { id: true, platformUserId: true } }),
    ])
    const ownerBySeasonRoster = new Map(seasonRosters.map((roster) => [roster.id, roster.ownerId]))
    const nativeRosterByOwner = new Map(ownerRosters.map((roster) => [roster.platformUserId, roster.id]))
    const teamByNativeRoster = new Map(teams.map((team) => [team.rosterId, team]))
    const teamFor = (seasonRosterId: string) => teamByNativeRoster.get(nativeRosterByOwner.get(ownerBySeasonRoster.get(seasonRosterId) ?? '') ?? '')
    const mm = await prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, week },
    })
    for (const m of mm) {
      const homeWon = Boolean(m.awayRosterId) && m.homeScore > m.awayScore
      const awayWon = Boolean(m.awayRosterId) && m.awayScore > m.homeScore
      const winnerId = homeWon ? m.homeRosterId : awayWon ? m.awayRosterId : null
      const loserId = homeWon ? m.awayRosterId : awayWon ? m.homeRosterId : null
      const winner = winnerId ? teamFor(winnerId) : null
      const loser = loserId ? teamFor(loserId) : null
      matchupsJson.push({
        homeUserId: m.homeRosterId,
        awayUserId: m.awayRosterId,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        outcome: homeWon ? 'home' : awayWon ? 'away' : 'tie',
        winnerStatus: winner?.status ?? null,
        winnerName: winner?.fantasyTeamName || winner?.displayName || null,
        loserName: loser?.fantasyTeamName || loser?.displayName || null,
        winnerScore: homeWon ? m.homeScore : awayWon ? m.awayScore : null,
        loserScore: homeWon ? m.awayScore : awayWon ? m.homeScore : null,
      })
    }
  }

  const res = await prisma.zombieWeeklyResolution.update({
    where: { zombieLeagueId_week: { zombieLeagueId, week } },
    data: {
      status: 'complete',
      matchupResults: toPrismaJsonInput(matchupsJson),
      infectionCount: infection.infectionsCreated,
      hordeSize,
      survivorCount,
      resolvedAt: new Date(),
    },
  })

  /*
   * 🛑 THIS WROTE `currentWeek: week` — THE WEEK JUST RESOLVED — SO THE LEAGUE NEVER MOVED ON.
   * The scheduled resolver asks for `currentWeek`, found it already resolved, and returned every
   * tick after week 1. A resolved week points the league at the NEXT one; forward only, so a
   * forced replay of an older week (stat correction) cannot drag it back; and the season ends after
   * its last week.
   */
  const nextWeek = Math.max(z.currentWeek ?? 0, week + 1)
  // The season ends at its last SCHEDULED week, which is before `totalWeeks` whenever the league has
  // playoffs — see `getLastScheduledWeek`. This also releases a league activated with the old value.
  const lastScheduledWeek = season ? await getLastScheduledWeek(season.id) : null
  const lastWeek =
    z.totalWeeks != null && lastScheduledWeek != null
      ? Math.min(z.totalWeeks, lastScheduledWeek)
      : (z.totalWeeks ?? lastScheduledWeek)
  const finished = lastWeek != null && week >= lastWeek
  await prisma.zombieLeague.update({
    where: { id: zombieLeagueId },
    data: {
      currentWeek: lastWeek != null ? Math.min(nextWeek, lastWeek) : nextWeek,
      ...(finished ? { status: 'complete' } : {}),
    },
  })
  // The season's own pointer (live scoring and the league pages read it). The hourly roll leaves
  // zombie alone on purpose — its weeks move when the zombie week resolves, which is here.
  await prisma.redraftSeason
    .updateMany({
      where: { leagueId: z.leagueId, season: z.season, currentWeek: { lt: nextWeek } },
      data: { currentWeek: lastWeek != null ? Math.min(nextWeek, lastWeek) : nextWeek },
    })
    .catch(() => null)

  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId,
      universeId: z.universeId,
      type: 'weekly_recap',
      title: `Week ${week} resolved`,
      content: `Week ${week}: ${infection.infectionsCreated} new infection(s). Horde ~${hordeSize}, Survivors ~${survivorCount}.`,
      week,
    },
  })

  await logAuditEntry(zombieLeagueId, {
    category: 'weekly_update',
    action: 'WEEKLY_RECAP_POSTED',
    description: `Week ${week} recap announcement created.`,
    week,
    actorRole: 'system',
  }).catch(() => {})

  if (z.universeId) {
    await syncUniverseStats(z.universeId, week)
    await logAuditEntry(zombieLeagueId, {
      category: 'universe_projection',
      action: 'UNIVERSE_STATS_SYNCED',
      description: `Universe stats synced for week ${week}.`,
      week,
      universeId: z.universeId,
      actorRole: 'system',
    }).catch(() => {})
  }

  const bashCount = await prisma.zombieBashingEvent.count({
    where: { leagueId: z.leagueId, week },
  })
  const maulCount = await prisma.zombieMaulingEvent.count({
    where: { leagueId: z.leagueId, week },
  })

  await notifyCommissioner(z.leagueId, 'weekly_resolution_summary', `Week ${week} zombie resolution`, summaryText(
    infection.infectionsCreated,
    bashCount,
    maulCount,
    hordeSize,
    survivorCount,
    winningsSum,
    (whisperer?.ambushesRemaining ?? 0) + coWhisperers.reduce((sum, record) => sum + record.ambushesRemaining, 0),
    sitOutScoring,
  ), {
    week,
  })

  await tryPostWeeklyUpdateAfterResolution(z.leagueId, week, zombieLeagueId)

  return { resolution: res }
}

function summaryText(
  infections: number,
  bashings: number,
  maulings: number,
  horde: number,
  survivors: number,
  winnings: number,
  ambushesLeft: number,
  sitOutScoring: {
    sitOutExcludedUserIds: string[]
    hordeScoreBeforeSitOut: number
    hordeScoreAfterSitOut: number
  },
): string {
  return [
    `Infections: ${infections}`,
    `Bashings: ${bashings}`,
    `Maulings: ${maulings}`,
    `Horde: ${horde} | Survivors: ${survivors}`,
    `Horde sit-out exclusions: ${sitOutScoring.sitOutExcludedUserIds.length}`,
    `Horde score before/after sit-out: ${sitOutScoring.hordeScoreBeforeSitOut.toFixed(2)} / ${sitOutScoring.hordeScoreAfterSitOut.toFixed(2)}`,
    `Infection winnings delta (engine): ${winnings.toFixed(2)}`,
    `Ambushes remaining (Whisperer): ${ambushesLeft}`,
  ].join('\n')
}
