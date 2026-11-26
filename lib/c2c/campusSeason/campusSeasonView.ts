/**
 * What the league page shows for the college side of a "separate" NFL C2C league: the college standings,
 * a week of college matchups, the college champion, and the overall title (best combined finish).
 * Read-only.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { overallTitleStandings } from './campusSeasonRules'

export type CampusSeasonView = {
  season: number
  status: string
  regularSeasonWeeks: number
  playoffTeams: number
  championRosterId: string | null
  week: number
  weeks: number[]
  teams: Record<string, { name: string }>
  standings: Array<{ rosterId: string; rank: number | null; seed: number | null; wins: number; losses: number; ties: number; medianWins: number; medianLosses: number; medianTies: number; pointsFor: number; pointsAgainst: number }>
  matchups: Array<{ id: string; week: number; kind: string; playoffRound: number | null; status: string; homeRosterId: string; awayRosterId: string | null; homeScore: number; awayScore: number }>
  overall: Array<{ rosterId: string; rank: number; wins: number; losses: number; ties: number; pointsFor: number }>
}

/** Null when the league has no college season (not separate, or not started). */
export async function loadCampusSeasonView(leagueId: string, opts: { week?: number | null; db?: PrismaClient } = {}): Promise<CampusSeasonView | null> {
  const db = opts.db ?? defaultPrisma
  const campus = await db.c2CCampusSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' } })
  if (!campus) return null
  const [standings, matchups, rosters] = await Promise.all([
    db.c2CCampusStanding.findMany({ where: { campusSeasonId: campus.id }, orderBy: [{ rank: 'asc' }] }),
    db.c2CCampusMatchup.findMany({ where: { campusSeasonId: campus.id }, orderBy: [{ week: 'asc' }, { bracketSlot: 'asc' }] }),
    db.redraftRoster.findMany({ where: { seasonId: campus.redraftSeasonId }, select: { id: true, teamName: true, wins: true, losses: true, ties: true, pointsFor: true } }),
  ])
  const weeks = [...new Set(matchups.map((m) => m.week))].sort((a, b) => a - b)
  // The week shown: the one asked for, else the latest week with play, else the first.
  const played = matchups.filter((m) => m.status !== 'scheduled' && m.awayRosterId).map((m) => m.week)
  const week = opts.week && weeks.includes(opts.week) ? opts.week : played.length ? Math.max(...played) : weeks[0] ?? 1
  const teams: CampusSeasonView['teams'] = {}
  rosters.forEach((r, i) => { teams[r.id] = { name: r.teamName?.trim() || `Team ${i + 1}` } })
  return {
    season: campus.season,
    status: campus.status,
    regularSeasonWeeks: campus.regularSeasonWeeks,
    playoffTeams: campus.playoffTeams,
    championRosterId: campus.championRosterId,
    week,
    weeks,
    teams,
    standings: standings.map((s) => ({
      rosterId: s.rosterId, rank: s.rank, seed: s.seed, wins: s.wins, losses: s.losses, ties: s.ties,
      medianWins: s.medianWins, medianLosses: s.medianLosses, medianTies: s.medianTies, pointsFor: s.pointsFor, pointsAgainst: s.pointsAgainst,
    })),
    matchups: matchups
      .filter((m) => m.week === week)
      .map((m) => ({ id: m.id, week: m.week, kind: m.kind, playoffRound: m.playoffRound, status: m.status, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId, homeScore: m.homeScore, awayScore: m.awayScore })),
    overall: overallTitleStandings({
      pro: rosters.map((r) => ({ rosterId: r.id, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor })),
      college: standings.map((s) => ({ ...s, rank: s.rank ?? 0 })),
    }).map(({ rosterId, rank, wins, losses, ties, pointsFor }) => ({ rosterId, rank, wins, losses, ties, pointsFor })),
  }
}
