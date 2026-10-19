/**
 * Weekly scores for tournament teams, read from Postgres (the conference leagues'
 * `RedraftMatchup` rows) — never from a provider.
 *
 * Unlike `computeWeeklyPointsByTlpId`, this keeps FINALITY: a matchup whose
 * status is not 'final' is reported as provisional, and a team with no matchup in
 * a week is simply absent. Callers must treat absent as missing, not zero.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import type { WeekScore } from './engine'

export type LeagueSlice = { leagueId: string | null; participants: Array<{ id: string; redraftRosterId: string | null }> }

type Row = { week: number; homeRosterId: string; awayRosterId: string | null; homeScore: number; awayScore: number; status: string }

async function readRows(leagues: LeagueSlice[], weeks: { gte: number; lte: number }) {
  const out: Array<{ tlpId: string; week: number; points: number; final: boolean }> = []
  for (const league of leagues) {
    if (!league.leagueId) continue
    const season = await prisma.redraftSeason.findFirst({ where: { leagueId: league.leagueId }, orderBy: { season: 'desc' }, select: { id: true } })
    if (!season) continue
    const byRoster = new Map(league.participants.filter(p => p.redraftRosterId).map(p => [p.redraftRosterId!, p.id]))
    if (!byRoster.size) continue
    const rows: Row[] = await prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, leagueId: league.leagueId, week: weeks, isMedianMatchup: false },
      select: { week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true },
    })
    for (const m of rows) {
      const final = m.status === 'final'
      const home = byRoster.get(m.homeRosterId)
      if (home) out.push({ tlpId: home, week: m.week, points: m.homeScore, final })
      const away = m.awayRosterId ? byRoster.get(m.awayRosterId) : undefined
      if (away) out.push({ tlpId: away, week: m.week, points: m.awayScore, final })
    }
  }
  return out
}

/** One week's score per tournament league participant. */
export async function readWeekScores(leagues: LeagueSlice[], week: number): Promise<Map<string, WeekScore>> {
  const map = new Map<string, WeekScore>()
  for (const r of await readRows(leagues, { gte: week, lte: week })) map.set(r.tlpId, { points: r.points, final: r.final })
  return map
}

export type SeasonSummary = { bestWeek: number | null; weeksFinal: number; weeksProvisional: number }

/** Best single week and finality through `throughWeek`, per participant. */
export async function readSeasonSummaries(leagues: LeagueSlice[], throughWeek: number): Promise<Map<string, SeasonSummary>> {
  const map = new Map<string, SeasonSummary>()
  for (const r of await readRows(leagues, { gte: 1, lte: throughWeek })) {
    const cur = map.get(r.tlpId) ?? { bestWeek: null, weeksFinal: 0, weeksProvisional: 0 }
    if (r.final) { cur.weeksFinal++; cur.bestWeek = cur.bestWeek === null ? r.points : Math.max(cur.bestWeek, r.points) } else cur.weeksProvisional++
    map.set(r.tlpId, cur)
  }
  return map
}
