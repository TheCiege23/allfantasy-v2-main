/**
 * PROMPT 3: Qualification advancement, round condensing, participant sync.
 * Deterministic: tiebreakers (W-L, PF), advancement slots per pool size, optional bubble.
 */

import { prisma } from '@/lib/prisma'
import { runPostCreateInitialization } from '@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator'
import { getUniversalStandingsRaw, applyConferenceRankingAndCutLine } from './TournamentStandingsService'
import { getBubbleSlotsPerConference, getEliminationLeagueCountPerConference, ELIMINATION_LEAGUE_SIZE } from './advancement-rules'
import { getQualificationCutSlotsPerConference, getRoundWindow } from './tournament-sport-cutoffs'
import { LATER_ROUND_NAMES, TOURNAMENT_LEAGUE_VARIANT } from './constants'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

interface QualificationAdvancementResult {
  advanced: number
  eliminated: number
  bubbleAdvanced: number
  newLeagueIds: string[]
  newTournamentLeagueIds: string[]
}

/**
 * Sync TournamentParticipant for every user in feeder leagues (round 0).
 * Call before running advancement so we have participant rows to update.
 */
async function syncQualificationParticipants(tournamentId: string): Promise<number> {
  const feederLeagues = await prisma.legacyTournamentLeague.findMany({
    where: { tournamentId, roundIndex: 0 },
    include: {
      league: { select: { id: true } },
      conference: { select: { id: true } },
    },
  })

  let created = 0
  for (const tl of feederLeagues) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId: tl.leagueId },
      select: { id: true, platformUserId: true },
    })
    const matchups = await prisma.matchupFact.findMany({
      where: { leagueId: tl.leagueId },
      select: { teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
    })
    const wins = new Map<string, number>()
    const pf = new Map<string, number>()
    const pa = new Map<string, number>()
    const games = new Map<string, number>()
    for (const r of rosters) {
      wins.set(r.id, 0)
      pf.set(r.id, 0)
      pa.set(r.id, 0)
      games.set(r.id, 0)
    }
    for (const m of matchups) {
      const a = m.teamA
      const b = m.teamB
      const scoreA = Number(m.scoreA) || 0
      const scoreB = Number(m.scoreB) || 0
      const w = m.winnerTeamId
      games.set(a, (games.get(a) ?? 0) + 1)
      games.set(b, (games.get(b) ?? 0) + 1)
      pf.set(a, (pf.get(a) ?? 0) + scoreA)
      pa.set(a, (pa.get(a) ?? 0) + scoreB)
      pf.set(b, (pf.get(b) ?? 0) + scoreB)
      pa.set(b, (pa.get(b) ?? 0) + scoreA)
      if (w === a) wins.set(a, (wins.get(a) ?? 0) + 1)
      else if (w === b) wins.set(b, (wins.get(b) ?? 0) + 1)
    }

    for (const r of rosters) {
      const userId = r.platformUserId
      if (!userId) continue
      const existing = await prisma.legacyTournamentParticipant.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      })
      if (existing) continue
      const rWins = wins.get(r.id) ?? 0
      const rGames = games.get(r.id) ?? 0
      const rLosses = Math.max(0, rGames - rWins)
      await prisma.legacyTournamentParticipant.create({
        data: {
          tournamentId,
          userId,
          conferenceId: tl.conference.id,
          qualificationLeagueId: tl.leagueId,
          qualificationRosterId: r.id,
          qualificationWins: rWins,
          qualificationLosses: rLosses,
          qualificationPointsFor: pf.get(r.id) ?? 0,
          qualificationPointsAgainst: pa.get(r.id) ?? 0,
          status: 'active',
        },
      })
      created++
    }
  }
  return created
}

/**
 * Run qualification advancement: compute cut line per conference, create elimination leagues,
 * assign advancing users to new leagues (create Roster), update TournamentParticipant, mark eliminated.
 */
export async function runQualificationAdvancement(tournamentId: string): Promise<QualificationAdvancementResult> {
  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    include: { conferences: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!tournament) throw new Error('Tournament not found')

  const existingRound1 = await prisma.legacyTournamentRound.findUnique({
    where: { tournamentId_roundIndex: { tournamentId, roundIndex: 1 } },
  })
  if (existingRound1) throw new Error('Elimination round already created; advancement already run.')
  const settings = (tournament.settings as Record<string, unknown>) ?? {}
  const poolSize = Number(settings.participantPoolSize) || 72
  const bubbleEnabled = Boolean(settings.bubbleWeekEnabled)
  const sport = normalizeToSupportedSport(tournament.sport)
  const advancementPerConf = getQualificationCutSlotsPerConference(
    String(tournament.sport ?? 'NFL'),
    poolSize,
    typeof settings.qualificationAdvancementTotal === 'number' ? settings.qualificationAdvancementTotal : undefined,
    tournament.conferences.length
  )
  const bubbleSlots = getBubbleSlotsPerConference(advancementPerConf, bubbleEnabled)
  const leaguesPerConf = getEliminationLeagueCountPerConference(advancementPerConf)

  await syncQualificationParticipants(tournamentId)
  const rawRows = await getUniversalStandingsRaw(tournamentId)
  const rows = await applyConferenceRankingAndCutLine(tournamentId, rawRows)

  const advancingByConference = new Map<string, typeof rows>()
  for (const r of rows) {
    if (r.advancementStatus !== 'advanced' && r.advancementStatus !== 'bubble') continue
    const list = advancingByConference.get(r.conferenceId) ?? []
    list.push(r)
    advancingByConference.set(r.conferenceId, list)
  }
  for (const [, list] of advancingByConference) {
    list.sort((a, b) => (a.rankInConference ?? 999) - (b.rankInConference ?? 999))
  }

  const newLeagueIds: string[] = []
  const newTournamentLeagueIds: string[] = []
  let advancedCount = 0
  let bubbleAdvancedCount = 0

  for (let cIdx = 0; cIdx < tournament.conferences.length; cIdx++) {
    const conf = tournament.conferences[cIdx]!
    const fullList = advancingByConference.get(conf.id) ?? []
    const directCount = Math.min(advancementPerConf, fullList.length)
    const bubbleCount = bubbleEnabled ? Math.min(bubbleSlots, Math.max(0, fullList.length - directCount)) : 0
    const totalAdvancing = directCount + bubbleCount
    const advancing = fullList.slice(0, totalAdvancing)

    for (let L = 0; L < leaguesPerConf; L++) {
      const leagueName = LATER_ROUND_NAMES[L] ?? `Division ${L + 1}`
      const league = await prisma.league.create({
        data: {
          userId: tournament.creatorId,
          name: `${tournament.name} – ${conf.name} ${leagueName}`,
          platform: 'manual',
          platformLeagueId: `tournament-${tournamentId}-r1-${conf.id}-${L}-${Date.now()}`,
          leagueSize: ELIMINATION_LEAGUE_SIZE,
          scoring: 'PPR',
          isDynasty: false,
          sport,
          leagueVariant: TOURNAMENT_LEAGUE_VARIANT,
          settings: {
            league_type: 'tournament',
            tournamentId,
            tournamentName: tournament.name,
            conferenceName: conf.name,
            roundIndex: 1,
            phase: 'elimination',
            bracketLabel: leagueName,
          },
          syncStatus: 'manual',
        },
      })
      newLeagueIds.push(league.id)
      try {
        await runPostCreateInitialization(league.id, sport, TOURNAMENT_LEAGUE_VARIANT)
      } catch (e) {
        console.warn('[tournament] Bootstrap non-fatal', e)
      }

      const tl = await prisma.legacyTournamentLeague.create({
        data: {
          tournamentId,
          conferenceId: conf.id,
          leagueId: league.id,
          roundIndex: 1,
          phase: 'elimination',
          orderInConference: L,
        },
      })
      newTournamentLeagueIds.push(tl.id)

      const startIdx = L * ELIMINATION_LEAGUE_SIZE
      const slice = advancing.slice(startIdx, startIdx + ELIMINATION_LEAGUE_SIZE)
      for (const row of slice) {
        if (!row.userId) continue
        const roster = await prisma.roster.create({
          data: {
            leagueId: league.id,
            platformUserId: row.userId,
            playerData: {},
          },
        })
        const isBubble = row.advancementStatus === 'bubble'
        if (isBubble) bubbleAdvancedCount++
        else advancedCount++
        await prisma.legacyTournamentParticipant.update({
          where: { tournamentId_userId: { tournamentId, userId: row.userId } },
          data: {
            currentLeagueId: league.id,
            currentRosterId: roster.id,
            advancedAtRoundIndex: 0,
            bubbleAdvanced: isBubble,
            bracketLabel: leagueName,
            status: 'active',
          },
        })
      }
    }

    const eliminated = rows.filter(
      (r) => r.conferenceId === conf.id && r.advancementStatus === 'out'
    )
    for (const row of eliminated) {
      if (!row.userId) continue
      await prisma.legacyTournamentParticipant.updateMany({
        where: { tournamentId, userId: row.userId },
        data: { status: 'eliminated', eliminatedAtRoundIndex: 0 },
      })
    }
  }

  await prisma.legacyTournamentRound.updateMany({
    where: { tournamentId, roundIndex: 0 },
    data: { status: 'completed' },
  })

  // Sport-aware first elimination window. NFL stays at 10–13, but NBA/NHL/MLB/SOCCER
  // get round boundaries that fit their actual season length.
  const round1Window = getRoundWindow(sport, 1, false)
  await prisma.legacyTournamentRound.create({
    data: {
      tournamentId,
      roundIndex: 1,
      phase: 'elimination',
      name: 'Elimination Round 1',
      startWeek: round1Window.startWeek,
      endWeek: round1Window.endWeek,
      status: 'active',
      settings: {
        advancementCount: 4,
        benchSpots: 2,
        faabBudget: (settings.faabBudgetDefault as number) ?? 100,
      },
    },
  })

  await prisma.legacyTournament.update({
    where: { id: tournamentId },
    data: { status: 'elimination' },
  })

  const eliminatedCount = await prisma.legacyTournamentParticipant.count({
    where: { tournamentId, status: 'eliminated' },
  })

  return {
    advanced: advancedCount + bubbleAdvancedCount,
    eliminated: eliminatedCount,
    bubbleAdvanced: bubbleAdvancedCount,
    newLeagueIds,
    newTournamentLeagueIds,
  }
}
