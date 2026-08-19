/**
 * Redraft matchup source (G11 Phase 2c).
 *
 * Resolves a matchup's pairing + rosters from the redraft engine tables
 * (`RedraftSeason` / `RedraftMatchup` / `RedraftRoster` / `RedraftRosterPlayer`)
 * instead of the generic `TeamWeekResult` / `Roster` model. Applies to every
 * redraft-family concept (Keeper, Dynasty, Best Ball, Guillotine, Survivor, etc.)
 * since they all build on `RedraftSeason` — not a redraft-only hack.
 *
 * Returns `null` when the league has no `RedraftSeason` (→ caller falls back to the
 * generic source). Never invents a pairing: a missing matchup yields a clear
 * `none` reason, and a missing opponent yields `bye`.
 */

import { prisma } from '@/lib/prisma'
import { isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { safeTeamDefenseDisplayName } from '@/lib/redraft/teamDefenseIdentity'
import type { MatchupContextResult, MatchupSideContext, MatchupSourceParams } from '@/server/services/matchupSources/types'

export type RosterPlayerRow = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  slotType: string
}

export type RosterWithPlayers = {
  id: string
  ownerName: string
  teamName: string | null
  avatarUrl: string | null
  wins: number
  losses: number
  ties: number
  players: RosterPlayerRow[]
}

/** RedraftMatchup.status → canonical week status the assembler understands. */
export function normalizeRedraftWeekStatus(status: string | null | undefined): 'upcoming' | 'live' | 'final' {
  const s = String(status ?? '').toLowerCase()
  if (s === 'final' || s === 'complete' || s === 'completed') return 'final'
  if (s === 'live' || s === 'in_progress') return 'live'
  return 'upcoming'
}

/** Pure: map a redraft roster (with players) into a matchup side context. Exported for tests. */
export function buildRedraftSideContext(
  roster: RosterWithPlayers,
  engineTotalPoints: number,
  weekStatus: 'upcoming' | 'live' | 'final',
  scoring?: { season: number; week: number },
): MatchupSideContext {
  const starters = roster.players
    .filter((p) => isScoringStarterSlot(p.slotType))
    .map((p) => ({
      id: p.playerId,
      position: String(p.position ?? '').toUpperCase(),
      // Readable team-defense names (nfl:def:KC → "KC Defense"); raw ids never leak.
      name: safeTeamDefenseDisplayName(p.playerId, p.playerName),
      team: p.team ?? undefined,
    }))
  return {
    rosterId: roster.id,
    teamName: roster.teamName ?? roster.ownerName ?? 'Team',
    avatarUrl: roster.avatarUrl ?? null,
    record: { wins: roster.wins, losses: roster.losses, ties: roster.ties },
    starters,
    weekStatus,
    engineTotalPoints,
    // Redraft scores live under RedraftSeason.season (may differ from League.season),
    // so the canonical score lookup must use the redraft season/week — not the
    // matchup-center's. Generic sources omit this and fall back to League.season.
    scoreSeason: scoring?.season,
    scoreWeek: scoring?.week,
  }
}

const rosterInclude = {
  players: {
    where: { droppedAt: null },
    select: { playerId: true, playerName: true, position: true, team: true, slotType: true },
  },
} as const

/**
 * Resolve the redraft matchup context for a viewer, or `null` if this league is
 * not redraft-family (no `RedraftSeason`).
 */
export async function resolveRedraftMatchupContext(
  params: MatchupSourceParams,
): Promise<MatchupContextResult | null> {
  const rseason = await prisma.redraftSeason.findFirst({
    where: { leagueId: params.leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, season: true, currentWeek: true },
  })
  if (!rseason) return null

  const week = params.week > 0 ? params.week : Math.max(1, rseason.currentWeek || 1)

  const selectedRoster = (await prisma.redraftRoster.findFirst({
    where: { seasonId: rseason.id, ownerId: params.viewerUserId },
    select: {
      id: true,
      ownerName: true,
      teamName: true,
      avatarUrl: true,
      wins: true,
      losses: true,
      ties: true,
      ...rosterInclude,
    },
  })) as RosterWithPlayers | null
  if (!selectedRoster) {
    return { kind: 'none', reason: 'no_redraft_roster_for_viewer' }
  }

  const matchup = await prisma.redraftMatchup.findFirst({
    where: {
      seasonId: rseason.id,
      week,
      OR: [{ homeRosterId: selectedRoster.id }, { awayRosterId: selectedRoster.id }],
    },
    select: {
      homeRosterId: true,
      awayRosterId: true,
      homeScore: true,
      awayScore: true,
      status: true,
      homeRoster: { select: { id: true, ownerName: true, teamName: true, avatarUrl: true, wins: true, losses: true, ties: true, ...rosterInclude } },
      awayRoster: { select: { id: true, ownerName: true, teamName: true, avatarUrl: true, wins: true, losses: true, ties: true, ...rosterInclude } },
    },
  })
  if (!matchup) {
    return { kind: 'none', reason: `no_redraft_matchup_for_week_${week}` }
  }

  return selectRedraftMatchupContext({
    selectedRosterId: selectedRoster.id,
    selectedFallback: selectedRoster,
    homeRosterId: matchup.homeRosterId,
    homeRoster: matchup.homeRoster as RosterWithPlayers | null,
    awayRoster: matchup.awayRoster as RosterWithPlayers | null,
    homeScore: matchup.homeScore,
    awayScore: matchup.awayScore,
    status: matchup.status,
    scoring: { season: rseason.season, week },
  })
}

/**
 * Pure: given a loaded matchup and which roster the viewer owns, produce the
 * matchup/bye context with the correct selected/opponent sides + engine totals.
 * Exported for deterministic tests (no DB). Never invents an opponent.
 */
export function selectRedraftMatchupContext(input: {
  selectedRosterId: string
  /** Used if the matchup relation didn't include the selected roster's players. */
  selectedFallback: RosterWithPlayers
  homeRosterId: string
  homeRoster: RosterWithPlayers | null
  awayRoster: RosterWithPlayers | null
  homeScore: number
  awayScore: number
  status: string | null | undefined
  /** Season/week the per-player scores are keyed to (RedraftSeason.season). */
  scoring?: { season: number; week: number }
}): MatchupContextResult {
  const isHome = input.homeRosterId === input.selectedRosterId
  const weekStatus = normalizeRedraftWeekStatus(input.status)
  const selRoster = (isHome ? input.homeRoster : input.awayRoster) ?? input.selectedFallback
  const oppRoster = isHome ? input.awayRoster : input.homeRoster
  const selScore = isHome ? input.homeScore : input.awayScore
  const oppScore = isHome ? input.awayScore : input.homeScore

  const selected = buildRedraftSideContext(selRoster, selScore, weekStatus, input.scoring)
  if (!oppRoster) return { kind: 'bye', selected }
  return {
    kind: 'matchup',
    selected,
    opponent: buildRedraftSideContext(oppRoster, oppScore, weekStatus, input.scoring),
  }
}
