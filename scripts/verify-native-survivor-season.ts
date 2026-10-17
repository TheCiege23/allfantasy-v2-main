/** Opt-in canonical creation, score bridge, and atomic release proof on a recognized test DB. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { getEffectiveLeagueRosterTemplate } from '../lib/league/getEffectiveLeagueRosterTemplate'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { reconcileSurvivorDraftPlan } from '../lib/survivor/reconcileSurvivorDraftPlan'
import { withSurvivorSetupTransaction } from '../lib/survivor/survivorSetupTransaction'
import { readSurvivorFullSeasonPlan } from '../lib/survivor/survivorFullSeasonPlan'
import { sumRedraftStartersFantasy } from '../lib/survivor/gameStateMachine'
import { resolveElimination } from '../lib/survivor/survivorEliminationService'
import { isRosterCurrentlyEliminated } from '../lib/survivor/SurvivorRosterState'
import { readWeekGames } from '../lib/redraft/weekGames'
import { resolveDailySportWeekWindow } from '../lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '../lib/sports-data/easternGameDay'
import { nbaTeamKey } from '../lib/roster-lineup-engine/lineupLockService'

const prefix = `nss-${randomUUID().slice(0, 8)}`
const users = [`${prefix}-host`, `${prefix}-member`]
const leagues: string[] = []
const scoreIds: string[] = []
const gameStatIds: string[] = []
const gameIds: string[] = []
async function cleanup() {
  for (const leagueId of leagues) {
    await prisma.survivorVote.deleteMany({ where: { leagueId } })
    await prisma.survivorTribalCouncil.deleteMany({ where: { leagueId } })
    await prisma.survivorTribeMember.deleteMany({ where: { tribe: { leagueId } } })
    await prisma.survivorAuditEntry.deleteMany({ where: { leagueId } })
    await prisma.survivorLeagueConfig.deleteMany({ where: { leagueId } })
    await prisma.league.delete({ where: { id: leagueId } })
  }
  await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: scoreIds } } })
  await prisma.playerGameStat.deleteMany({ where: { id: { in: gameStatIds } } })
  await prisma.sportsGame.deleteMany({ where: { id: { in: gameIds } } })
  await prisma.appUser.deleteMany({ where: { id: { in: users } } })
}

async function main() {
  if (!process.argv.includes('--db')) { console.log('Opt in with --db and a recognized test DATABASE_URL.'); return }
  const identity = createRequire(import.meta.url)('./db-target-identity.cjs')
  assert.equal(identity.identifyTarget(process.env.DATABASE_URL).kind, 'safe', 'A recognized non-production DB is required; production overrides are not accepted')
  await prisma.appUser.createMany({ data: users.map(id => ({ id, username: id, email: `${id}@example.invalid`, displayName: id.endsWith('host') ? 'Season Test Host' : 'Season Test Manager', passwordHash: bcrypt.hashSync('NativePreview123!', 10), emailVerified: new Date() })) })
  let retain = false
  try {
    for (const sport of ['NBA', 'NHL'] as const) {
      const body = { concept: 'survivor', sport, teamCount: 16, draftType: 'snake', scoringPreset: sport.toLowerCase() + '_points', leagueName: `${sport} Survivor Season Test`, timezone: 'America/New_York' }
      const engine = runPresetEngine({ ...body, commissionerId: users[0] })
      const created = await prisma.$transaction(tx => createCanonicalLeagueInTransaction(tx, users[0], body, engine), { timeout: 60_000 })
      const leagueId = created.leagueId; leagues.push(leagueId)
      const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
      let plan = readSurvivorFullSeasonPlan(league.settings)!
      assert.ok(plan); assert.equal(plan.endWeek, sport === 'NBA' ? 25 : 28)
      assert.equal(league.leagueVariant, 'survivor'); assert.equal(league.survivorMode, true); assert.equal(league.playoffTeams, 0)
      const teams = await prisma.leagueTeam.findMany({ where: { leagueId } })
      assert.equal(teams.length, 16); assert.ok(teams.every(team => !team.claimedByUserId), 'Non-playing host must not consume a draft seat')
      const effective = await getEffectiveLeagueRosterTemplate(leagueId)
      assert.equal(effective.hasPersistedRosterSchema, true, 'Canonical creation must pass roster readiness')
      assert.equal(effective.template.slots.reduce((sum, slot) => sum + slot.starterCount + slot.benchCount, 0), league.rosterSize)
      assert.ok(!effective.starterEligiblePositions.has('QB'))
      const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
      assert.equal(draft.rounds, league.rosterSize)
      const season = await prisma.redraftSeason.create({ data: { leagueId, sport, season: plan.season, currentWeek: plan.startWeek, totalWeeks: plan.endWeek, playoffStartWeek: plan.endWeek + 1, status: 'active' } })
      await prisma.survivorGameState.create({ data: { leagueId, phase: 'pre_draft', currentWeek: 0 } })
      await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed', completedAt: new Date('2026-10-25T12:00:00Z') } })
      await withSurvivorSetupTransaction(leagueId, db => reconcileSurvivorDraftPlan(db, leagueId, draft.id))
      plan = readSurvivorFullSeasonPlan((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).settings)!
      assert.ok(plan.startWeek > 1, 'A delayed completed draft must not backdate play')
      assert.equal((await prisma.redraftSeason.findUniqueOrThrow({ where: { id: season.id } })).currentWeek, plan.startWeek)
      await prisma.draftSession.update({ where: { id: draft.id }, data: { completedAt: new Date('2027-03-01T12:00:00Z') } })
      await withSurvivorSetupTransaction(leagueId, db => reconcileSurvivorDraftPlan(db, leagueId, draft.id))
      assert.equal(readSurvivorFullSeasonPlan((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).settings)!.startWeek, plan.startWeek, 'Retries preserve the committed draft calendar')
      const generic = await prisma.roster.findUniqueOrThrow({ where: { id: teams[0].externalId } })
      const actual = await prisma.redraftRoster.create({ data: { seasonId: season.id, leagueId, ownerId: users[1], ownerName: 'Season Test Manager' } })
      await prisma.roster.update({ where: { id: generic.id }, data: { platformUserId: users[1], redraftRosterId: actual.id } })
      await prisma.leagueTeam.update({ where: { id: teams[0].id }, data: { claimedByUserId: users[1], platformUserId: users[1], isOrphan: false, teamName: 'Season Test Team', ownerName: 'Season Test Manager' } })
      await prisma.survivorPlayer.create({ data: { leagueId, userId: users[1], displayName: 'Season Test Manager', redraftRosterId: generic.id } })
      assert.deepEqual(await sumRedraftStartersFantasy(generic.id, plan.startWeek, season), { pts: 0, allFinalized: false }, 'Empty roster is never finalized')
      const starter = `${prefix}-${sport}-starter`, bench = `${prefix}-${sport}-bench`
      scoreIds.push(starter, bench)
      const position = sport === 'NBA' ? 'PG' : 'C'
      const nbaWindow = sport === 'NBA' ? resolveDailySportWeekWindow('NBA', plan.season, plan.startWeek) : null
      let nbaGame = nbaWindow ? (await readWeekGames(prisma, { sport: 'NBA', season: plan.season, week: plan.startWeek, seasonType: 'regular', dateWindow: nbaWindow }))[0] : null
      if (nbaWindow && !nbaGame) {
        const id = `${prefix}-nba-rehearsal-game`
        gameIds.push(id)
        await prisma.sportsGame.create({ data: {
          id, sport: 'NBA', externalId: id, homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks',
          season: plan.season, week: plan.startWeek, seasonType: 'regular', source: 'thesportsdb', status: 'final',
          startTime: new Date(nbaWindow.start.getTime() + 18 * 60 * 60 * 1000), expiresAt: new Date(nbaWindow.end.getTime() + 86_400_000),
        } })
        nbaGame = (await readWeekGames(prisma, { sport: 'NBA', season: plan.season, week: plan.startWeek, seasonType: 'regular', dateWindow: nbaWindow }))[0] ?? null
      }
      if (sport === 'NBA') assert.ok(nbaGame?.startTime, 'NBA rehearsal requires a real scheduled game in the cloned week')
      const starterTeam = sport === 'NBA' ? nbaTeamKey(nbaGame!.homeTeam) : null
      await prisma.redraftRosterPlayer.createMany({ data: [{ playerId: starter, slotType: 'bench' }, { playerId: bench, slotType: position }].map(p => ({ ...p, rosterId: actual.id, playerName: p.playerId, position, sport, team: starterTeam })) })
      await prisma.afRosterLineupAssignment.createMany({ data: [{ playerId: starter, section: 'starters' }, { playerId: bench, section: 'ir' }].map(p => ({ ...p, leagueId, rosterId: generic.id, season: plan.season, week: plan.startWeek })) })
      const key = sport === 'NBA' ? 'pts' : 'g'
      const settings = league.settings as Record<string, unknown>
      await prisma.league.update({ where: { id: leagueId }, data: { settings: { ...settings, sportConfig: { categoryPoints: { [key]: 2 } } } } })
      await prisma.playerWeeklyScore.createMany({ data: [{ playerId: starter, stats: { [key]: 7 }, fantasyPts: 999, isFinalized: true }, { playerId: bench, stats: { [key]: 100 }, fantasyPts: 999, isFinalized: true }].map(p => ({ ...p, sport, week: plan.startWeek, season: plan.season })) })
      if (sport === 'NBA') {
        const statId = `${prefix}-nba-game-stat`
        gameStatIds.push(statId)
        await prisma.playerGameStat.create({ data: {
          id: statId, playerId: starter, gameId: statId, season: plan.season, weekOrRound: plan.startWeek,
          statPayload: { pts: 7 }, normalizedStatMap: { pts: 7 }, sportType: 'NBA',
          team: starterTeam, opponent: nbaTeamKey(nbaGame!.awayTeam), gameDate: easternCalendarDay(nbaGame!.startTime!),
          source: 'isolated_rehearsal',
        } })
      }
      assert.deepEqual(await sumRedraftStartersFantasy(generic.id, plan.startWeek, season), { pts: 14, allFinalized: true }, 'Saved weekly lineup and custom scoring must win over current slots and fantasyPts')
      await prisma.playerWeeklyScore.update({ where: { playerId_week_season_sport: { playerId: starter, sport, week: plan.startWeek, season: plan.season } }, data: { isFinalized: false } })
      assert.equal((await sumRedraftStartersFantasy(generic.id, plan.startWeek, season)).allFinalized, false)
      await prisma.roster.update({ where: { id: generic.id }, data: { playerData: { players: [starter, bench], starters: [starter], bench: [bench], lineup_sections: { starters: [starter], bench: [bench] }, foundation: { verified: true } } } })
      await prisma.survivorGameState.update({ where: { leagueId }, data: { phase: 'pre_merge', currentWeek: plan.startWeek, activePlayerCount: 1 } })
      const config = await prisma.survivorLeagueConfig.create({ data: { leagueId } })
      const council = await prisma.survivorTribalCouncil.create({ data: { leagueId, configId: config.id, week: plan.startWeek, phase: 'pre_merge', voteDeadlineAt: new Date(), status: 'closed', eliminatedUserId: users[1], eliminatedRosterId: generic.id } })
      assert.equal(await isRosterCurrentlyEliminated(leagueId, generic.id), false, 'Private tally must not eliminate a manager')
      assert.equal((await resolveElimination(leagueId, council.id)).ok, false, 'Unrevealed council must not release rosters')
      await prisma.survivorTribalCouncil.update({ where: { id: council.id }, data: { isRevealed: true, status: 'revealed' } })
      await prisma.waiverClaim.create({ data: { leagueId, rosterId: generic.id, addPlayerId: `${prefix}-free-agent` } })
      const results = await Promise.all([resolveElimination(leagueId, council.id, users[0]), resolveElimination(leagueId, council.id, users[0])])
      assert.ok(results.every(r => r.ok && !r.pendingRelease)); assert.equal(results.filter(r => r.ok && !r.alreadyResolved).length, 1)
      assert.equal(await prisma.redraftRosterPlayer.count({ where: { rosterId: actual.id, droppedAt: null } }), 0)
      assert.equal((await prisma.redraftRoster.findUniqueOrThrow({ where: { id: actual.id } })).isEliminated, true)
      assert.equal(await prisma.waiverClaim.count({ where: { leagueId, status: 'pending' } }), 0)
      assert.equal(await prisma.survivorAuditEntry.count({ where: { leagueId, action: 'roster_released' } }), 1)
      assert.equal(await isRosterCurrentlyEliminated(leagueId, actual.id), true)
      assert.deepEqual((await prisma.roster.findUniqueOrThrow({ where: { id: generic.id } })).playerData, { players: [], starters: [], bench: [], lineup_sections: { starters: [], bench: [] }, foundation: { verified: true } })
      assert.ok(results.every(result => result.ok && result.outcome === 'exile_island'), 'Default Survivor elimination enters Exile after releasing the main roster')
      assert.equal((await prisma.survivorPlayer.findUniqueOrThrow({ where: { leagueId_userId: { leagueId, userId: users[1] } } })).playerState, 'exile')
      assert.equal(await prisma.survivorChatChannel.count({ where: { leagueId, channelType: 'exile', memberUserIds: { has: users[1] } } }), 1)
      assert.equal((await prisma.survivorGameState.findUniqueOrThrow({ where: { leagueId } })).activePlayerCount, 0)
      assert.ok((await resolveElimination(leagueId, council.id)).ok)
      assert.equal(await prisma.survivorAuditEntry.count({ where: { leagueId, action: 'roster_released' } }), 1)
      console.log(`PASS ${sport}: delayed-draft reconciliation, canonical creation, full calendar, host seats, roster bridge, custom weekly scoring, missing-final refusal, atomic Exile entry and roster release, waiver cancellation`)
    }
    const preview = process.argv.indexOf('--preview-manifest')
    if (preview >= 0 && process.argv[preview + 1]) { await writeFile(process.argv[preview + 1], JSON.stringify({ prefix, users, leagues })); retain = true; console.log('Preview fixtures retained for browser checks; clean them after verification.') }
  } finally { if (!retain) { await cleanup(); console.log('Cleaned up only this run’s fixtures.') } }
}
main().catch(error => { console.error(String(error?.stack ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]')); process.exitCode = 1 }).finally(() => prisma.$disconnect())
