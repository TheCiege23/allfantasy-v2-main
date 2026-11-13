/**
 * HistoricMomentDetector — detects historic moments from league/season data for Hall of Fame.
 * Produces candidate moments (championships, upsets, comebacks, records) with significance scores.
 */

import { prisma } from '@/lib/prisma'
import { getDefaultSeasonsConsidered } from './SportHallOfFameResolver'
import type { HallOfFameMomentInput } from './types'

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)

interface MomentCandidate {
  leagueId: string
  sport: string
  season: string
  headline: string
  summary: string
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  relatedMatchupId?: string | null
  significanceScore: number
}

/**
 * Detect championship moments from SeasonResult (champion = true).
 */
async function detectChampionshipMoments(
  leagueId: string,
  sport: string,
  options?: { maxSeasons?: number }
): Promise<MomentCandidate[]> {
  const maxSeasons = options?.maxSeasons ?? getDefaultSeasonsConsidered(sport)
  const results = await prisma.seasonResult.findMany({
    where: { leagueId, champion: true },
    orderBy: { season: 'desc' },
    take: maxSeasons * 2,
  })
  const bySeason = new Map<string, typeof results>()
  for (const r of results) {
    const list = bySeason.get(r.season) ?? []
    list.push(r)
    bySeason.set(r.season, list)
  }
  const out: MomentCandidate[] = []
  for (const [season, rows] of bySeason) {
    const champ = rows[0]
    if (!champ) continue
    out.push({
      leagueId,
      sport,
      season,
      headline: `Championship — Season ${season}`,
      summary: `League champion for ${season}.`,
      relatedManagerIds: [],
      relatedTeamIds: [champ.rosterId],
      significanceScore: 0.9,
    })
  }
  return out
}

/**
 * Detect high-dominance (record wins/points) seasons as record-breaking moments.
 */
async function detectRecordSeasonMoments(
  leagueId: string,
  sport: string,
  options?: { maxSeasons?: number }
): Promise<MomentCandidate[]> {
  const maxSeasons = options?.maxSeasons ?? getDefaultSeasonsConsidered(sport)
  const results = await prisma.seasonResult.findMany({
    where: { leagueId },
    orderBy: { season: 'desc' },
  })
  const bySeason = new Map<string, typeof results>()
  for (const r of results) {
    const list = bySeason.get(r.season) ?? []
    list.push(r)
    bySeason.set(r.season, list)
  }
  const seasons = [...bySeason.keys()].sort((a, b) => Number(b) - Number(a)).slice(0, maxSeasons)
  const out: MomentCandidate[] = []
  let maxWins = 0
  let maxPf = 0
  for (const rows of bySeason.values()) {
    for (const r of rows) {
      maxWins = Math.max(maxWins, r.wins ?? 0)
      maxPf = Math.max(maxPf, Number(r.pointsFor ?? 0))
    }
  }
  for (const season of seasons) {
    const rows = bySeason.get(season) ?? []
    const sorted = [...rows].sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0))
    const top = sorted[0]
    if (!top || maxWins <= 0) continue
    const wins = top.wins ?? 0
    const pf = Number(top.pointsFor ?? 0)
    if (wins >= maxWins * 0.95 || (maxPf > 0 && pf >= maxPf * 0.95)) {
      out.push({
        leagueId,
        sport,
        season,
        headline: `Record season — ${wins} wins, ${pf.toFixed(0)} PF`,
        summary: `One of the league's top single-season performances in ${season}.`,
        relatedManagerIds: [],
        relatedTeamIds: [top.rosterId],
        significanceScore: clamp01(0.5 + (wins / Math.max(1, maxWins)) * 0.4),
      })
    }
  }
  return out.slice(0, 10)
}

/**
 * Build all moment candidates for a league (championships + record seasons).
 * Caller can merge with HallOfFameService to persist as HallOfFameMoment.
 */
export async function detectHistoricMoments(
  leagueId: string,
  sport: string,
  options?: { maxSeasons?: number }
): Promise<MomentCandidate[]> {
  const [champs, records] = await Promise.all([
    detectChampionshipMoments(leagueId, sport, options),
    detectRecordSeasonMoments(leagueId, sport, options),
  ])
  const seen = new Set<string>()
  const out: MomentCandidate[] = []
  for (const m of [...champs, ...records]) {
    const key = `${m.season}:${m.headline}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out.sort((a, b) => b.significanceScore - a.significanceScore)
}

export function toMomentInput(c: MomentCandidate): HallOfFameMomentInput {
  return {
    leagueId: c.leagueId,
    sport: c.sport,
    season: c.season,
    headline: c.headline,
    summary: c.summary,
    relatedManagerIds: c.relatedManagerIds,
    relatedTeamIds: c.relatedTeamIds,
    relatedMatchupId: c.relatedMatchupId,
    significanceScore: c.significanceScore,
  }
}
