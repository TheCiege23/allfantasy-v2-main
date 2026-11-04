import { readFile } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { upsertChimmyStagingLeagueFixture } from '@/lib/domain/stagingLeagueFixture'
import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

const QA_LEAGUE = 'chimmy-qa-sleeper-history'
const USER = 'bracket-qa-admin'
const EXPECTED: Record<number, number> = { 2021: 6, 2022: 9, 2023: 13, 2024: 18, 2025: 24 }
type Row = { leagueId: string; seasonYear: number; week: number; matchupId: number; rosterId: string;
  pointsFor: number; pointsAgainst: number }
const weekKey = (r: Row) => [r.leagueId, r.seasonYear, r.week].join(':')
const rowKey = (r: Row) => weekKey(r) + ':' + r.rosterId

function validatedRows(raw: unknown): Row[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 5000) throw new Error('Invalid staging matchup manifest')
  const rows: Row[] = raw.map(({ leagueId, seasonYear, week, matchupId, rosterId, pointsFor, pointsAgainst }) => {
    if (typeof leagueId !== 'string' || !/^\d+$/.test(leagueId) || !Number.isInteger(seasonYear) || !(seasonYear in EXPECTED) ||
        ![1, 8, 14].includes(week) || !Number.isSafeInteger(matchupId) || typeof rosterId !== 'string' || !/^[1-9]\d*$/.test(rosterId) ||
        !Number.isFinite(pointsFor) || !Number.isFinite(pointsAgainst)) throw new Error('Invalid matchup row in staging manifest')
    return { leagueId, seasonYear, week, matchupId, rosterId, pointsFor, pointsAgainst }
  })
  const weeks = new Map<string, Row>()
  const pairs = new Map<string, Row[]>()
  for (const row of rows) {
    weeks.set(weekKey(row), row)
    const key = weekKey(row) + ':' + row.matchupId
    const pair = pairs.get(key) ?? []
    pair.push(row)
    pairs.set(key, pair)
  }
  if (new Set(rows.map(rowKey)).size !== rows.length || new Set(rows.map((r) => r.leagueId)).size !== 24 ||
      Object.entries(EXPECTED).some(([year, count]) => [...weeks.values()].filter((r) => r.seasonYear === Number(year)).length !== count) ||
      [...pairs.values()].some(([a, b, ...rest]) => !a || !b || rest.length || a.rosterId === b.rosterId ||
        a.pointsFor !== b.pointsAgainst || a.pointsAgainst !== b.pointsFor || (a.pointsFor === 0 && b.pointsFor === 0))) {
    throw new Error('Manifest does not match the 70 reviewed league-weeks or contains incomplete pairs')
  }
  return rows
}

async function main() {
  if (process.env.CHIMMY_STAGING_PROJECT_ID !== 'b3cd0239-9cb1-4c22-9d76-533d91d26f36') throw new Error('Isolated bracket staging required')
  const account = await prisma.appUser.findFirst({ where: { id: USER }, select: { email: true } })
  if (account?.email !== 'bracket-admin@staging.invalid') throw new Error('Wrong staging account')
  const path = process.argv[2]
  if (!path) throw new Error('Supply the reviewed Sleeper manifest')
  const rows = validatedRows(JSON.parse(await readFile(path, 'utf8')))
  const inserted = await prisma.$transaction(async (tx) => {
    const result = await tx.weeklyMatchup.createMany({
      data: rows.map((row) => ({ ...row, win: row.pointsFor > row.pointsAgainst ? 1 : 0 })), skipDuplicates: true,
    })
    const stored = await tx.weeklyMatchup.findMany({ where: { leagueId: { in: [...new Set(rows.map((r) => r.leagueId))] },
      seasonYear: { in: [2021, 2022, 2023, 2024, 2025] }, week: { in: [1, 8, 14] } } })
    const byKey = new Map(stored.map((row) => [rowKey(row), row]))
    if (rows.some((row) => {
      const read = byKey.get(rowKey(row))
      return !read || read.matchupId !== row.matchupId || read.pointsFor !== row.pointsFor || read.pointsAgainst !== row.pointsAgainst
    })) throw new Error('A stored staging row conflicts with the verified result. Transaction rolled back.')
    return result.count
  }, { isolationLevel: 'Serializable', timeout: 60_000 })
  console.log(JSON.stringify({ leagueWeeks: 70, providerLeagues: 24, verifiedTeamRows: rows.length, inserted }))
  const example = rows.find((row) => row.seasonYear === 2025 && row.week === 1)!
  const league = await prisma.$transaction((tx) => upsertChimmyStagingLeagueFixture(tx, {
    id: QA_LEAGUE, tenantId: 'chimmy-release-3164-rules-fixture-tenant', userId: USER,
    platform: 'sleeper', platformLeagueId: QA_LEAGUE, name: 'Chimmy QA Sleeper archive', sport: 'NFL', season: 2026,
  }, {}))
  const link = await prisma.leagueDynastySeason.create({ data: {
    leagueId: league.id, season: example.seasonYear, platformLeagueId: example.leagueId, provider: 'sleeper',
  } })
  try {
    const query = { season: example.seasonYear, week: example.week, limit: 20 }
    const answer = await executeChimmyTool('get_fantasy_matchup_history', query, { leagueId: league.id, userId: USER })
    const denied = await executeChimmyTool('get_fantasy_matchup_history', query, { leagueId: league.id, userId: 'chimmy-qa-nonmember' })
    const scores = answer.includes(example.pointsFor.toFixed(2)) && answer.includes(example.pointsAgainst.toFixed(2))
    if (!scores || !answer.includes('stored Sleeper matchup pairs for the linked season') ||
        denied.includes('stored Sleeper matchup pairs for the linked season')) throw new Error('Chimmy did not return the expected authorized stored scores')
    console.log(JSON.stringify({ chimmyTool: 'get_fantasy_matchup_history', season: example.seasonYear,
      week: example.week, storedScoresVerified: true, nonmemberWithheld: true }))
  } finally {
    await prisma.leagueDynastySeason.deleteMany({ where: { id: link.id, leagueId: league.id, provider: 'sleeper' } })
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Staging Sleeper backfill failed'); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
