/**
 * [NEW] lib/tournament-mode/TournamentCreationService.ts
 * Creates tournament parent, conferences, batch of feeder leagues, round records, and invite distribution.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { runPostCreateInitialization } from '@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator'
import { buildLeagueInviteUrl } from '@/lib/viral-loop'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { RetiredConceptError, checkRetiredConcept } from '@/lib/league-creation/retiredConcepts'
import {
  DEFAULT_TOURNAMENT_SETTINGS,
  TOURNAMENT_LEAGUE_VARIANT,
  BLACK_VS_GOLD_CONFERENCE_NAMES,
} from './constants'
import { generateLeagueNames, getConferenceDisplayNames, generateInviteCode } from './LeagueNamingService'
import type { CreateTournamentInput, TournamentSettings, InviteDistributionItem } from './types'
import {
  getFeederLeagueCountForPool,
  getQualificationAdvancementTotal,
  TOURNAMENT_TEAMS_PER_LEAGUE,
} from './tournament-sport-cutoffs'
import { defaultAiAutomationV1 } from '@/lib/tournament/ai-automation-hub'

function normalizeTournamentDraftType(raw: unknown): 'snake' | 'auction' {
  const s = String(raw ?? 'snake').toLowerCase()
  if (s === 'auction') return 'auction'
  return 'snake'
}

/** Canonical hub defaults for new tournaments; commissioner may override via wizard input. */
export function mergeDefaultTournamentHubSettings(partial: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const p = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const merged: Record<string, unknown> = {
    eligibilityMode: 'open',
    waitlistEnabled: false,
    defaultLeftChatTab: 'league',
    aiAutomationV1: defaultAiAutomationV1(),
    ...p,
  }
  if (p.aiAutomationV1 != null && typeof p.aiAutomationV1 === 'object' && !Array.isArray(p.aiAutomationV1)) {
    merged.aiAutomationV1 = { ...defaultAiAutomationV1(), ...(p.aiAutomationV1 as Record<string, boolean>) }
  }
  return merged
}

/**
 * Per feeder league after DB row + bootstrap + `LegacyTournamentLeague` link: invite links + draft session shell.
 * Idempotent for invites (overwrites inviteCode/inviteLink) and draft session (get-or-create).
 * Posts one League Chat welcome line (virtual `league:{id}`) unless `settings.leagueChatWelcomePosted` is already set.
 */
export async function applyTournamentFeederInviteAndDraftShell(leagueId: string): Promise<{
  inviteCode: string
  joinUrl: string
}> {
  const inviteCode = generateInviteCode()
  const joinUrl = buildLeagueInviteUrl(inviteCode, { params: { utm_campaign: 'tournament_invite' } })
  const row = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, userId: true, name: true },
  })
  if (!row) {
    throw new Error(`League not found: ${leagueId}`)
  }
  const currentSettings = (row.settings as Record<string, unknown>) ?? {}
  const nextSettings: Record<string, unknown> = { ...currentSettings, inviteCode, inviteLink: joinUrl }
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: nextSettings,
    },
  })
  try {
    const { getOrCreateDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
    await getOrCreateDraftSession(leagueId)
  } catch (err) {
    console.warn('[tournament-mode] Draft session shell non-fatal', leagueId, err)
  }

  const welcomeDone = currentSettings.leagueChatWelcomePosted === true
  if (!welcomeDone && row.userId) {
    try {
      const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
      const tournamentName =
        typeof currentSettings.tournamentName === 'string' && currentSettings.tournamentName.trim()
          ? currentSettings.tournamentName.trim()
          : 'your tournament'
      const body = `Welcome to ${(row.name ?? 'this league').trim()}. Use League Chat for this feeder — open your tournament hub for cross-league updates. (${tournamentName})`
      await createLeagueChatMessage(leagueId, row.userId, body, {
        type: 'system',
        metadata: { tournamentShellWelcome: true },
        source: null,
      })
      await prisma.league.update({
        where: { id: leagueId },
        data: {
          settings: { ...nextSettings, leagueChatWelcomePosted: true },
        },
      })
    } catch (err) {
      console.warn('[tournament-mode] League chat welcome message non-fatal', leagueId, err)
    }
  }

  return { inviteCode, joinUrl }
}

/** Feeder league count: pool size tiered to 6 / 12 / 18 leagues of 12 teams, or floor(pool/12). */
export function computeLeagueCount(participantPoolSize: number, initialLeagueSize: number = TOURNAMENT_TEAMS_PER_LEAGUE): number {
  if (initialLeagueSize === TOURNAMENT_TEAMS_PER_LEAGUE) {
    return getFeederLeagueCountForPool(participantPoolSize)
  }
  const size = Math.max(4, Math.floor(Number(initialLeagueSize)))
  return Math.max(2, Math.floor(participantPoolSize / size))
}

/**
 * Create full tournament: Tournament, 2 conferences, N leagues (with bootstrap), TournamentLeague links, rounds, invite codes.
 */
export async function createTournament(input: CreateTournamentInput): Promise<{
  tournamentId: string
  leagueIds: string[]
  inviteDistribution: InviteDistributionItem[]
  conferenceNames: [string, string]
}> {
  // Tournament Mode is retired from active creation (2026-07-23). This is the
  // deepest boundary — throwing here closes every caller at once, including any
  // future one, rather than relying on each route to remember the policy.
  // Existing tournaments are untouched: this function only ever creates.
  const retired = checkRetiredConcept('tournament')
  if (retired) {
    throw new RetiredConceptError(retired.code, retired.message)
  }

  const sport = normalizeToSupportedSport(input.sport)
  const merged = {
    ...DEFAULT_TOURNAMENT_SETTINGS,
    ...input.settings,
  }
  const poolSize = merged.participantPoolSize
  const settings: TournamentSettings = {
    ...merged,
    initialLeagueSize: TOURNAMENT_TEAMS_PER_LEAGUE,
    draftType: normalizeTournamentDraftType(merged.draftType),
    qualificationAdvancementTotal: getQualificationAdvancementTotal(String(sport ?? 'NFL'), poolSize),
    eliminationAdvancementPerLeague:
      typeof merged.eliminationAdvancementPerLeague === 'number'
        ? merged.eliminationAdvancementPerLeague
        : DEFAULT_TOURNAMENT_SETTINGS.eliminationAdvancementPerLeague,
  }
  const leagueCount = computeLeagueCount(settings.participantPoolSize, TOURNAMENT_TEAMS_PER_LEAGUE)
  if (leagueCount < 2) {
    throw new Error('Tournament mode requires at least 2 feeder leagues.')
  }
  const perConference = Math.ceil(leagueCount / 2)
  const themeSeed = Date.now() % 1_000_000
  const [confA, confB] = getConferenceDisplayNames(
    settings.conferenceMode,
    input.conferenceNames,
    themeSeed
  )

  const tournament = await prisma.legacyTournament.create({
    data: {
      name: input.name.trim(),
      sport,
      season: input.season ?? new Date().getFullYear(),
      variant: input.variant ?? 'black_vs_gold',
      creatorId: input.creatorId,
      settings: settings as unknown as Record<string, unknown>,
      hubSettings: mergeDefaultTournamentHubSettings(
        (input.hubSettings ?? null) as Record<string, unknown> | null,
      ) as unknown as Record<string, unknown>,
      status: 'qualification',
    },
  })

  const confARow = await prisma.legacyTournamentConference.create({
    data: {
      tournamentId: tournament.id,
      name: confA,
      theme: settings.conferenceMode === 'black_vs_gold' ? 'black' : 'custom',
      orderIndex: 0,
    },
  })
  const confBRow = await prisma.legacyTournamentConference.create({
    data: {
      tournamentId: tournament.id,
      name: confB,
      theme: settings.conferenceMode === 'black_vs_gold' ? 'gold' : 'custom',
      orderIndex: 1,
    },
  })

  const leagueNames = generateLeagueNames(
    leagueCount,
    settings.leagueNamingMode,
    settings.conferenceMode,
    0,
    input.leagueNames,
    themeSeed
  )

  const inviteDistribution: InviteDistributionItem[] = []
  const leagueIds: string[] = []

  for (let i = 0; i < leagueCount; i++) {
    const conference = i < perConference ? confARow : confBRow
    const conferenceName = i < perConference ? confA : confB
    const leagueName = leagueNames[i] ?? `League ${i + 1}`

    const league = await prisma.league.create({
      data: {
        userId: input.creatorId,
        name: leagueName,
        platform: 'manual',
        platformLeagueId: `tournament-${tournament.id}-${i}-${Date.now()}`,
        leagueSize: TOURNAMENT_TEAMS_PER_LEAGUE,
        scoring: 'PPR',
        isDynasty: false,
        sport,
        leagueVariant: TOURNAMENT_LEAGUE_VARIANT,
        settings: {
          league_type: 'tournament',
          tournamentId: tournament.id,
          tournamentName: input.name,
          conferenceName,
          roundIndex: 0,
          phase: 'qualification',
        },
        syncStatus: 'manual',
      },
    })
    leagueIds.push(league.id)

    try {
      await runPostCreateInitialization(league.id, sport, TOURNAMENT_LEAGUE_VARIANT)
    } catch (err) {
      console.warn('[tournament-mode] Bootstrap non-fatal for league', league.id, err)
    }

    const orderInConference = i < perConference ? i : i - perConference
    await prisma.legacyTournamentLeague.create({
      data: {
        tournamentId: tournament.id,
        conferenceId: conference.id,
        leagueId: league.id,
        roundIndex: 0,
        phase: 'qualification',
        orderInConference,
      },
    })

    const { inviteCode, joinUrl } = await applyTournamentFeederInviteAndDraftShell(league.id)

    inviteDistribution.push({
      leagueId: league.id,
      leagueName: league.name ?? leagueName,
      conferenceName,
      inviteCode,
      joinUrl,
    })
  }

  await prisma.legacyTournamentRound.create({
    data: {
      tournamentId: tournament.id,
      roundIndex: 0,
      phase: 'qualification',
      name: 'Qualification',
      startWeek: 1,
      endWeek: settings.qualificationWeeks,
      status: 'pending',
      settings: {
        qualificationWeeks: settings.qualificationWeeks,
        advancementCount: null,
        benchSpots: settings.benchSpotsQualification,
        faabBudget: settings.faabBudgetDefault,
      },
    },
  })

  return {
    tournamentId: tournament.id,
    leagueIds,
    inviteDistribution,
    conferenceNames: [confA, confB],
  }
}
