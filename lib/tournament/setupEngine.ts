import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { RetiredConceptError, checkRetiredConcept } from '@/lib/league-creation/retiredConcepts'
import { runPostCreateInitialization } from '@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator'
import { TOURNAMENT_LEAGUE_VARIANT } from '@/lib/tournament-mode/constants'
import { getRoundTemplate } from '@/lib/tournament/roundTemplates'
import {
  generateConferenceName,
  generateLeagueNamesForConference,
  recordName,
  slugify,
} from '@/lib/tournament/namingEngine'

const POOL_SIZES = new Set([60, 120, 180, 240])

const CONF_PALETTE = ['#38BDF8', '#F59E0B', '#A78BFA', '#34D399', '#F472B6', '#FB7185']

export type TournamentConfig = {
  name: string
  sport: string
  maxParticipants: number
  conferenceCount: number
  leaguesPerConference: number
  teamsPerLeague: number
  namingMode: string
  draftType?: string
  waiverType?: string
  advancersPerLeague?: number
  wildcardCount?: number
  bubbleEnabled?: boolean
  bubbleSize?: number
  bubbleScoringMode?: string
  openingWeekStart: number
  bubbleWeek?: number | null
  redraftWeek?: number | null
  eliteRedraftWeek?: number | null
  championshipWeek?: number | null
  scoringSystem?: string
  openingRosterSize?: number
  tournamentRosterSize?: number
  eliteRosterSize?: number
  irEnabled?: boolean
  tradeEnabled?: boolean
  faabResetOnRedraft?: boolean
  draftClockSeconds?: number
  asyncDraft?: boolean
  simultaneousDrafts?: boolean
  tiebreakerMode?: string
  standingsVisibility?: string
  totalRounds?: number
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
}

export type TournamentLeagueManagerInput = {
  id: string
  userId: string
  displayName: string
  avatarUrl: string | null
}

/** Creates the underlying redraft `League`, teams, shell participants wiring, and `TournamentLeagueParticipant` rows. */
export async function provisionTournamentLeagueWithManagers(
  shell: {
    id: string
    commissionerId: string
    sport: string
    scoringSystem: string | null
    waiverType: string | null
    faabResetOnRedraft: boolean
  },
  tl: { id: string; name: string; conferenceId: string | null },
  roundNumber: number,
  teamSlots: number,
  rosterSize: number,
  managers: TournamentLeagueManagerInput[],
  opts?: { fillOriginalConference?: boolean },
): Promise<string> {
  const sport = normalizeToSupportedSport(shell.sport) as LeagueSport
  const league = await prisma.league.create({
    data: {
      userId: shell.commissionerId,
      platform: 'manual',
      platformLeagueId: `tournament-shell-${tl.id}-${Date.now()}`,
      name: tl.name,
      sport,
      season: new Date().getFullYear(),
      leagueSize: teamSlots,
      leagueVariant: TOURNAMENT_LEAGUE_VARIANT,
      leagueType: 'tournament',
      survivorMode: false,
      scoring: shell.scoringSystem?.toUpperCase() ?? 'PPR',
      rosterSize,
      waiverType: shell.waiverType ?? 'faab',
      status: 'pre_draft',
      settings: {
        league_type: 'tournament',
        tournamentShellId: shell.id,
        tournamentLeagueId: tl.id,
        roundNumber,
      },
      syncStatus: 'manual',
    },
  })

  await prisma.tournamentLeague.update({
    where: { id: tl.id },
    data: { leagueId: league.id, status: 'draft_scheduled', currentTeamCount: managers.length },
  })

  const faab = shell.faabResetOnRedraft ? 100 : 100
  let slot = 1
  for (const p of managers) {
    const externalId = `ts-${p.userId}-${tl.id}`
    await prisma.leagueTeam.create({
      data: {
        leagueId: league.id,
        externalId,
        ownerName: p.displayName,
        teamName: p.displayName,
        avatarUrl: p.avatarUrl ?? undefined,
        claimedByUserId: p.userId,
        isCommissioner: false,
      },
    })

    await prisma.tournamentLeagueParticipant.create({
      data: {
        tournamentLeagueId: tl.id,
        participantId: p.id,
        userId: p.userId,
        draftSlot: slot,
        faabBalance: faab,
        advancementStatus: 'competing',
      },
    })

    await prisma.tournamentParticipant.update({
      where: { id: p.id },
      data: {
        currentLeagueId: tl.id,
        currentConferenceId: tl.conferenceId,
      },
    })
    slot++
  }

  if (opts?.fillOriginalConference && tl.conferenceId) {
    await prisma.tournamentParticipant.updateMany({
      where: {
        id: { in: managers.map((m) => m.id) },
        tournamentId: shell.id,
        originalConferenceId: null,
      },
      data: { originalConferenceId: tl.conferenceId },
    })
  }

  try {
    await runPostCreateInitialization(league.id, sport, TOURNAMENT_LEAGUE_VARIANT)
  } catch (e) {
    console.warn('[tournament/setupEngine] league bootstrap non-fatal', league.id, e)
  }

  return league.id
}

function validateStructure(config: TournamentConfig): void {
  if (!POOL_SIZES.has(config.maxParticipants)) {
    throw new Error('maxParticipants must be 60, 120, 180, or 240')
  }
  const product = config.conferenceCount * config.leaguesPerConference * config.teamsPerLeague
  if (product !== config.maxParticipants) {
    throw new Error(
      `conferenceCount × leaguesPerConference × teamsPerLeague must equal maxParticipants (${product} ≠ ${config.maxParticipants})`,
    )
  }
}

export async function createTournamentShell(
  commissionerId: string,
  config: TournamentConfig,
): Promise<{ id: string }> {
  // Tournament Mode is retired from active creation (2026-07-23). Guarded at the
  // service so every caller is closed at once. Existing shells are untouched —
  // this function only creates.
  const retired = checkRetiredConcept('tournament')
  if (retired) {
    throw new RetiredConceptError(retired.code, retired.message)
  }

  validateStructure(config)
  const sport = normalizeToSupportedSport(config.sport) as LeagueSport
  const templates = getRoundTemplate(config.maxParticipants, sport, config.openingWeekStart)
  const totalRounds = config.totalRounds ?? templates.length

  const shell = await prisma.$transaction(async (tx) => {
    const s = await tx.tournamentShell.create({
      data: {
        name: config.name.trim(),
        sport,
        maxParticipants: config.maxParticipants,
        conferenceCount: config.conferenceCount,
        leaguesPerConference: config.leaguesPerConference,
        teamsPerLeague: config.teamsPerLeague,
        namingMode: config.namingMode,
        openingWeekStart: config.openingWeekStart,
        bubbleWeek: config.bubbleWeek ?? undefined,
        redraftWeek: config.redraftWeek ?? undefined,
        eliteRedraftWeek: config.eliteRedraftWeek ?? undefined,
        championshipWeek: config.championshipWeek ?? undefined,
        scoringSystem: config.scoringSystem ?? 'ppr',
        draftType: config.draftType ?? 'snake',
        waiverType: config.waiverType ?? 'faab',
        advancersPerLeague: config.advancersPerLeague ?? 1,
        wildcardCount: config.wildcardCount ?? 0,
        bubbleEnabled: config.bubbleEnabled ?? true,
        bubbleSize: config.bubbleSize ?? 8,
        bubbleScoringMode: config.bubbleScoringMode ?? 'cumulative_points',
        openingRosterSize: config.openingRosterSize ?? 15,
        tournamentRosterSize: config.tournamentRosterSize ?? 10,
        eliteRosterSize: config.eliteRosterSize ?? 8,
        irEnabled: config.irEnabled ?? false,
        tradeEnabled: config.tradeEnabled ?? false,
        faabResetOnRedraft: config.faabResetOnRedraft ?? true,
        draftClockSeconds: config.draftClockSeconds ?? 90,
        asyncDraft: config.asyncDraft ?? false,
        simultaneousDrafts: config.simultaneousDrafts ?? true,
        tiebreakerMode: config.tiebreakerMode ?? 'points_for',
        standingsVisibility: config.standingsVisibility ?? 'conference',
        totalRounds,
        commissionerId,
        createdBy: commissionerId,
      },
    })

    for (const t of templates) {
      await tx.tournamentRound.create({
        data: {
          tournamentId: s.id,
          roundNumber: t.roundNumber,
          roundType: t.roundType,
          roundLabel: t.roundLabel,
          weekStart: t.weekStart,
          weekEnd: t.weekEnd,
          status: 'pending',
        },
      })
    }

    await tx.tournamentAuditLog.create({
      data: {
        tournamentId: s.id,
        action: 'shell_created',
        actorType: 'commissioner',
        actorId: commissionerId,
        targetType: 'tournament',
        targetId: s.id,
        data: { name: config.name, maxParticipants: config.maxParticipants },
      },
    })

    return s
  })

  return { id: shell.id }
}

export async function buildConferencesAndLeagues(tournamentId: string, namingMode: string): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  })
  if (!shell) throw new Error('Tournament shell not found')
  const round1 = shell.rounds.find((r) => r.roundNumber === 1)
  if (!round1) throw new Error('Round 1 not found')

  const existingNames: string[] = []
  const season = new Date().getFullYear()

  for (let c = 0; c < shell.conferenceCount; c++) {
    const confName = generateConferenceName(shell.id, c + 1, existingNames)
    existingNames.push(confName)
    const confSlug = slugify(`${confName}-${c}`)
    const colorHex = CONF_PALETTE[c % CONF_PALETTE.length]!

    const conference = await prisma.tournamentConference.create({
      data: {
        tournamentId: shell.id,
        name: confName,
        slug: confSlug,
        conferenceNumber: c + 1,
        colorHex,
      },
    })

    await recordName(shell.id, 'conference', conference.id, confName, confName, namingMode)

    const leagueNames = generateLeagueNamesForConference(
      conference.id,
      shell.leaguesPerConference,
      existingNames,
      conference.theme ?? undefined,
    )
    for (const ln of leagueNames) existingNames.push(ln)

    for (let L = 0; L < shell.leaguesPerConference; L++) {
      const name = leagueNames[L] ?? `League ${L + 1}`
      const slug = slugify(`${name}-${conference.id}-${L}`)
      const tl = await prisma.tournamentLeague.create({
        data: {
          tournamentId: shell.id,
          conferenceId: conference.id,
          roundId: round1.id,
          name,
          slug,
          leagueNumber: L + 1,
          teamSlots: shell.teamsPerLeague,
          advancersCount: shell.advancersPerLeague,
        },
      })
      await recordName(shell.id, 'league', tl.id, name, name, namingMode)
    }
  }

  if (namingMode === 'hybrid') {
    await prisma.tournamentAnnouncement.create({
      data: {
        tournamentId: shell.id,
        type: 'welcome',
        title: 'Name review',
        content:
          'Conference and league names were generated. Review and edit them in commissioner tools before launch.',
        targetAudience: 'all',
      },
    })
  }

  await prisma.tournamentAuditLog.create({
    data: {
      tournamentId: shell.id,
      action: 'league_created',
      actorType: 'system',
      targetType: 'tournament',
      targetId: tournamentId,
      data: { step: 'buildConferencesAndLeagues' },
    },
  })
}

export async function openRegistration(tournamentId: string): Promise<void> {
  await prisma.tournamentShell.update({
    where: { id: tournamentId },
    data: { status: 'registering' },
  })
  await prisma.tournamentAnnouncement.create({
    data: {
      tournamentId,
      type: 'welcome',
      title: 'Registration open',
      content: 'The tournament is open for registration. Claim your spot before the draft.',
      targetAudience: 'all',
    },
  })
}

export async function assignParticipantsToLeagues(tournamentId: string): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    include: {
      rounds: { orderBy: { roundNumber: 'asc' } },
      participants: true,
    },
  })
  if (!shell) throw new Error('Tournament shell not found')
  const round1 = shell.rounds.find((r) => r.roundNumber === 1)
  if (!round1) throw new Error('Round 1 not found')

  const tournamentLeagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: round1.id },
    include: { conference: true },
    orderBy: [{ conference: { conferenceNumber: 'asc' } }, { leagueNumber: 'asc' }],
  })

  const parts = [...shell.participants]
  shuffleInPlace(parts)

  let idx = 0
  for (const tl of tournamentLeagues) {
    const chunk: typeof parts = []
    while (chunk.length < shell.teamsPerLeague && idx < parts.length) {
      chunk.push(parts[idx]!)
      idx++
    }
    if (chunk.length === 0) continue

    await provisionTournamentLeagueWithManagers(
      shell,
      { id: tl.id, name: tl.name, conferenceId: tl.conferenceId },
      1,
      shell.teamsPerLeague,
      shell.openingRosterSize,
      chunk.map((p) => ({
        id: p.id,
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
      })),
      { fillOriginalConference: true },
    )
  }

  await prisma.tournamentAuditLog.create({
    data: {
      tournamentId: shell.id,
      roundNumber: 1,
      action: 'participant_assigned',
      actorType: 'system',
      data: { leagues: tournamentLeagues.length },
    },
  })
}

export async function launchTournamentShell(tournamentId: string): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) throw new Error('Tournament shell not found')
  const round1 = await prisma.tournamentRound.findFirst({
    where: { tournamentId, roundNumber: 1 },
  })
  if (!round1) throw new Error('Round 1 not found')
  const expected = shell.conferenceCount * shell.leaguesPerConference
  const ready = await prisma.tournamentLeague.count({
    where: { tournamentId, roundId: round1.id, leagueId: { not: null } },
  })
  if (ready < expected) {
    throw new Error(`Not all tournament leagues have underlying leagues (${ready}/${expected})`)
  }
  await prisma.tournamentShell.update({
    where: { id: tournamentId },
    data: { status: 'active' },
  })
  await prisma.tournamentAnnouncement.create({
    data: {
      tournamentId,
      type: 'round_started',
      title: 'Tournament is live',
      content: 'The tournament has launched. Good luck this season.',
      targetAudience: 'all',
    },
  })
}
