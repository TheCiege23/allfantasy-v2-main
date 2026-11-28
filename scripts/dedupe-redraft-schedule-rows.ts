/**
 * Census and repair of doubled native-league schedules. READ-ONLY unless `--write` is passed.
 *
 *   npx tsx scripts/dedupe-redraft-schedule-rows.ts                 # census, every league
 *   npx tsx scripts/dedupe-redraft-schedule-rows.ts --league=<id>   # census, one league
 *   npx tsx scripts/dedupe-redraft-schedule-rows.ts --league=<id> --write
 *
 * WHAT IS WRONG. `ensureScheduleForNewSeason` counted a season's matchups and inserted a full schedule
 * when it found none, with several awaits between the two and no lock. Draft completion can sync more
 * than once at the same moment, so every run that counted 0 wrote the whole schedule again. Seen
 * 2026-11-28 on an NBA league: its scoreboard listed the viewer's game three times in one week. New
 * schedules are guarded by `lib/redraft/scheduleWriteLock.ts`; this repairs the ones already written.
 *
 * WHAT IT TOUCHES. Only a league that plays ONE game a week (`readGamesPerWeek` === 1), where the same
 * two teams meeting twice in one week cannot be legitimate. A league set to several games a week can
 * meet an opponent twice on purpose, so it is listed and never touched.
 *
 * WHICH ROW SURVIVES. The one carrying the most: a non-`scheduled` status, then a non-zero score, then a
 * lineup snapshot, then the oldest id. A duplicate that anything references (a pirate claim, a C2C score)
 * is never deleted; the group is reported for a human instead.
 *
 * STANDINGS. A doubled week counted every game in it, so records can be off (one screen read 0-1 while
 * another read 0-0). `--write` recomputes standings for every season it repaired.
 *
 * ⚠ THIS TALKS TO WHATEVER `DATABASE_URL` NAMES, and `.env` / `.env.local` here point at production. Run
 * the census first and read it.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readGamesPerWeek } from '../lib/schedule-runtime/gamesPerWeek'
import { updateStandings } from '../lib/redraft/standingsEngine'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
const LEAGUE = process.argv.find((a) => a.startsWith('--league='))?.slice('--league='.length) ?? null

type Row = {
  id: string
  seasonId: string
  week: number
  type: string
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  status: string
  lineupSnapshots: unknown
  _count: { pirateClaims: number; c2cMatchupScores: number }
}

const richness = (r: Row) =>
  (r.status !== 'scheduled' ? 4 : 0) + (r.homeScore !== 0 || r.awayScore !== 0 ? 2 : 0) + (r.lineupSnapshots != null ? 1 : 0)

async function main() {
  const seasons = await prisma.redraftSeason.findMany({
    where: LEAGUE ? { leagueId: LEAGUE } : {},
    select: { id: true, leagueId: true, season: true, currentWeek: true, league: { select: { name: true, settings: true } } },
  })
  let groups = 0
  let toDelete: string[] = []
  const repairedSeasons = new Set<string>()
  for (const s of seasons) {
    const rows = (await prisma.redraftMatchup.findMany({
      where: { seasonId: s.id, isMedianMatchup: false, awayRosterId: { not: null } },
      select: {
        id: true, seasonId: true, week: true, type: true, homeRosterId: true, awayRosterId: true, homeScore: true,
        awayScore: true, status: true, lineupSnapshots: true, _count: { select: { pirateClaims: true, c2cMatchupScores: true } },
      },
      orderBy: { id: 'asc' },
    })) as unknown as Row[]
    const byKey = new Map<string, Row[]>()
    for (const r of rows) {
      const key = `${r.week}|${r.type}|${[r.homeRosterId, r.awayRosterId].sort().join('|')}`
      byKey.set(key, [...(byKey.get(key) ?? []), r])
    }
    const dupes = [...byKey.values()].filter((g) => g.length > 1)
    if (dupes.length === 0) continue
    const gpw = readGamesPerWeek(s.league?.settings)
    console.log(`\n${s.league?.name ?? s.leagueId} (league ${s.leagueId}, season ${s.season}, games/week ${gpw}): ${dupes.length} repeated pairings`)
    if (gpw !== 1) {
      console.log('  plays several games a week; repeats may be intended. Not touched.')
      continue
    }
    for (const g of dupes) {
      groups += 1
      const keep = [...g].sort((a, b) => richness(b) - richness(a) || a.id.localeCompare(b.id))[0]
      const losers = g.filter((r) => r.id !== keep.id)
      const blocked = losers.filter((r) => r._count.pirateClaims > 0 || r._count.c2cMatchupScores > 0)
      console.log(`  week ${g[0].week}: ${g.length} copies, keep ${keep.id}${blocked.length ? `, ${blocked.length} referenced (left for a human)` : ''}`)
      const del = losers.filter((r) => !blocked.includes(r)).map((r) => r.id)
      if (del.length) repairedSeasons.add(s.id)
      toDelete = toDelete.concat(del)
    }
  }
  console.log(`\n${groups} duplicated games, ${toDelete.length} rows to delete${WRITE ? '' : ' (census only: pass --write to delete)'}.`)
  if (!WRITE || toDelete.length === 0) return
  const res = await prisma.redraftMatchup.deleteMany({ where: { id: { in: toDelete } } })
  console.log(`Deleted ${res.count} rows.`)
  for (const s of seasons.filter((x) => repairedSeasons.has(x.id))) {
    await updateStandings(s.id, Math.max(1, s.currentWeek ?? 1))
    console.log(`  standings recomputed: season ${s.id}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
