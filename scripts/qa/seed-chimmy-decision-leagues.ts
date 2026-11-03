import { prisma } from '@/lib/prisma'
import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'

const PROJECT = 'b3cd0239-9cb1-4c22-9d76-533d91d26f36'
const USER = 'bracket-qa-admin'
const TENANT = 'chimmy-release-3164-rules-fixture-tenant'
const categories = { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'each' }
const fixtures = [
  { kind: 'points', sport: 'NFL', position: 'WR', team: ['BUF', 'NYJ', 'NE', 'MIA'], slot: 'WR', settings: { scoring_settings: { rec: 1, rec_yd: 0.1, rec_td: 6 } }, scoring: 'PPR' },
  { kind: 'categories', sport: 'NBA', position: 'PG', team: ['BOS', 'NYK', 'CHI', 'LAL'], slot: 'PG', settings: categories, scoring: 'categories' },
] as const
const names = ['Avery Lockhart', 'Casey Bellwood', 'Jordan Ashford', 'Morgan Westlake'] as const

async function main() {
  if (process.env.CHIMMY_STAGING_PROJECT_ID !== PROJECT) throw new Error('Isolated bracket staging required')
  const account = await prisma.appUser.findUnique({ where: { id: USER }, select: { email: true } })
  if (account?.email !== 'bracket-admin@staging.invalid') throw new Error('Wrong staging QA identity')
  for (const fixture of fixtures) {
    const leagueId = 'chimmy-3164-qa-' + fixture.kind
    const ids = names.map((_, i) => leagueId + '-player-' + i)
    const rosterIds = [leagueId + '-mine', leagueId + '-opponent']
    const owners = [USER, leagueId + '-manager']
    const teamNames = ['QA Harbor', 'QA Summit']
    await prisma.$transaction(async (tx) => {
      const existing = await tx.league.findUnique({ where: { id: leagueId }, select: { userId: true, tenantId: true } })
      if (existing && (existing.userId !== USER || existing.tenantId !== TENANT)) throw new Error('Fixture ownership mismatch')
      const rules = { settings: fixture.settings, scoring: fixture.scoring, starters: [fixture.slot], rosterSize: 3, irSlots: 1 }
      await tx.league.upsert({ where: { id: leagueId }, update: rules, create: {
        id: leagueId, tenantId: TENANT, userId: USER, platform: 'allfantasy', platformLeagueId: leagueId,
        name: 'Chimmy QA ' + fixture.kind, sport: fixture.sport, season: 2026, leagueType: 'redraft', ...rules,
      } })
      for (let i = 0; i < names.length; i++) {
        const player = { name: names[i]!, sport: fixture.sport, team: fixture.team[i]!, position: fixture.position,
          stats: {}, projections: {}, injuryStatus: i === 1 ? 'Out' : null, dataSource: 'chimmy_staging_qa' }
        await tx.sportsPlayerRecord.upsert({ where: { id: ids[i]! }, update: player, create: { id: ids[i]!, ...player } })
      }
      if (fixture.kind === 'points') {
        const now = new Date()
        const expiry = new Date(now.getTime() + 86_400_000)
        const game = { homeTeam: 'BUF', awayTeam: 'BAL', status: 'in_progress', startTime: new Date(now.getTime() - 60_000),
          season: 2026, week: 9, fetchedAt: now, expiresAt: expiry }
        const gameKey = { sport: 'NFL', externalId: leagueId + '-kickoff', source: 'chimmy_staging_qa' }
        await tx.sportsGame.upsert({ where: { sport_externalId_source: gameKey }, update: game, create: { ...gameKey, ...game } })
        for (let i = 0; i < ids.length; i++) {
          const key = { playerId: ids[i]!, sport: 'NFL', season: '2026', week: 9,
            scoringPresetId: 'ppr', source: 'chimmy_staging_qa' }
          const projection = { projectedPoints: 10 + i * 2, fetchedAt: now, expiresAt: expiry,
            stats: { name: names[i]!, position: fixture.position, team: fixture.team[i]!, stats: { rec: 5, rec_yd: 50 + i * 20 } } }
          await tx.fantasyProjection.upsert({ where: { uniq_fantasy_projection_player_week_scoring_source: key },
            update: projection, create: { ...key, ...projection } })
        }
      }
      for (let i = 0; i < rosterIds.length; i++) {
        const rosterId = rosterIds[i]!
        const players = i === 0 ? ids.slice(0, 3) : ids.slice(3)
        const playerData = { players, starters: [players[0]], reserve: i === 0 ? [players[1]] : [] }
        await tx.roster.upsert({ where: { id: rosterId }, update: { playerData },
          create: { id: rosterId, leagueId, platformUserId: owners[i]!, playerData } })
        const team = { teamName: teamNames[i]!, ownerName: owners[i]!, platformUserId: owners[i]!,
          claimedByUserId: i === 0 ? USER : null }
        await tx.leagueTeam.upsert({ where: { id: rosterId + '-team' }, update: team,
          create: { id: rosterId + '-team', leagueId, externalId: String(i + 1), ...team } })
      }
    })
    if (fixture.kind === 'categories' && nativeCategoryScoringContext(fixture.settings, fixture.sport)?.categories.length !== 9) {
      throw new Error('Fixture does not resolve to nine categories')
    }
    const context = { leagueId, userId: USER }
    const roster = await executeChimmyTool('get_my_roster', {}, context)
    const lineup = await executeChimmyTool('compare_start_options', { players: [names[1], names[2]] }, context)
    const locked = await executeChimmyTool('compare_start_options', { players: [names[0], names[2]] }, context)
    const trade = await executeChimmyTool('evaluate_trade', { give: [names[0]], get: [names[3]] }, context)
    const rules = await executeChimmyTool('get_selected_league_rules', {}, context)
    const ok = roster.includes(names[0]) && roster.includes(names[1]) && roster.includes(names[2]) &&
      lineup.includes('cannot start') && trade.includes('You give: Avery Lockhart') && trade.includes('You get: Morgan Westlake') &&
      trade.includes('NOT GRADED') &&
      (fixture.kind === 'points'
        ? locked.includes('already kicked off') && trade.includes('14.0 before, 16.0 after (+2.0)')
        : rules.includes('Verified league categories:') && rules.includes('nba_9cat') &&
          locked.includes('No complete current scoring-period schedule') && trade.includes('Starting lineup: not computed'))
    console.log(JSON.stringify({ leagueId, verified: ok, lineup, locked, trade }))
    if (!ok) process.exitCode = 1
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Fixture failed'); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
