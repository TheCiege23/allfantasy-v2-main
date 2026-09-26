/** Real service/DB smoke. Explicit known test DB only; deletes only tracked synthetic rows. */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { applyDefaultNflScoringOnCreate } from '../lib/nfl-scoring'
import { syncCompletedDraftToRedraftSeason } from '../lib/redraft/finalizeDraftToRedraftSeason'
import { createNextLeagueDraft } from '../lib/live-draft-engine/createNextLeagueDraft'
import { ensureNextRedraftSeasonShell } from '../lib/redraft/offseason/ensureNextRedraftSeasonShell'
import { updateStandings } from '../lib/redraft/standingsEngine'
import { updateMatchupScores, calculateScoreFromSportConfig } from '../lib/redraft/scoringEngine'
import { configureEventInfrastructure, InMemoryOutboxStore, resetPlatformEvents } from '../lib/events'

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
  resetPlatformEvents()
  const marker = 'lifecycle-smoke-' + randomUUID()
  const userIds: string[] = []
  const leagueIds: string[] = []
  const results: unknown[] = []
  const scorePlayerIds: string[] = []
  try {
    for (let i = 0; i < 8; i++) {
      const user = await prisma.appUser.create({ data: { username: marker + '-' + i, email: marker + '-' + i + '@example.invalid' } })
      userIds.push(user.id)
    }
    for (const concept of ['redraft', 'dynasty', 'keeper']) {
      const teamCount = concept === 'redraft' ? 2 : 8
      const validation = validateCreatePayload({ concept, sport: 'NFL', teamCount, draftType: 'snake', scoringPreset: 'fb_ppr', leagueName: marker + '-' + concept, timezone: 'America/Chicago', tradeReviewMode: 'none', conceptSetup: { medianGame: true,
        ...(concept === 'dynasty' ? { startupRosterDepth: 10, benchCount: 6, irCount: 0, taxiSlots: 2, regularSeasonWeeks: 12, playoffTeamCount: 2, waiverTypeRecommended: 'rolling', faabBudget: 0 } : {}),
        ...(concept === 'keeper' ? { keeper_max_keepers: 2, keeperMaxKeepers: 2 } : {}),
      } })
      if (!validation.ok) throw new Error('INVALID_FIXTURE_' + concept)
      const body = validation.data
      const engine = runPresetEngine({ ...body, commissionerId: userIds[0] })
      const created = await prisma.$transaction(tx => createCanonicalLeagueInTransaction(tx, userIds[0], body, engine), { timeout: 120000 })
      leagueIds.push(created.leagueId)
      await createDefaultLeagueRosterConfig(created.leagueId, 'NFL', concept)
      await applyDefaultNflScoringOnCreate(created.leagueId, 'af_ppr')
      const generic = (await prisma.roster.findMany({ where: { leagueId: created.leagueId }, orderBy: { id: 'asc' } })).sort((a, b) => Number(b.platformUserId === userIds[0]) - Number(a.platformUserId === userIds[0]))
      const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId: created.leagueId } })
      if (generic.length !== teamCount) throw new Error('GENERIC_ROSTERS')
      for (let i = 0; i < generic.length; i++) {
        const roster = generic[i]
        const team = await prisma.leagueTeam.findFirst({ where: { leagueId: created.leagueId, platformUserId: roster.platformUserId } })
        if (team) await prisma.leagueTeam.update({ where: { id: team.id }, data: { platformUserId: userIds[i], claimedByUserId: userIds[i] } })
        await prisma.roster.update({ where: { id: roster.id }, data: { platformUserId: userIds[i], playerData: { starters: [marker + '-player-' + (i + 1)] } } })
      }
      const picks = Array.from({ length: draft.rounds * teamCount }, (_, i) => ({ sessionId: draft.id, overall: i + 1, round: Math.floor(i / teamCount) + 1, slot: i % teamCount + 1, rosterId: generic[i % teamCount].id, playerId: marker + '-' + concept + '-id-' + i, playerName: marker + '-player-' + (i + 1), position: i < teamCount ? 'QB' : 'WR', team: 'NYJ', sportType: 'NFL', source: 'smoke_fixture' }))
      await prisma.draftPick.createMany({ data: picks })
      await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })
      const first = await syncCompletedDraftToRedraftSeason(created.leagueId)
      const second = await syncCompletedDraftToRedraftSeason(created.leagueId)
      const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId: created.leagueId } })
      const rosters = await prisma.redraftRoster.findMany({ where: { seasonId: season.id } })
      const players = await prisma.redraftRosterPlayer.count({ where: { rosterId: { in: rosters.map(r => r.id) } } })
      const matchups = await prisma.redraftMatchup.count({ where: { seasonId: season.id } })
      const receptionScore = await calculateScoreFromSportConfig(created.leagueId, 'smoke-receiver', 1, { rec: 2 }, 'WR')
      if (first.skipped || rosters.length !== teamCount || players !== picks.length || second.redraftPlayersCreated !== 0 || matchups < 1 || !season.medianGame || receptionScore !== 2) throw new Error('FINALIZATION_PARITY_' + concept)
      if (concept === 'dynasty' && (season.totalWeeks !== 13 || season.playoffStartWeek !== 13)) throw new Error('DYNASTY_SEASON_PARITY')
      const weekGames = await prisma.redraftMatchup.findMany({ where: { seasonId: season.id, week: 1 } })
      for (let i = 0; i < teamCount; i++) {
        const playerId = marker + '-' + concept + '-id-' + i
        scorePlayerIds.push(playerId)
        await prisma.playerWeeklyScore.create({ data: { playerId, sport: 'NFL', week: 1, season: season.season, stats: { pass_td: i + 1 }, isFinalized: true } })
      }
      for (const game of weekGames) await updateMatchupScores(game.id)
      await updateStandings(season.id, 1)
      await updateStandings(season.id, 1)
      const standings = await prisma.redraftRoster.findMany({ where: { seasonId: season.id } })
      const finalizedGames = await prisma.redraftMatchup.findMany({ where: { seasonId: season.id, week: 1 } })
      const median = 2 * (teamCount + 1)
      for (const roster of standings) {
        const index = userIds.indexOf(roster.ownerId)
        const points = 4 * (index + 1)
        const game = finalizedGames.find(g => g.homeRosterId === roster.id || g.awayRosterId === roster.id)
        if (index < 0 || !game || game.status !== 'final') throw new Error('WEEK_NOT_FINAL_' + concept)
        const opponentPoints = game.homeRosterId === roster.id ? game.awayScore : game.homeScore
        const expectedWins = Number(points > Number(opponentPoints)) + Number(points > median)
        if (roster.pointsFor !== points || roster.wins !== expectedWins || roster.losses !== 2 - expectedWins || game.medianScore !== median) throw new Error('MEDIAN_STANDINGS_PARITY_' + concept)
      }
      await prisma.redraftSeason.update({ where: { id: season.id }, data: { status: 'complete' } })
      if (concept === 'dynasty') {
        await prisma.futureDraftPick.create({ data: { leagueId: created.leagueId, pickSeason: season.season + 1, round: 1, originalRosterId: generic[0].id, currentOwnerId: generic[1].id, traded: true } })
      }
      if (concept === 'keeper') {
        const shell = await ensureNextRedraftSeasonShell(created.leagueId, season.id)
        if (!shell) throw new Error('KEEPER_SHELL')
        const owner = await prisma.redraftRoster.findFirstOrThrow({ where: { seasonId: shell.id, ownerId: userIds[0] } })
        await prisma.keeperRecord.create({ data: { leagueId: created.leagueId, seasonId: shell.id, rosterId: owner.id, playerId: picks[0].playerId, playerName: picks[0].playerName, position: 'QB', sport: 'NFL', originalDraftYear: season.season, costRound: 2, status: 'locked' } })
      }
      const renewal = await createNextLeagueDraft(created.leagueId, userIds[0])
      if (!renewal.ok) throw new Error('RENEWAL_' + concept + '_' + renewal.code)
      const nextDraft = await prisma.draftSession.findUniqueOrThrow({ where: { id: renewal.sessionId } })
      if (renewal.season !== season.season + 1 || nextDraft.status !== 'pre_draft') throw new Error('RENEWAL_SEASON')
      if (concept === 'dynasty' && (renewal.playersCarried !== players || renewal.kind !== 'rookie' || renewal.tradedPicksApplied !== 1 || nextDraft.playerPool !== 'rookies_only')) throw new Error('DYNASTY_RENEWAL_PARITY')
      if (concept === 'keeper' && (renewal.keepersPlaced !== 1 || !Array.isArray(nextDraft.keeperSelections) || nextDraft.keeperSelections.length !== 1)) throw new Error('KEEPER_RENEWAL_PARITY')
      const repeatedRenewal = await createNextLeagueDraft(created.leagueId, userIds[0])
      if (repeatedRenewal.ok || repeatedRenewal.code !== 'DRAFT_STILL_OPEN') throw new Error('DUPLICATE_RENEWAL')
      results.push({ renewalVerified: true, renewalKind: renewal.kind, playersCarried: renewal.playersCarried, keepersPlaced: renewal.keepersPlaced, tradedPicksApplied: renewal.tradedPicksApplied, weeklyScoringVerified: true, medianStandingsVerified: true, concept, draftRounds: draft.rounds, rosters: rosters.length, players, matchups, totalWeeks: season.totalWeeks, medianGame: season.medianGame, repeatAddedPlayers: second.redraftPlayersCreated, twoReceptionsScore: receptionScore })
    }
  } finally {
    if (scorePlayerIds.length) await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: scorePlayerIds } } })
    if (leagueIds.length) await prisma.league.deleteMany({ where: { id: { in: leagueIds } } })
    if (userIds.length) await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    const remainingLeagues = await prisma.league.count({ where: { id: { in: leagueIds } } })
    const remainingUsers = await prisma.appUser.count({ where: { id: { in: userIds } } })
    const remainingScores = await prisma.playerWeeklyScore.count({ where: { playerId: { in: scorePlayerIds } } })
    if (remainingLeagues || remainingUsers || remainingScores) throw new Error('SYNTHETIC_CLEANUP_INCOMPLETE')
    console.log(JSON.stringify({ target: 'known test database', results, cleanup: { remainingLeagues, remainingUsers, remainingScores } }, null, 2))
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error('Lifecycle smoke failed:', error.code ?? error.message?.slice(0, 160)); process.exitCode = 1 })
