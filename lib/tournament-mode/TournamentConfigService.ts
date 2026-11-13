/**
 * [NEW] lib/tournament-mode/TournamentConfigService.ts
 * Resolve tournament and conference config for a league (for specialty registry and UI).
 */

import { prisma } from '@/lib/prisma'

interface TournamentLeagueConfig {
  tournamentId: string
  tournamentName: string
  sport: string
  status: string
  conferenceId: string
  conferenceName: string
  conferenceTheme: string
  roundIndex: number
  phase: string
  orderInConference: number
  settings: Record<string, unknown>
  hubSettings: Record<string, unknown>
}

/** Detect if league is part of a tournament (legacy shell or TournamentShell). */
export async function isTournamentLeague(leagueId: string): Promise<boolean> {
  const legacy = await prisma.legacyTournamentLeague.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (legacy) return true
  const shellLink = await prisma.tournamentLeague.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  return !!shellLink
}

/** Get tournament config for a league (for registry getConfig and UI). */
export async function getTournamentConfigForLeague(leagueId: string): Promise<TournamentLeagueConfig | null> {
  const tl = await prisma.legacyTournamentLeague.findUnique({
    where: { leagueId },
    include: {
      tournament: true,
      conference: true,
    },
  })
  if (!tl) return null
  return {
    tournamentId: tl.tournament.id,
    tournamentName: tl.tournament.name,
    sport: tl.tournament.sport,
    status: tl.tournament.status,
    conferenceId: tl.conference.id,
    conferenceName: tl.conference.name,
    conferenceTheme: tl.conference.theme,
    roundIndex: tl.roundIndex,
    phase: tl.phase,
    orderInConference: tl.orderInConference,
    settings: (tl.tournament.settings as Record<string, unknown>) ?? {},
    hubSettings: (tl.tournament.hubSettings as Record<string, unknown>) ?? {},
  }
}

/** Upsert: no-op for tournament (config lives on Tournament); here for registry compatibility. */
export async function upsertTournamentConfig(
  _leagueId: string,
  _input: Record<string, unknown>
): Promise<null> {
  return null
}
