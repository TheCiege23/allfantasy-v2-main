/**
 * The league page's Matchup tab for an IMPORTED league, built from the same stored week the core
 * Matchup screen and the dashboard strip read (`lib/core-app/matchup.ts` → `WeeklyMatchup` +
 * `league_player_weekly_scores`).
 *
 * 🛑 FOUND LIVE 2026-11-23. `/api/leagues/[id]/matchup-center` read only `TeamWeekResult`, which the
 * importers never write, so EVERY imported league's Matchup tab said "Team ddf6de vs No opponent,
 * 0.0" — Sleeper, Fantrax and ESPN alike — while the dashboard strip for the same league showed the
 * real game (66.66 vs 184.04). Same data, two readers, one of them blind.
 *
 * PURE — no I/O, so the mapping is testable without a database.
 */
import type { MatchupData, MatchupPlayerCell } from '@/lib/core-app/matchup'
import type { MatchupCenterPayload, MatchupGameStatus, MatchupPlayerSlot, MatchupSidePayload } from './types'

type Counts = { upcoming: number; live: number; final: number; unknown: number }

/** "7-3" / "7-3-1" → numbers; anything else is no record on file. */
export function parseRecord(record: string | null | undefined): { wins: number; losses: number; ties: number } {
  const m = /^\s*(\d+)-(\d+)(?:-(\d+))?/.exec(record ?? '')
  return m ? { wins: Number(m[1]), losses: Number(m[2]), ties: Number(m[3] ?? 0) } : { wins: 0, losses: 0, ties: 0 }
}

function winPct(r: { wins: number; losses: number; ties: number }): number {
  const g = r.wins + r.losses + r.ties
  return g > 0 ? (r.wins + r.ties * 0.5) / g : 0
}

/** A hole in the lineup, so the two columns stay aligned slot for slot. */
function emptySlot(slotLabel: string): MatchupPlayerSlot {
  return {
    playerId: '',
    name: 'Empty',
    position: slotLabel,
    team: null,
    opponent: null,
    headshotUrl: null,
    currentPoints: 0,
    projectedPoints: 0,
    hasRealProjection: false,
    injuryStatus: null,
    newsBlurb: null,
    weatherSummary: null,
    gameStatus: 'unknown',
    gameLabel: '',
    aiInsight: null,
  }
}

function toSlot(cell: MatchupPlayerCell | null, slotLabel: string): MatchupPlayerSlot {
  if (!cell || cell.empty) return emptySlot(slotLabel)
  const state: MatchupGameStatus = cell.gameState ?? 'unknown'
  // What the platform scored; AF's own estimate only where the platform's per-player score is absent.
  const points = cell.actual ?? cell.ownPoints ?? 0
  const projected = cell.projected
  const opponent = cell.unavailable === 'bye' ? 'BYE' : cell.opponentClub ?? null
  return {
    playerId: cell.sleeperId ?? cell.playerId,
    name: cell.name ?? 'Unknown player',
    position: cell.position ?? slotLabel,
    team: cell.team,
    opponent,
    headshotUrl: cell.imageUrl,
    currentPoints: points,
    projectedPoints: projected ?? points,
    hasRealProjection: projected != null,
    afProjectedPoints: cell.afEngine ?? null,
    injuryStatus: cell.unavailable === 'out' ? 'Out' : cell.injury ?? null,
    newsBlurb: null,
    weatherSummary: null,
    gameStatus: state,
    gameLabel: state === 'final' ? 'Final' : state === 'live' ? 'Live' : '',
    aiInsight: null,
    outlook:
      cell.kickoff || cell.home != null
        ? {
            homeAway: cell.home == null ? null : cell.home ? 'home' : 'away',
            kickoffTimeIso: cell.kickoff ?? null,
            opponentRank: null,
            teamLogoUrl: null,
            byeWeek: null,
            weather: null,
          }
        : null,
  }
}

function remaining(slots: MatchupPlayerSlot[], counts: Counts | null | undefined): number {
  if (counts) return counts.upcoming + counts.live
  return slots.filter((s) => s.playerId && s.gameStatus !== 'final').length
}

function afTotal(slots: MatchupPlayerSlot[]): { total: number | null; from: number } {
  const priced = slots.filter((s) => s.afProjectedPoints != null)
  return { total: priced.length ? priced.reduce((n, s) => n + (s.afProjectedPoints ?? 0), 0) : null, from: priced.length }
}

/**
 * The tab's payload from the stored week, or null when the week has no head-to-head on file (no
 * fixture, or an elimination format with no weekly opponent) — the caller then falls back to the old
 * read rather than inventing a game.
 */
export function matchupCenterFromMatchupData(
  data: MatchupData,
  opts: { leagueId: string; sport: string; season: number; conceptOverlay: string | null },
): Omit<MatchupCenterPayload, 'refreshIntervalMs' | 'insights'> | null {
  if (!data.teams.available || !data.week.available) return null
  const { you, opponent } = data.teams.data
  const slots = data.lineups.available ? data.lineups.data : []
  const leftSlots = slots.map((s) => toSlot(s.you, s.slotLabel))
  const rightSlots = slots.map((s) => toSlot(s.opponent, s.slotLabel))
  const scored = data.sides.available ? data.sides.data : null
  const bySide = data.starterCountsBySide ?? null

  const side = (
    team: typeof you,
    rosterId: string,
    points: number,
    starters: MatchupPlayerSlot[],
    counts: Counts | null | undefined,
  ): MatchupSidePayload => {
    const record = parseRecord(team.record)
    const af = afTotal(starters)
    const real = starters.filter((s) => s.playerId)
    return {
      rosterId,
      teamName: team.teamName,
      avatarUrl: team.avatarUrl,
      record,
      winPct: winPct(record),
      totalPoints: points,
      projectedTotal: real.reduce((n, s) => n + s.projectedPoints, 0),
      afProjectedTotal: af.total,
      afProjectedFrom: af.from,
      projectedTotalIncludesFallback: real.some((s) => !s.hasRealProjection),
      starters,
      remainingStarters: remaining(starters, counts),
    }
  }

  const left = side(you, 'you', scored?.you.points ?? 0, leftSlots, bySide?.you)
  const right = side(opponent, 'opponent', scored?.opponent.points ?? 0, rightSlots, bySide?.opponent)

  const counts = data.starterCounts ?? null
  const anyPoints = left.totalPoints > 0 || right.totalPoints > 0
  const matchupStatus: MatchupCenterPayload['matchupStatus'] = data.week.data.isFinal
    ? 'final'
    : (counts?.live ?? 0) > 0 || (anyPoints && (counts == null || counts.upcoming > 0 || counts.unknown > 0))
      ? 'live'
      : anyPoints
        ? 'final'
        : 'upcoming'

  // The same forecast the core Matchup screen shows; a fraction, never a guess when it refused.
  const p = data.winProbability.available ? data.winProbability.data.pWin : null
  const winProbabilityLeft = p == null || !Number.isFinite(p) ? null : p > 1 ? p / 100 : p

  return {
    leagueId: opts.leagueId,
    season: data.week.data.season ?? opts.season,
    week: data.week.data.week,
    sport: opts.sport,
    matchupStatus,
    conceptOverlay: opts.conceptOverlay,
    left,
    right,
    winProbabilityLeft,
    partialData: !data.lineups.available,
  }
}
