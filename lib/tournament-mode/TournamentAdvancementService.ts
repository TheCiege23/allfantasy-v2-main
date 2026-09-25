/**
 * [UPDATED] lib/tournament-mode/TournamentAdvancementService.ts
 * Multi-round condensation, bracket progression recording, and round advancement.
 * Fills Gaps 2+3: Elimination → Elite Eight → Championship pipeline.
 */

import * as prismaJson from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma'
import { runPostCreateInitialization } from '@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { compareByTiebreakers } from './advancement-rules'
import { LATER_ROUND_NAMES, TOURNAMENT_LEAGUE_VARIANT } from './constants'
import { markEliminated, markRoundCompleted, archiveRound } from './TournamentEliminationEngine'
import { scheduleRedraftForRound, applyFaabResetForRound, applyBenchSpotsForRound } from './TournamentRedraftService'
import { logTournamentAudit } from './TournamentAuditService'
import { getRoundWindow } from './tournament-sport-cutoffs'
import type { TournamentSettings } from './types'

export interface CondenseRoundResult {
  leagueIds: string[]
  advanced: number
  eliminated: number
  newRoundIndex: number
  phase: string
}

/**
 * Determine the next phase from the current round's advancing count.
 * - 16 or fewer total → elite_eight phase
 * - 8 or fewer total → championship phase (single league)
 * - Otherwise → still elimination
 */
function resolveNextPhase(totalAdvancing: number): 'elimination' | 'elite_eight' | 'championship' {
  if (totalAdvancing <= 8) return 'championship'
  if (totalAdvancing <= 16) return 'elite_eight'
  return 'elimination'
}

function resolveNextLeagueSize(totalAdvancing: number, leagueCount: number): number {
  if (leagueCount <= 0) return totalAdvancing
  const base = Math.floor(totalAdvancing / leagueCount)
  return Math.max(base, 4)
}

/**
 * Condense a completed round into fewer leagues for the next round.
 * Collects standings from all leagues in `fromRoundIndex`, advances top N per league,
 * creates new leagues, assigns rosters, marks eliminated, schedules redrafts.
 */
export async function condenseRound(
  tournamentId: string,
  fromRoundIndex: number,
  advancementPerLeague: number
): Promise<CondenseRoundResult> {
  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    include: { conferences: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!tournament) throw new Error('Tournament not found')

  const newRoundIndex = fromRoundIndex + 1

  // Idempotency + race condition guard: prevent double-creation
  const existingRound = await prisma.legacyTournamentRound.findUnique({
    where: { tournamentId_roundIndex: { tournamentId, roundIndex: newRoundIndex } },
  })
  if (existingRound) throw new Error(`Round ${newRoundIndex} already exists — condensation already ran.`)

  // Atomic lock: set an in-flight flag in tournament settings to prevent concurrent advancement
  const currentSettings = (tournament.settings as Record<string, unknown>) ?? {}
  if (currentSettings._advancementInFlight) {
    throw new Error('Advancement is already in progress. Wait for it to complete before retrying.')
  }
  await prisma.legacyTournament.update({
    where: { id: tournamentId },
    data: { settings: { ...currentSettings, _advancementInFlight: true } },
  })

  // Ensure we clear the lock on any exit path
  const clearLock = async () => {
    try {
      const latest = await prisma.legacyTournament.findUnique({ where: { id: tournamentId }, select: { settings: true } })
      const s = (latest?.settings as Record<string, unknown>) ?? {}
      delete s._advancementInFlight
      await prisma.legacyTournament.update({ where: { id: tournamentId }, data: { settings: prismaJson.toPrismaJsonInput(s) } })
    } catch { /* non-fatal */ }
  }

  try {
  const settings = ((tournament.settings as Record<string, unknown>) ?? {}) as Partial<TournamentSettings>
  const sport = normalizeToSupportedSport(tournament.sport)
  const faabBudget = settings.faabBudgetDefault ?? 100
  const benchSpots = settings.benchSpotsElimination ?? 2
  const tiebreakerOrder = settings.qualificationTiebreakers ?? ['wins', 'points_for']

  // Get all leagues in the source round
  const sourceLeagues = await prisma.legacyTournamentLeague.findMany({
    where: { tournamentId, roundIndex: fromRoundIndex },
    include: {
      league: { select: { id: true, name: true } },
      conference: { select: { id: true, name: true } },
    },
    orderBy: [{ conferenceId: 'asc' }, { orderInConference: 'asc' }],
  })

  // Collect advancing and eliminated rosters per conference
  const advancingByConf = new Map<string, Array<{ userId: string; rosterId: string; confId: string; confName: string }>>()
  const eliminatedRosterIds: string[] = []

  for (const tl of sourceLeagues) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId: tl.leagueId },
      select: { id: true, platformUserId: true },
    })
    const matchups = await prisma.matchupFact.findMany({
      where: { leagueId: tl.leagueId },
      select: { teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
    })

    // Build stats
    const stats = rosters.map((r) => {
      let wins = 0, pf = 0, pa = 0, games = 0
      for (const m of matchups) {
        if (m.teamA !== r.id && m.teamB !== r.id) continue
        games++
        const isA = m.teamA === r.id
        pf += Number(isA ? m.scoreA : m.scoreB) || 0
        pa += Number(isA ? m.scoreB : m.scoreA) || 0
        if (m.winnerTeamId === r.id) wins++
      }
      return {
        rosterId: r.id,
        userId: r.platformUserId ?? '',
        wins,
        losses: Math.max(0, games - wins),
        pointsFor: pf,
        pointsAgainst: pa,
      }
    })

    const matchupData = matchups.map((m) => ({
      teamA: m.teamA,
      teamB: m.teamB,
      winnerTeamId: m.winnerTeamId,
    }))
    stats.sort((a, b) => compareByTiebreakers(a, b, tiebreakerOrder as string[], matchupData))

    const advancing = stats.slice(0, advancementPerLeague)
    const eliminated = stats.slice(advancementPerLeague)

    const confList = advancingByConf.get(tl.conference.id) ?? []
    for (const s of advancing) {
      if (s.userId) confList.push({ userId: s.userId, rosterId: s.rosterId, confId: tl.conference.id, confName: tl.conference.name })
    }
    advancingByConf.set(tl.conference.id, confList)

    for (const s of eliminated) {
      eliminatedRosterIds.push(s.rosterId)
    }
  }

  // Mark eliminated
  if (eliminatedRosterIds.length > 0) {
    await markEliminated(tournamentId, fromRoundIndex, eliminatedRosterIds)
  }

  // Determine phase
  let totalAdvancing = 0
  for (const [, list] of advancingByConf) totalAdvancing += list.length
  const phase = resolveNextPhase(totalAdvancing)

  // Championship: single league, all conferences merge
  const isChampionship = phase === 'championship'
  const leagueIds: string[] = []

  if (isChampionship) {
    // Merge all advancing into one final league
    const allAdvancing: Array<{ userId: string; rosterId: string; confId: string; confName: string }> = []
    for (const [, list] of advancingByConf) allAdvancing.push(...list)

    const league = await prisma.league.create({
      data: {
        userId: tournament.creatorId,
        name: `${tournament.name} – Championship`,
        platform: 'manual',
        platformLeagueId: `tournament-${tournamentId}-r${newRoundIndex}-championship-${Date.now()}`,
        leagueSize: allAdvancing.length,
        scoring: 'PPR',
        isDynasty: false,
        sport,
        leagueVariant: TOURNAMENT_LEAGUE_VARIANT,
        settings: {
          league_type: 'tournament',
          tournamentId,
          tournamentName: tournament.name,
          roundIndex: newRoundIndex,
          phase: 'championship',
          bracketLabel: 'Championship',
        },
        syncStatus: 'manual',
      },
    })
    leagueIds.push(league.id)

    try {
      await runPostCreateInitialization(league.id, sport, TOURNAMENT_LEAGUE_VARIANT)
    } catch (e) {
      console.warn('[tournament] Championship bootstrap non-fatal', e)
    }

    // Use first conference as parent (arbitrary for final)
    const firstConfId = tournament.conferences[0]?.id
    if (!firstConfId) throw new Error('Tournament has no conferences — cannot create championship league join record')
    await prisma.legacyTournamentLeague.create({
      data: {
        tournamentId,
        conferenceId: firstConfId,
        leagueId: league.id,
        roundIndex: newRoundIndex,
        phase: 'championship',
        orderInConference: 0,
      },
    })

    for (const p of allAdvancing) {
      if (!p.userId) continue
      const roster = await prisma.roster.create({
        data: { leagueId: league.id, platformUserId: p.userId, playerData: {} },
      })
      await prisma.legacyTournamentParticipant.updateMany({
        where: { tournamentId, userId: p.userId },
        data: {
          currentLeagueId: league.id,
          currentRosterId: roster.id,
          advancedAtRoundIndex: fromRoundIndex,
          bracketLabel: 'Championship',
          status: 'active',
        },
      })
    }
  } else {
    // Create new leagues per conference
    for (const conf of tournament.conferences) {
      const confAdvancing = advancingByConf.get(conf.id) ?? []
      if (confAdvancing.length === 0) continue

      // How many leagues for this conference?
      const leagueSize = phase === 'elite_eight' ? confAdvancing.length : 16
      const leagueCount = Math.max(1, Math.ceil(confAdvancing.length / leagueSize))

      for (let L = 0; L < leagueCount; L++) {
        const label = LATER_ROUND_NAMES[L] ?? `Division ${L + 1}`
        const phaseName = phase === 'elite_eight' ? 'Elite Eight' : `Elimination R${newRoundIndex}`
        const league = await prisma.league.create({
          data: {
            userId: tournament.creatorId,
            name: `${tournament.name} – ${conf.name} ${label} (${phaseName})`,
            platform: 'manual',
            platformLeagueId: `tournament-${tournamentId}-r${newRoundIndex}-${conf.id}-${L}-${Date.now()}`,
            leagueSize: Math.min(leagueSize, confAdvancing.length - L * leagueSize),
            scoring: 'PPR',
            isDynasty: false,
            sport,
            leagueVariant: TOURNAMENT_LEAGUE_VARIANT,
            settings: {
              league_type: 'tournament',
              tournamentId,
              tournamentName: tournament.name,
              conferenceName: conf.name,
              roundIndex: newRoundIndex,
              phase,
              bracketLabel: label,
            },
            syncStatus: 'manual',
          },
        })
        leagueIds.push(league.id)

        try {
          await runPostCreateInitialization(league.id, sport, TOURNAMENT_LEAGUE_VARIANT)
        } catch (e) {
          console.warn('[tournament] Condense bootstrap non-fatal', e)
        }

        await prisma.legacyTournamentLeague.create({
          data: {
            tournamentId,
            conferenceId: conf.id,
            leagueId: league.id,
            roundIndex: newRoundIndex,
            phase,
            orderInConference: L,
          },
        })

        const startIdx = L * leagueSize
        const slice = confAdvancing.slice(startIdx, startIdx + leagueSize)
        for (const p of slice) {
          if (!p.userId) continue
          const roster = await prisma.roster.create({
            data: { leagueId: league.id, platformUserId: p.userId, playerData: {} },
          })
          await prisma.legacyTournamentParticipant.updateMany({
            where: { tournamentId, userId: p.userId },
            data: {
              currentLeagueId: league.id,
              currentRosterId: roster.id,
              advancedAtRoundIndex: fromRoundIndex,
              bracketLabel: label,
              status: 'active',
            },
          })
        }
      }
    }
  }

  // Mark source round completed and archived
  await markRoundCompleted(tournamentId, fromRoundIndex)
  await archiveRound(tournamentId, fromRoundIndex)

  // Create new round record. Window comes from sport-aware helpers — NFL stays
  // on its 10/13/16-style cadence, but NBA/NHL/MLB/SOCCER get their own season
  // boundaries instead of being shoehorned into NFL's 17-week schedule.
  const window = getRoundWindow(sport, newRoundIndex, isChampionship)
  await prisma.legacyTournamentRound.create({
    data: {
      tournamentId,
      roundIndex: newRoundIndex,
      phase,
      name: isChampionship ? 'Championship' : phase === 'elite_eight' ? 'Elite Eight' : `Elimination Round ${newRoundIndex}`,
      startWeek: window.startWeek,
      endWeek: window.endWeek,
      status: 'active',
      settings: {
        advancementCount: advancementPerLeague,
        benchSpots,
        faabBudget,
      },
    },
  })

  // Update tournament status
  const statusMap: Record<string, string> = {
    elimination: 'elimination',
    elite_eight: 'elimination',
    championship: 'finals',
  }
  await prisma.legacyTournament.update({
    where: { id: tournamentId },
    data: { status: statusMap[phase] ?? 'elimination' },
  })

  // Schedule redrafts, FAAB reset, bench spots for new round
  if (settings.faabResetByRound) {
    await applyFaabResetForRound(tournamentId, newRoundIndex, faabBudget)
  }
  await applyBenchSpotsForRound(tournamentId, newRoundIndex, benchSpots)
  const redraftResult = await scheduleRedraftForRound(tournamentId, newRoundIndex)

  // Auto-post advancement + redraft announcements to tournament forum
  const phaseName = isChampionship ? 'Championship' : phase === 'elite_eight' ? 'Elite Eight' : `Elimination Round ${newRoundIndex}`
  await prisma.legacyTournamentAnnouncement.create({
    data: {
      tournamentId,
      type: 'round_advancement',
      title: `${phaseName} — ${totalAdvancing} advance, ${eliminatedRosterIds.length} eliminated`,
      body: [
        `Round ${fromRoundIndex} is complete. ${totalAdvancing} players advance to ${phaseName}.`,
        `${eliminatedRosterIds.length} player(s) have been eliminated.`,
        leagueIds.length > 0 ? `${leagueIds.length} new league(s) created.` : '',
        settings.faabResetByRound ? `FAAB budgets reset to $${faabBudget}.` : '',
        `Bench spots: ${benchSpots}. No IR.`,
        redraftResult.scheduled > 0 ? `${redraftResult.scheduled} redraft(s) scheduled — check your league for draft room details.` : '',
      ].filter(Boolean).join(' '),
      pinned: false,
    },
  })

  // Record bracket progression
  await recordBracketProgression(tournamentId, fromRoundIndex, {
    phase,
    advancedCount: totalAdvancing,
    eliminatedCount: eliminatedRosterIds.length,
    newLeagueIds: leagueIds,
  })

  // Audit
  await logTournamentAudit(tournamentId, 'advancement_run', {
    metadata: {
      fromRoundIndex,
      newRoundIndex,
      phase,
      advanced: totalAdvancing,
      eliminated: eliminatedRosterIds.length,
      leagueIds,
    },
  })

  const result = {
    leagueIds,
    advanced: totalAdvancing,
    eliminated: eliminatedRosterIds.length,
    newRoundIndex,
    phase,
  }

  await clearLock()
  return result
  } catch (e) {
    await clearLock()
    throw e
  }
}

/**
 * Record bracket progression nodes for visualization after each advancement round.
 * Stores a snapshot of who advanced from which leagues into which new leagues.
 */
export async function recordBracketProgression(
  tournamentId: string,
  roundIndex: number,
  payload: Record<string, unknown>
): Promise<void> {
  // Store as an announcement with type 'bracket_progression' for the forum feed
  // and as audit metadata for the bracket visualization to reconstruct the tree
  await prisma.legacyTournamentAnnouncement.create({
    data: {
      tournamentId,
      type: 'bracket_progression',
      title: `Round ${roundIndex} → Round ${roundIndex + 1}`,
      body: JSON.stringify(payload),
      pinned: false,
    },
  })
}
