import type { ZombieWeeklyResolution } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { resolveWeeklyInfections } from '@/lib/zombie/infectionEngine'
import { finalizePendingSerumsForWeek } from '@/lib/zombie/serumEngine'
import { detectAndProcessBashings } from '@/lib/zombie/bashingEngine'
import { detectAndProcessMaulings } from '@/lib/zombie/maulingEngine'
import { checkAndAwardWeapons } from '@/lib/zombie/weaponEngine'
import { tryPostWeeklyUpdateAfterResolution } from '@/lib/zombie/weeklyUpdateEngine'
import { syncUniverseStats } from '@/lib/zombie/universeStatEngine'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { checkAllMatchupsComplete } from '@/lib/zombie/matchupCompletion'
import { logAuditEntry } from '@/lib/zombie/auditService'
import { getLeagueMode } from '@/lib/zombie/zombieLeagueMode'
import { applyZombieHordeSitOutToScoring } from '@/lib/zombie/ZombieHordeSitOutEngine'

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

  if (!opts?.force) {
    const existing = await prisma.zombieWeeklyResolution.findUnique({
      where: { zombieLeagueId_week: { zombieLeagueId, week } },
    })
    if (existing?.status === 'complete' && existing.resolvedAt) {
      return { resolution: existing }
    }
  }

  if (!opts?.force) {
    const allComplete = await checkAllMatchupsComplete(z.leagueId, week, z.season)
    if (!allComplete) {
      return { resolution: null, skipped: true, reason: 'matchups_incomplete' }
    }
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

  const infection = await resolveWeeklyInfections(zombieLeagueId, week)

  await finalizePendingSerumsForWeek(z.leagueId, week, z.season)
  await detectAndProcessBashings(z.leagueId, week, zombieLeagueId)
  await detectAndProcessMaulings(z.leagueId, week, zombieLeagueId)
  await checkAndAwardWeapons(z.leagueId, week, zombieLeagueId)

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
    const mm = await prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, week },
    })
    for (const m of mm) {
      matchupsJson.push({
        homeUserId: m.homeRosterId,
        awayUserId: m.awayRosterId,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        outcome: (m.homeScore ?? 0) >= (m.awayScore ?? 0) ? 'home' : 'away',
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

  await prisma.zombieLeague.update({
    where: { id: zombieLeagueId },
    data: { currentWeek: week },
  })

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
    whisperer?.ambushesRemaining ?? 0,
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
