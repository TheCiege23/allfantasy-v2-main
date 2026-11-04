import { writeFile } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { getLeagueInfo, getLeagueMatchups } from '@/lib/sleeper-client'

const ROOTS = 8
const PRIOR_SEASONS = 6
const WEEKS = [1, 8, 14]

async function main() {
  const roots = await prisma.$queryRaw<Array<{ providerId: string }>>`
    SELECT DISTINCT l."platformLeagueId" AS "providerId"
    FROM leagues l WHERE lower(l.platform) = 'sleeper' AND upper(l.sport::text) = 'NFL' AND l.season = 2026
      AND l."platformLeagueId" ~ '^[0-9]+$'
      AND EXISTS (SELECT 1 FROM "WeeklyMatchup" w WHERE w."leagueId" = l."platformLeagueId" AND w."seasonYear" = 2026)
    ORDER BY 1 LIMIT ${ROOTS}
  `
  const manifest: Array<{ leagueId: string; seasonYear: number; week: number; matchupId: number; rosterId: string; pointsFor: number; pointsAgainst: number }> = []
  const seen = new Set<string>()
  const report = new Map<number, { leagues: number; sampledWeeks: number; weeksWithPairedScores: number; weeksMissingFromStore: number; weeksWithDifferentStoredTotals: number }>()
  let unreadableOrInvalidLinks = 0
  for (const root of roots) {
    let current = await getLeagueInfo(root.providerId)
    for (let hop = 0; hop < PRIOR_SEASONS; hop++) {
      const prior = current?.previous_league_id
      if (!prior || prior === '0' || seen.has(prior)) break
      if (!/^\d+$/.test(prior)) { unreadableOrInvalidLinks++; break }
      const league = await getLeagueInfo(prior)
      const season = Number(league?.season)
      if (!league || league.league_id !== prior || league.sport !== 'nfl' || !Number.isInteger(season) || season >= Number(current?.season)) {
        unreadableOrInvalidLinks++
        break
      }
      current = league
      seen.add(prior)
      const summary = report.get(season) ?? { leagues: 0, sampledWeeks: 0, weeksWithPairedScores: 0, weeksMissingFromStore: 0, weeksWithDifferentStoredTotals: 0 }
      summary.leagues++
      for (const week of WEEKS) {
        const [matchups, stored] = await Promise.all([
          getLeagueMatchups(prior, week),
          prisma.weeklyMatchup.findMany({ where: { leagueId: prior, seasonYear: season, week },
            select: { rosterId: true, pointsFor: true } }),
        ])
        summary.sampledWeeks++
        if (!Array.isArray(matchups)) continue
        const pairs = new Map<number, Array<{ rosterId: string; points: number }>>()
        for (const row of matchups) {
          const points = (row as typeof row & { custom_points?: number | null }).custom_points ?? row.points
          if (!Number.isInteger(row.matchup_id) || typeof points !== 'number' || !Number.isFinite(points)) continue
          if (!Number.isInteger(row.roster_id) || row.roster_id < 1) continue
          const group = pairs.get(row.matchup_id!) ?? []
          group.push({ rosterId: String(row.roster_id), points })
          pairs.set(row.matchup_id!, group)
        }
        const pairedGames = [...pairs].filter(([, group]) => group.length === 2 &&
          group[0]!.rosterId !== group[1]!.rosterId && group.some((row) => row.points !== 0))
        const paired = pairedGames.flatMap(([, group]) => group)
        if (!paired.length) continue
        summary.weeksWithPairedScores++
        const byRoster = new Map(stored.map((row) => [row.rosterId, row.pointsFor]))
        if (paired.some((row) => !byRoster.has(row.rosterId))) {
          summary.weeksMissingFromStore++
          for (const [matchupId, pair] of pairedGames) {
            for (const [i, row] of pair.entries()) manifest.push({ leagueId: prior, seasonYear: season, week,
              matchupId, rosterId: row.rosterId, pointsFor: row.points, pointsAgainst: pair[1 - i]!.points })
          }
        }
        if (paired.some((row) => byRoster.has(row.rosterId) && Math.abs(byRoster.get(row.rosterId)! - row.points) > 0.01)) {
          summary.weeksWithDifferentStoredTotals++
        }
      }
      report.set(season, summary)
    }
  }
  const path = process.argv[2]
  if (path) {
    const weeks = new Set(manifest.map((row) => [row.leagueId, row.seasonYear, row.week].join(':')))
    if (weeks.size !== 70 || unreadableOrInvalidLinks || [...report.values()].some((s) => s.weeksWithDifferentStoredTotals)) {
      throw new Error('The current provider sample differs from the reviewed backfill.')
    }
    await writeFile(path, JSON.stringify(manifest), { flag: 'wx' })
  }
  console.log(JSON.stringify({ manifestRows: manifest.length, sampledRoots: roots.length, priorLeagues: seen.size, unreadableOrInvalidLinks,
    seasons: [...report].sort(([a], [b]) => a - b).map(([season, counts]) => ({ season, ...counts })) }))
}

main().catch(() => { console.error('Sleeper matchup audit failed'); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
