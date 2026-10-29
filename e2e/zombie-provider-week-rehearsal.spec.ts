/** Replay recorded game lines through the real scoring/finalizer/Zombie services on CI's disposable database.
 * Player names, IDs, lines and complete week slates are recorded facts. Fixture ownership,
 * one-player lineups and the pre-existing Horde member are controlled test setup.
 */
import { createHash, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
import { ensureZombieSeasonActivated } from '../lib/zombie/activateNativeZombieLeague'
import { runWeeklyResolution } from '../lib/zombie/weeklyResolutionEngine'
import { syncPlayerWeeklyScoresForRedraftSeason, normalizeNflWeeklyStats } from '../lib/redraft/playerWeeklyScoreService'
import { recalculateMatchupsForSeasonWeek } from '../lib/redraft/scoringEngine'
import { finalizeRedraftWeek } from '../lib/redraft/weekFinalizer'
import { getZombieTradeRestriction } from '../lib/zombie/zombieTradePolicy'
import { handleZombieChimmyAction } from '../lib/zombie/chimmyActionHandler'
import { identityNameKey } from '../lib/redraft/rosterGameLogIdBridge'
import recorded from './fixtures/zombie-provider-week-2026.json'

async function signIn(page: Page, email: string, password: string, userId: string) {
  const csrfResponse = await page.request.get('/api/auth/csrf')
  if (!['127.0.0.1','localhost'].includes(new URL(csrfResponse.url()).hostname)) throw new Error('LOCAL_DISPOSABLE_SERVER_REQUIRED')
  const csrf = await csrfResponse.json()
  // Independent local browser fixtures must not share the production per-client sign-in budget.
  // Reserved benchmark addresses simulate distinct edge clients; real credentials, sessions,
  // account protections and the unmodified rate limiter are still exercised.
  const bytes=createHash('sha256').update(userId+':'+randomUUID()).digest()
  const fixtureIp='198.18.'+bytes[0]+'.'+bytes[1]
  const response = await page.request.post('/api/auth/callback/credentials?json=true', {
    headers:{'x-real-ip':fixtureIp,'x-forwarded-for':fixtureIp},
    form: { csrfToken: csrf.csrfToken, login: email, password, json: 'true' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  await expect.poll(async () => (await (await page.request.get('/api/auth/session')).json()).user?.id).toBe(userId)
}


test('recorded provider weeks score and settle NFL NBA NHL MLB @zombie-rehearsal', async ({ page }) => {
  test.setTimeout(1_800_000)
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('LOCAL_DISPOSABLE_DATABASE_REQUIRED')
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) throw new Error('SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
  const marker = 'zombie-provider-' + randomUUID().slice(0, 8)
  const userIds = Array.from({ length: 8 }, (_, i) => marker + '-u' + i)
  const leagueIds: string[] = []
  const password = randomUUID()
  try {
    await prisma.appUser.createMany({ data: userIds.map((id, i) => ({
      id, username: id, email: id + '@example.invalid', emailVerified: new Date(),
      displayName: 'Provider Manager ' + i, passwordHash: i === 0 ? bcrypt.hashSync(password, 6) : null,
    })) })
    await signIn(page, userIds[0] + '@example.invalid', password, userIds[0])
    for (const identity of recorded.identities) {
      await prisma.playerIdentityMap.upsert({ where: { id: identity.id }, update: {}, create: {
        ...identity, normalizedName: identityNameKey(identity.canonicalName),
      } })
    }
    for (const row of recorded.rows) {
      await prisma.playerGameStat.upsert({
        where: { playerId_sportType_gameId: { playerId: row.playerId, sportType: row.sportType, gameId: row.gameId } },
        update: {}, create: { ...row, gameDate: new Date(row.gameDate), statPayload: row.normalizedStatMap },
      })
    }
    for (const game of recorded.slate) {
      await prisma.sportsGame.upsert({
        where: { sport_externalId_source: { sport: game.sport, externalId: game.externalId, source: game.source } },
        update: {}, create: { ...game, startTime: new Date(game.startTime),
          fetchedAt: new Date(game.fetchedAt), expiresAt: new Date(game.expiresAt) },
      })
    }
    for (const cache of recorded.schedule) {
      await prisma.sportsDataCache.upsert({ where: { cacheKey: cache.cacheKey },
        update: { data: cache.data }, create: { ...cache, expiresAt: new Date('2099-01-01') } })
    }
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB']) {
      const preset = ({ NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points' } as Record<string, string>)[sport]
      const created = await page.request.post('/api/leagues', { data: {
        concept: 'zombie', sport, teamCount: 8, draftType: 'snake', scoringPreset: preset,
        leagueName: marker + ' ' + sport, timezone: 'America/New_York', conceptSetup: {},
      }, timeout: 240_000 })
      expect(created.ok(), await created.text()).toBeTruthy()
      const leagueId = String((await created.json()).league.id)
      leagueIds.push(leagueId)
      await prisma.league.update({ where: { id: leagueId }, data: { season: 2026 } })
      const rosters = await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } })
      expect(rosters).toHaveLength(8)
      // Keep the existing commissioner seat at index zero before assigning the other fixture managers.
      rosters.sort((a, b) => Number(b.platformUserId === userIds[0]) - Number(a.platformUserId === userIds[0]))
      const season = await prisma.redraftSeason.create({ data: {
        leagueId, sport, season: 2026, status: 'active', currentWeek: 1, totalWeeks: 2, playoffStartWeek: 3,
      } })
      const players = recorded.players.filter(p => p.sport === sport)
      expect(players).toHaveLength(8)
      const seasonRosters = []
      for (let i = 0; i < 8; i++) {
        const sr = await prisma.redraftRoster.create({ data: {
          seasonId: season.id, leagueId, ownerId: userIds[i], ownerName: 'Provider Manager ' + i,
          teamName: 'Provider Team ' + i,
        } })
        seasonRosters.push(sr)
        await prisma.leagueTeam.updateMany({
          where: { leagueId, OR: [{ externalId: rosters[i].id }, { platformUserId: rosters[i].platformUserId }] },
          data: { platformUserId: userIds[i], claimedByUserId: userIds[i], isOrphan: false },
        })
        rosters[i] = await prisma.roster.update({ where: { id: rosters[i].id },
          data: { platformUserId: userIds[i], redraftRosterId: sr.id } })
        const p = players[i]
        await prisma.redraftRosterPlayer.create({ data: {
          rosterId: sr.id, playerId: p.draft_id, playerName: p.name, position: p.position,
          team: p.team, sport, slotType: p.position, addedAt: new Date('2026-01-01'),
        } })
      }
      for (let week = 1; week <= 2; week++) {
        await prisma.redraftMatchup.createMany({ data: Array.from({ length: 4 }, (_, i) => ({
          seasonId: season.id, leagueId, week, homeRosterId: seasonRosters[i * 2].id,
          awayRosterId: seasonRosters[i * 2 + 1].id,
        })) })
      }
      const whisperers = sport === 'NFL' ? 1 : 2
      await prisma.zombieLeague.update({ where: { leagueId }, data: {
        whispererCount: whisperers, weeklyUpdateDay: null, weeklyUpdateHour: null,
        weeklyUpdateAutoPost: true, weeklyUpdateApproval: false,
      } })
      const activated = await ensureZombieSeasonActivated({ leagueId, redraftSeasonId: season.id })
      expect(activated.ok).toBe(true)
      const z = await prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId } })
      expect(await prisma.zombieCoWhisperer.count({ where: { zombieLeagueId: z.id } })).toBe(whisperers - 1)
      const pending = await runWeeklyResolution(z.id, 1)
      expect(pending.reason).toBe('matchups_incomplete')
      const before = await finalizeRedraftWeek({ seasonId: season.id, week: 1 }, {
        notifyResults: async () => {}, resolvePredictions: async () => {}, enqueueTankingScan: async () => {},
      })
      expect(before.finalized).toBe(false)
      expect(before.refusal).toBe('stat_coverage_below_floor')
      const sync = await syncPlayerWeeklyScoresForRedraftSeason({
        seasonId: season.id, week: 1, fetchNflWeekStats: async () => new Map(
          recorded.rows.filter(r => r.sportType === 'NFL').map(r =>
            [r.playerId, normalizeNflWeeklyStats(r.normalizedStatMap)]),
        ),
      })
      expect(sync.scoresUpserted, JSON.stringify(sync)).toBe(8)
      expect(sync.missingStatPlayerIds).toEqual([])
      if (sport !== 'NFL') expect(sync.gameLogIdsBridged).toBe(8)
      const scores = await prisma.playerWeeklyScore.findMany({
        where: { sport, season: 2026, week: 1, playerId: { in: players.map(p => p.draft_id) } },
      })
      expect(scores).toHaveLength(8)
      expect(scores.some(row => row.fantasyPts > 0)).toBe(true)
      expect(scores.every(row => !row.isFinalized)).toBe(true)
      await recalculateMatchupsForSeasonWeek(season.id, 1)
      const seal = await finalizeRedraftWeek({ seasonId: season.id, week: 1 }, {
        notifyResults: async () => {}, resolvePredictions: async () => {}, enqueueTankingScan: async () => {},
      })
      expect(seal.finalized, JSON.stringify(seal)).toBe(true)
      expect(seal.coverage).toBe(1)
      expect(seal.zeroRowsWritten).toBe(0)
      expect(seal.matchupsFinal).toBe(4)
      const matchups = await prisma.redraftMatchup.findMany({ where: { seasonId: season.id, week: 1 } })
      const scoreByRoster = new Map(seasonRosters.map((sr, i) => [sr.id, scores.find(s => s.playerId === players[i].draft_id)!.fantasyPts]))
      for (const m of matchups) {
        expect(m.homeScore).toBeCloseTo(scoreByRoster.get(m.homeRosterId)!, 2)
        expect(m.awayScore).toBeCloseTo(scoreByRoster.get(m.awayRosterId!)!, 2)
      }
      const teams = await prisma.zombieLeagueTeam.findMany({ where: { leagueId } })
      const rosterFor = (seasonRosterId: string) => rosters[seasonRosters.findIndex(r => r.id === seasonRosterId)]
      const teamFor = (seasonRosterId: string) => teams.find(t => t.rosterId === rosterFor(seasonRosterId).id)!
      // Select an actual unequal-score Survivor pairing, then seed its winner as an existing Horde member.
      // No provider score, stat, slate date or game status is changed to manufacture an infection.
      const threat = matchups.find(m => m.homeScore !== m.awayScore &&
        teamFor(m.homeRosterId).status === 'Survivor' && teamFor(m.awayRosterId!).status === 'Survivor')
      expect(threat, sport + ' needs an unequal Survivor pairing').toBeTruthy()
      const winner = threat!.homeScore > threat!.awayScore ? threat!.homeRosterId : threat!.awayRosterId!
      const victim = winner === threat!.homeRosterId ? threat!.awayRosterId! : threat!.homeRosterId
      await prisma.zombieLeagueTeam.update({ where: { id: teamFor(winner).id }, data: { status: 'Zombie' } })
      const primary = teams.find(t => t.status === 'Whisperer')!
      expect(await getZombieTradeRestriction(leagueId, [primary.rosterId])).toBe('whisperer_trade_blocked')
      const inventory = await handleZombieChimmyAction(leagueId, rosterFor(victim).platformUserId, '@chimmy inventory', 1)
      expect(inventory.ok).toBe(true)
      expect(inventory.privateMessage).toContain('Inventory')
      const heldWeapon = await prisma.zombieTeamItem.create({ data: {
        teamStatusId: teamFor(victim).id, zombieLeagueId: z.id, userId: rosterFor(victim).platformUserId,
        itemType: 'weapon_knife', itemLabel: 'Knife', acquiredAtWeek: 1, acquiredReason: 'rehearsal_fixture',
      } })
      const blockedWeapon = await handleZombieChimmyAction(leagueId, rosterFor(victim).platformUserId, '@chimmy use knife', 1)
      expect(blockedWeapon.ok).toBe(false)
      expect((await prisma.zombieTeamItem.findUniqueOrThrow({ where: { id: heldWeapon.id } })).isUsed).toBe(false)
      const whispererRecord = await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: z.id } })
      const blockedAmbush = await handleZombieChimmyAction(leagueId, whispererRecord.userId,
        '@chimmy ambush swap ' + (teamFor(victim).fantasyTeamName || teamFor(victim).displayName), 1)
      expect(blockedAmbush.ok).toBe(false)
      expect((await prisma.whispererRecord.findUniqueOrThrow({ where: { id: whispererRecord.id } })).ambushesRemaining).toBe(whispererRecord.ambushesRemaining)
      const late = await handleZombieChimmyAction(leagueId, rosterFor(victim).platformUserId, '@chimmy use serum', 1)
      expect(late.ok).toBe(false)
      const settled = await runWeeklyResolution(z.id, 1)
      expect(settled.resolution?.status).toBe('complete')
      expect(settled.resolution?.infectionCount).toBeGreaterThan(0)
      expect((await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: teamFor(victim).id } })).status).toBe('Zombie')
      expect(await getZombieTradeRestriction(leagueId, [rosterFor(victim).id])).toBe('zombie_trade_blocked')
      const victimScore = winner === threat!.homeRosterId ? threat!.awayScore : threat!.homeScore
      const infection = await prisma.zombieInfectionEvent.findFirstOrThrow({ where: {
        zombieLeagueId: z.id, week: 1, victimUserId: rosterFor(victim).platformUserId,
      } })
      expect(infection.winningsTransferred).toBeCloseTo(Math.max(0, victimScore), 2)
      const announcement = await prisma.zombieAnnouncement.findFirstOrThrow({ where: {
        zombieLeagueId: z.id, week: 1, type: 'weekly_update',
      } })
      expect(announcement.isPosted).toBe(true)
      expect(await prisma.leagueChatMessage.count({ where: { zombieWeeklyAnnouncementId: announcement.id } })).toBe(1)
      const ledger = await prisma.zombieWeeklyWinnings.findMany({ where: { leagueId, week: 1 }, orderBy: { rosterId: 'asc' } })
      expect(ledger).toHaveLength(8)
      const replay = await runWeeklyResolution(z.id, 1)
      expect(replay.resolution?.id).toBe(settled.resolution?.id)
      expect(await prisma.zombieWeeklyWinnings.findMany({ where: { leagueId, week: 1 }, orderBy: { rosterId: 'asc' } })).toEqual(ledger)
      expect(await prisma.leagueChatMessage.count({ where: { zombieWeeklyAnnouncementId: announcement.id } })).toBe(1)
      expect((await prisma.zombieLeague.findUniqueOrThrow({ where: { id: z.id } })).currentWeek).toBe(2)
      // Native inventory revival spends exactly the configured cost once, while held weapons stay with the team.
      const config = await prisma.zombieLeagueConfig.findUniqueOrThrow({ where: { leagueId } })
      await prisma.zombieTeamItem.createMany({ data: Array.from({ length: config.serumReviveCount }, () => ({
        teamStatusId: teamFor(victim).id, zombieLeagueId: z.id, userId: rosterFor(victim).platformUserId,
        itemType: 'serum_standard', itemLabel: 'Serum', acquiredAtWeek: 2, acquiredReason: 'rehearsal_fixture',
      })) })
      const revived = await handleZombieChimmyAction(leagueId, rosterFor(victim).platformUserId, '@chimmy revive', 2)
      expect(revived.ok, JSON.stringify(revived)).toBe(true)
      expect((await prisma.zombieLeagueTeam.findUniqueOrThrow({ where: { id: teamFor(victim).id } })).status).toBe('Survivor')
      const consumed = await prisma.zombieTeamItem.count({ where: { teamStatusId: teamFor(victim).id, usedEffect: 'revive', isUsed: true } })
      expect(consumed).toBe(config.serumReviveCount)
      expect((await handleZombieChimmyAction(leagueId, rosterFor(victim).platformUserId, '@chimmy revive', 2)).ok).toBe(false)
      expect(await prisma.zombieTeamItem.count({ where: { teamStatusId: teamFor(victim).id, usedEffect: 'revive', isUsed: true } })).toBe(consumed)
      expect((await prisma.zombieTeamItem.findUniqueOrThrow({ where: { id: heldWeapon.id } })).teamStatusId).toBe(teamFor(victim).id)
      console.log(sport + ' recorded-provider replay: ' + sync.cacheRowsRead + ' game rows, 8 scores, 4 final matchups, infection, winnings and one report')
    }
  } finally {
    // Weekly score rows are shared by player/sport/year, so remove only this replay's
    // recorded-player scores on the guarded disposable DB, including on failed attempts.
    await prisma.playerWeeklyScore.deleteMany({ where: {
      season: 2026, week: 1, OR: ['NFL', 'NBA', 'NHL', 'MLB'].map(sport => ({
        sport, playerId: { in: recorded.players.filter(p => p.sport === sport).map(p => p.draft_id) },
      })),
    } })
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } })
    await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
  }
})
