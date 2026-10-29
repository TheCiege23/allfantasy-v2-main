import assert from 'node:assert/strict'
/** Four-sport native Zombie rehearsal on the disposable CI database. Synthetic scores exercise settlement, not provider calibration. */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
import { syncCompletedDraftToRedraftSeason } from '../lib/redraft/finalizeDraftToRedraftSeason'
import { ensureZombieSeasonActivated } from '../lib/zombie/activateNativeZombieLeague'
import { getUniverseStandings } from '../lib/zombie/ZombieUniverseStandingsService'
import { refreshMovementProjections } from '../lib/zombie/ZombieUniverseProjectionService'
import { executePromotionRelegation, syncUniverseStats, buildUniverseWeeklyDigest } from '../lib/zombie/universeStatEngine'
import { previewZombieUniverseRenewal, renewZombieUniverse, previewStandaloneZombieRenewal, renewStandaloneZombieLeague } from '../lib/zombie/renewZombieUniverse'
import { runWeeklyResolution } from '../lib/zombie/weeklyResolutionEngine'

const SPORTS = [
  { sport: 'NFL', preset: 'fb_half_ppr', whisperers: 1 },
  { sport: 'NBA', preset: 'nba_points', whisperers: 2 },
  { sport: 'NHL', preset: 'nhl_points', whisperers: 2 },
  { sport: 'MLB', preset: 'mlb_points', whisperers: 2 },
] as const

async function signIn(page: Page, email: string, password: string, userId: string) {
  const csrf = await (await page.request.get('/api/auth/csrf')).json()
  const response = await page.request.post('/api/auth/callback/credentials?json=true', {
    form: { csrfToken: csrf.csrfToken, login: email, password, json: 'true' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  await expect.poll(async () => (await (await page.request.get('/api/auth/session')).json()).user?.id).toBe(userId)
}

test('signed-in NFL, NBA, NHL, MLB Zombie leagues draft and settle one week @zombie-rehearsal', async ({ page }) => {
  test.setTimeout(1_800_000)
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('LOCAL_DISPOSABLE_DATABASE_REQUIRED')
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) throw new Error('SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = `zombie-ci-${randomUUID().slice(0, 8)}`
  const userIds = Array.from({ length: 8 }, (_, i) => `${marker}-u${i}`)
  const leagueIds: string[] = []
  const password = randomUUID()
  const passwordHash = await bcrypt.hash(password, 6)
  try {
    await prisma.appUser.createMany({ data: userIds.map((id, i) => ({
      id, username: id, email: `${id}@example.invalid`,
      displayName: `Zombie Manager ${i + 1}`, emailVerified: new Date(),
      passwordHash,
    })) })
    await signIn(page, `${userIds[0]}@example.invalid`, password, userIds[0])

    for (const { sport, preset, whisperers } of SPORTS) {
      const created = await page.request.post('/api/leagues', {
        data: {
          concept: 'zombie', sport, teamCount: 8, draftType: 'snake',
          scoringPreset: preset, leagueName: `${marker} ${sport}`,
          timezone: 'America/New_York', conceptSetup: {},
        },
        timeout: 240_000,
      })
      expect(created.ok(), `${sport} create: ${await created.text()}`).toBeTruthy()
      const payload = await created.json()
      const leagueId = String(payload.league?.id ?? '')
      expect(leagueId).not.toBe('')
      leagueIds.push(leagueId)

      const zombie = await prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId } })
      expect(zombie.sport).toBe(sport)
      // Exercise the real commissioner API and persisted GET response before the draft.
      const choices = {
        leagueId, whispererCount: whisperers, whispererAmbushCount: 5,
        ambushCountPerWeek: 2, serumReviveCount: 3, autoSerumRevive: true,
        weeklyUpdateAutoPost: true, weeklyUpdateApproval: false,
      }
      const saved = await page.request.patch('/api/zombie/settings', { data: choices, timeout: 120_000 })
      expect(saved.ok(), `${sport} settings: ${await saved.text()}`).toBeTruthy()
      const loaded = await page.request.get(`/api/zombie/league?leagueId=${leagueId}`, { timeout: 120_000 })
      expect(loaded.ok(), await loaded.text()).toBeTruthy()
      const readback = await loaded.json()
      expect(readback.league).toMatchObject({
        whispererCount: whisperers, whispererAmbushCount: 5,
        config: { ambushCountPerWeek: 2, serumReviveCount: 3, autoSerumRevive: true },
      })
      expect(await prisma.zombieLeagueConfig.findUniqueOrThrow({ where: { leagueId } })).toMatchObject({
        ambushCountPerWeek: 2, serumReviveCount: 3, autoSerumRevive: true,
      })
      await prisma.zombieLeague.update({ where: { id: zombie.id }, data: {
        weeklyUpdateDay: null, weeklyUpdateHour: null,
      } })
      const rosters = await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } })
      expect(rosters).toHaveLength(8)
      rosters.sort((a, b) => Number(b.platformUserId === userIds[0]) - Number(a.platformUserId === userIds[0]))
      const rosterIdByUser = new Map(userIds.map((userId, index) => [userId, rosters[index].id]))
      for (let i = 0; i < 8; i++) {
        const oldUserId = rosters[i].platformUserId
        await prisma.leagueTeam.updateMany({
          where: { leagueId, OR: [{ externalId: rosters[i].id }, { platformUserId: oldUserId }] },
          data: {
            platformUserId: userIds[i], claimedByUserId: userIds[i], isOrphan: false,
            ownerName: `Zombie Manager ${i + 1}`, teamName: `Zombie Team ${i + 1}`,
          },
        })
        await prisma.roster.update({ where: { id: rosters[i].id }, data: { platformUserId: userIds[i] } })
      }

      const memberContext = await page.context().browser()!.newContext()
      const memberPage = await memberContext.newPage()
      try {
        await signIn(memberPage, userIds[1] + '@example.invalid', password, userIds[1])
        const denied = await memberPage.request.patch('/api/zombie/settings', { data: { leagueId, serumReviveCount: 5 } })
        expect(denied.status()).toBe(403)
        const payoutDenied = await memberPage.request.put('/api/zombie/weekly-payout', { data: {
          leagueId, week: 1, winnerRosterId: 'not-a-roster', amountCents: 999, providerName: 'Other', status: 'recorded',
        } })
        expect(payoutDenied.status()).toBe(403)
      } finally { await memberContext.close() }

      const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
      await prisma.draftPick.deleteMany({ where: { sessionId: draft.id } })
      const positions = sport === 'NFL' ? ['QB', 'RB', 'WR', 'TE', 'K'] :
        sport === 'NBA' ? ['PG', 'SG', 'SF', 'PF', 'C'] :
        sport === 'NHL' ? ['C', 'LW', 'RW', 'D', 'G'] : ['P', 'C', '1B', '2B', 'SS', 'OF']
      await prisma.draftPick.createMany({ data: Array.from({ length: draft.rounds * 8 }, (_, i) => {
        const round = Math.floor(i / 8)
        const slot = i % 8
        const owner = round % 2 === 0 ? slot : 7 - slot
        return {
          sessionId: draft.id, overall: i + 1, round: round + 1, slot: owner + 1,
          rosterId: rosters[owner].id, playerId: `${marker}-${sport}-${i}`,
          playerName: `Fixture Player ${i + 1}`, position: positions[round % positions.length],
          sportType: sport, source: 'simulation_fixture',
        }
      }) })
      await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })
      const synced = await syncCompletedDraftToRedraftSeason(leagueId)
      expect(synced.skipped, `${sport}: ${synced.reason}`).toBe(false)
      const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
      const activated = await ensureZombieSeasonActivated({ leagueId, redraftSeasonId: season.id })
      expect(activated.ok, `${sport}: ${JSON.stringify(activated)}`).toBe(true)
      const active = await prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId } })
      expect(active.status).toBe('active')
      const lockedRules = await page.request.patch('/api/zombie/settings', {
        data: { leagueId, serumReviveCount: 4 }, timeout: 120_000,
      })
      expect(lockedRules.status()).toBe(409)
      expect((await prisma.zombieLeagueConfig.findUniqueOrThrow({ where: { leagueId } })).serumReviveCount).toBe(3)
      expect(active.season).toBe(season.season)
      expect(await prisma.zombieLeagueTeam.count({ where: { leagueId } })).toBe(8)
      const whisperer = await prisma.whispererRecord.findUniqueOrThrow({ where: { zombieLeagueId: active.id } })
      expect(await prisma.zombieCoWhisperer.count({ where: { zombieLeagueId: active.id } })).toBe(whisperers - 1)
      const week = active.currentWeek
      const matchups = await prisma.redraftMatchup.findMany({ where: {
        seasonId: season.id, week, awayRosterId: { not: null },
      } })
      expect(matchups).toHaveLength(4)
      const whispererRoster = await prisma.redraftRoster.findFirstOrThrow({
        where: { seasonId: season.id, ownerId: whisperer.userId },
      })
      const threat = matchups.find(m => m.homeRosterId === whispererRoster.id || m.awayRosterId === whispererRoster.id)
      expect(threat).toBeTruthy()
      // Seed an existing Horde member in a separate pairing. Randomly selected
      // co-Whisperers can face the primary in Week 1, so a second threat keeps
      // infection coverage deterministic while still testing both role counts.
      const co = await prisma.zombieCoWhisperer.findMany({ where: { zombieLeagueId: active.id } })
      const whispererUsers = new Set([whisperer.userId, ...co.map(record => record.userId)])
      const seasonRosters = await prisma.redraftRoster.findMany({ where: { seasonId: season.id } })
      const ownerBySeasonRoster = new Map(seasonRosters.map(row => [row.id, row.ownerId]))
      const hordeMatchup = matchups.find(m =>
        !whispererUsers.has(ownerBySeasonRoster.get(m.homeRosterId) ?? '') &&
        !whispererUsers.has(ownerBySeasonRoster.get(m.awayRosterId ?? '') ?? ''))
      expect(hordeMatchup).toBeTruthy()
      const hordeUserId = ownerBySeasonRoster.get(hordeMatchup!.homeRosterId)!
      const hordeRosterId = rosterIdByUser.get(hordeUserId)
      expect(hordeRosterId).toBeTruthy()
      await prisma.zombieLeagueTeam.update({
        where: { leagueId_rosterId: { leagueId, rosterId: hordeRosterId! } },
        data: { status: 'Zombie', weekBecameZombie: week, killedByRosterId: rosterIdByUser.get(whisperer.userId)! },
      })
      const pending = await runWeeklyResolution(active.id, week)
      expect(pending.reason).toBe('matchups_incomplete')
      for (const matchup of matchups) {
        const homeIsWhisperer = matchup.homeRosterId === whispererRoster.id
        const awayIsWhisperer = matchup.awayRosterId === whispererRoster.id
        await prisma.redraftMatchup.update({ where: { id: matchup.id }, data: {
          homeScore: homeIsWhisperer || matchup.id === hordeMatchup!.id ? 150 : awayIsWhisperer ? 50 : 105,
          awayScore: awayIsWhisperer ? 150 : homeIsWhisperer || matchup.id === hordeMatchup!.id ? 50 : 95,
          status: 'final',
        } })
      }
      const settled = await runWeeklyResolution(active.id, week)
      expect(settled.resolution?.status, `${sport} week ${week}`).toBe('complete')
      expect(settled.resolution?.infectionCount).toBeGreaterThanOrEqual(1)
      expect(await prisma.zombieWeeklyWinnings.count({ where: { leagueId, week } })).toBeGreaterThanOrEqual(8)
      const announcement = await prisma.zombieAnnouncement.findFirstOrThrow({ where: {
        zombieLeagueId: active.id, week, type: 'weekly_update',
      } })
      expect(announcement.isPosted).toBe(true)
      expect(await prisma.leagueChatMessage.count({ where: { zombieWeeklyAnnouncementId: announcement.id } })).toBe(1)
      const after = await prisma.zombieLeague.findUniqueOrThrow({ where: { id: active.id } })
      expect(after.currentWeek).toBe(week + 1)
      const replay = await runWeeklyResolution(active.id, week)
      expect(replay.resolution?.id).toBe(settled.resolution?.id)
      expect(await prisma.leagueChatMessage.count({ where: { zombieWeeklyAnnouncementId: announcement.id } })).toBe(1)

      { // External-prize correction protection applies independently to every sport.
        await prisma.zombieLeague.update({ where: { id: active.id }, data: { isPaid: true } })
        const paid = await page.request.put('/api/zombie/weekly-payout', { data: {
          leagueId, week, winnerRosterId: rosterIdByUser.get(whisperer.userId)!,
          amountCents: 2750, providerName: 'Other', status: 'recorded', reference: `${marker}-external`,
        }, timeout: 120_000 })
        expect(paid.ok(), await paid.text()).toBeTruthy()
        const payout = await prisma.zombieExternalWeeklyPayout.findUniqueOrThrow({ where: {
          zombieLeagueId_week: { zombieLeagueId: active.id, week },
        } })
        expect(payout.amountCents).toBe(2750)
        const originalLedger = await prisma.zombieWeeklyWinnings.findMany({
          where: { leagueId, week }, orderBy: { rosterId: 'asc' },
          select: { rosterId: true, amount: true },
        })
        await prisma.redraftMatchup.update({ where: { id: threat!.id }, data: {
          homeScore: threat!.homeRosterId === whispererRoster.id ? 50 : 150,
          awayScore: threat!.awayRosterId === whispererRoster.id ? 50 : 150,
        } })
        const correction = await runWeeklyResolution(active.id, week, { force: true, reason: 'stat_correction' })
        expect(correction.resolution?.requiresStatCorrection).toBe(true)
        expect(await prisma.zombieWeeklyWinnings.findMany({
          where: { leagueId, week }, orderBy: { rosterId: 'asc' },
          select: { rosterId: true, amount: true },
        })).toEqual(originalLedger)
        expect((await prisma.zombieExternalWeeklyPayout.findUniqueOrThrow({ where: {
          zombieLeagueId_week: { zombieLeagueId: active.id, week },
        } })).amountCents).toBe(2750)
      }
      console.log(`${sport} native Zombie: draft, ${whisperers} Whisperer(s), week ${week}, infection, report, idempotency passed`)
    }
  } finally {
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } })
    for (const leagueId of leagueIds) await prisma.automationLock.deleteMany({ where: { lockKey: `draft:${leagueId}:pick` } })
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } })
    await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
  }
})


test('four-sport universe allocations use finished native standings and record once @zombie-rehearsal', async ({ page }) => {
  test.setTimeout(1_800_000)
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('LOCAL_DISPOSABLE_DATABASE_REQUIRED')
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) throw new Error('SHARED_REDIS_MUST_BE_DISABLED')
  const marker = 'zombie-universe-' + randomUUID().slice(0, 8)
  const userIds = Array.from({ length: 25 }, (_, i) => marker + '-u' + i)
  const leagues: string[] = [], universes: string[] = []
  const password = randomUUID(), hash = await bcrypt.hash(password, 6)
  try {
    await prisma.appUser.createMany({ data: userIds.map(id => ({
      id, username: id, email: id + '@example.invalid', emailVerified: new Date(), passwordHash: hash,
    })) })
    await signIn(page, userIds[0] + '@example.invalid', password, userIds[0])
    for (const { sport, preset } of SPORTS) {
      const u = await prisma.zombieUniverse.create({ data: {
        name: marker + ' ' + sport, sport, commissionedByUserId: userIds[0], createdByUserId: userIds[0],
        promotionCount: 2, relegationCount: 2,
      } })
      universes.push(u.id)
      const levels = []
      for (const [i, name] of ['Gamma', 'Beta', 'Alpha'].entries()) levels.push(await prisma.zombieUniverseLevel.create({
        data: { universeId: u.id, name, tierLabel: name, rankOrder: i + 1 },
      }))
      for (const [levelIndex, level] of levels.entries()) {
        const created = await page.request.post('/api/leagues', { data: {
          concept: 'zombie', sport, teamCount: 8, draftType: 'snake', scoringPreset: preset,
          leagueName: marker + ' ' + sport + ' ' + level.name, timezone: 'America/New_York', conceptSetup: {},
        }, timeout: 240000 })
        expect(created.ok(), await created.text()).toBeTruthy()
        const leagueId = String((await created.json()).league.id)
        leagues.push(leagueId)
        await prisma.league.update({ where: { id: leagueId }, data: { season: 2026, status: 'complete' } })
        await prisma.draftSession.updateMany({ where: { leagueId }, data: { status: 'completed', completedAt: new Date() } })
        const z = await prisma.zombieLeague.update({ where: { leagueId }, data: {
          universeId: u.id, levelId: level.id, season: 2026, status: 'complete', totalWeeks: 1, currentWeek: 1,
        } })
        await prisma.leagueWaiverSettings.update({where:{leagueId},data:{faabBudget:100,waiverEngineConfig:{faab_rollover_rule:levelIndex===1?'carry_over':'reset'}}})
        // Controlled completed-season fixture: this test checks allocation and access, not live provider scoring.
        const season = await prisma.redraftSeason.create({ data: {
          leagueId, sport, season: 2026, status: 'complete', totalWeeks: 1, currentWeek: 1, playoffStartWeek: 2,
        } })
        const rosters = await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } })
        expect(rosters).toHaveLength(8)
        for (let i = 0; i < rosters.length; i++) {
          const owner = userIds[1 + levelIndex * 8 + i]
          await prisma.roster.update({ where: { id: rosters[i].id }, data: { platformUserId: owner, faabRemaining: i+13 } })
          await prisma.zombieLeagueTeam.upsert({
            where: { leagueId_rosterId: { leagueId, rosterId: rosters[i].id } },
            create: { leagueId, rosterId: rosters[i].id, zombieLeagueId: z.id, displayName: owner },
            update: {},
          })
          await prisma.redraftRoster.create({ data: {
            leagueId, seasonId: season.id, ownerId: owner, ownerName: owner,
            wins: 8-i, losses: i, pointsFor: 800-i*40,
          } })
        }
        await prisma.zombieLeague.update({where:{id:z.id},data:{isPaid:true,potTotal:250}})
        await prisma.zombiePaidConfig.create({data:{zombieLeagueId:z.id,buyInAmount:25,totalPot:250,totalCollected:250,totalPaidOut:25,paidUserIds:[userIds[1+levelIndex*8]],potIsLocked:true}})
        await prisma.zombieResourceLedger.create({data:{leagueId,zombieLeagueId:z.id,rosterId:rosters[0].id,resourceType:'serum',balance:2,awardedInWeek:1}})
        await prisma.zombieWeeklyWinnings.create({data:{leagueId,zombieLeagueId:z.id,rosterId:rosters[0].id,week:1,amount:25}})
        await prisma.whispererRecord.create({data:{zombieLeagueId:z.id,userId:userIds[1+levelIndex*8],displayName:'Past Whisperer',selectionMode:'random',ambushesUsed:3,ambushesRemaining:0}})
        await prisma.zombieWeeklyResolution.create({ data: {
          zombieLeagueId: z.id, week: 1, status: 'complete', resolvedAt: new Date(), matchupResults: [], newZombies: [],
        } })
      }
      const rows = await getUniverseStandings(u.id, 2026)
      expect(rows).toHaveLength(24)
      expect(rows.filter(r => r.wins === 8)).toHaveLength(3)
      expect(await getUniverseStandings(u.id, 2025)).toEqual([])
      await refreshMovementProjections(u.id, 2026)
      const projections = await prisma.zombieMovementProjection.findMany({ where: { universeId: u.id, season: 2026 } })
      expect(projections).toHaveLength(24)
      expect(projections.filter(r => r.reason !== 'watch')).toHaveLength(8)
      const z = await prisma.zombieLeague.findFirstOrThrow({ where: { universeId: u.id } })
      await prisma.zombieLeague.update({ where: { id: z.id }, data: { status: 'active' } })
      await expect(executePromotionRelegation(u.id, 2026, userIds[0])).rejects.toThrow('MOVEMENT_SEASONS_INCOMPLETE')
      expect(await prisma.zombieMovementRecord.count({ where: { universeId: u.id } })).toBe(0)
      await prisma.zombieLeague.update({ where: { id: z.id }, data: { status: 'complete' } })
      await prisma.zombieWeeklyResolution.update({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: 1 } }, data: { requiresStatCorrection: true } })
      await expect(executePromotionRelegation(u.id, 2026, userIds[0])).rejects.toThrow('MOVEMENT_RECONCILIATION_REQUIRED')
      await prisma.zombieWeeklyResolution.update({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: 1 } }, data: { requiresStatCorrection: false } })
      await expect(executePromotionRelegation(u.id, 2026, userIds[1])).rejects.toThrow('MOVEMENT_OWNER_REQUIRED')
      const before = await prisma.roster.findMany({ where: { leagueId: { in: rows.map(r => r.leagueId) } }, orderBy: { id: 'asc' }, select: { id: true, leagueId: true, platformUserId: true, playerData: true } })
      const attempts = await Promise.all([executePromotionRelegation(u.id, 2026, userIds[0]), executePromotionRelegation(u.id, 2026, userIds[0])])
      expect(attempts.filter(r => !r.alreadyRecorded)).toHaveLength(1)
      expect(attempts.filter(r => r.alreadyRecorded)).toHaveLength(1)
      const records = await prisma.zombieMovementRecord.findMany({ where: { universeId: u.id, season: 2026 } })
      expect(records).toHaveLength(8)
      expect(new Set(records.map(r => r.userId)).size).toBe(8)
      expect(records.every(r => ['Gamma', 'Beta', 'Alpha'].includes(r.toTierLabel))).toBe(true)
      expect(records.every(r => r.approvedBy === userIds[0])).toBe(true)
      expect(await prisma.roster.findMany({ where: { leagueId: { in: rows.map(r => r.leagueId) } }, orderBy: { id: 'asc' }, select: { id: true, leagueId: true, platformUserId: true, playerData: true } })).toEqual(before)
      const memberContext = await page.context().browser()!.newContext()
      try {
        const member = await memberContext.newPage()
        await signIn(member, userIds[1] + '@example.invalid', password, userIds[1])
        expect((await member.request.post('/api/zombie/universe-stats', { data: { universeId: u.id, action: 'execute_movement', season: 2026 } })).status()).toBe(403)
        expect((await member.request.get('/api/zombie/universe-stats?universeId=' + u.id)).status()).toBe(403)
        const visible = await member.request.get('/api/zombie-universe/' + u.id + '/standings?season=2026')
        expect(visible.ok(), await visible.text()).toBeTruthy()
      } finally { await memberContext.close() }
      const renewalPath='/api/zombie-universe/'+u.id+'/renew'
      const previewRes=await page.request.get(renewalPath+'?season=2026')
      expect(previewRes.ok(),await previewRes.text()).toBeTruthy()
      const preview=await previewRes.json()
      expect(preview.assignments).toHaveLength(24)
      expect(preview.pools).toHaveLength(3)
      const countBefore=await prisma.league.count({where:{userId:userIds[0]}})
      const stale=await page.request.post(renewalPath,{data:{season:2026,previewHash:'0'.repeat(64)}})
      expect(stale.status()).toBe(409)
      expect(await prisma.league.count({where:{userId:userIds[0]}})).toBe(countBefore)
      // A database failure on the final destination must roll back earlier newly-created leagues, seats and drafts.
      const trigger='zombie_renewal_'+randomUUID().replace(/-/g,'')
      const lastDestination=preview.pools[preview.pools.length-1]
      try {
        await prisma.$executeRawUnsafe('CREATE FUNCTION '+trigger+'() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'fixture renewal failure\'; END $$')
        await prisma.$executeRawUnsafe('CREATE TRIGGER '+trigger+' BEFORE INSERT ON zombie_leagues FOR EACH ROW WHEN (NEW."universeId" = \''+u.id+'\' AND NEW.season = 2027 AND NEW."levelId" = \''+lastDestination.levelId+'\') EXECUTE FUNCTION '+trigger+'()')
        await expect(renewZombieUniverse(u.id,2026,userIds[0],preview.previewHash)).rejects.toThrow('fixture renewal failure')
        expect(await prisma.league.count({where:{userId:userIds[0]}})).toBe(countBefore)
        expect(await prisma.zombieLeague.count({where:{universeId:u.id,season:2027}})).toBe(0)
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS '+trigger+' ON zombie_leagues')
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS '+trigger+'()')
      }
      const renewalAttempts=await Promise.all([
        renewZombieUniverse(u.id,2026,userIds[0],preview.previewHash),
        renewZombieUniverse(u.id,2026,userIds[0],preview.previewHash),
      ])
      expect(renewalAttempts.filter(r=>!r.alreadyRenewed)).toHaveLength(1)
      const renewal=renewalAttempts.find(r=>!r.alreadyRenewed)!
      const nextLeagues=renewal.leagues as Array<{leagueId:string;previousLeagueId:string;draftId:string}>
      leagues.push(...nextLeagues.map(l=>l.leagueId))
      expect(nextLeagues).toHaveLength(3)
      expect(await prisma.roster.findMany({where:{leagueId:{in:rows.map(r=>r.leagueId)}},orderBy:{id:'asc'},select:{id:true,leagueId:true,platformUserId:true,playerData:true}})).toEqual(before)
      expect(await prisma.zombieMovementRecord.count({where:{universeId:u.id,season:2026}})).toBe(8)
      for(const next of nextLeagues) {
        const expected=preview.assignments.filter((m:{destinationLeagueId:string})=>m.destinationLeagueId===next.previousLeagueId)
        const roster=await prisma.roster.findMany({where:{leagueId:next.leagueId}})
        expect(roster).toHaveLength(8)
        expect(new Set(roster.map(r=>r.platformUserId))).toEqual(new Set(expected.map((m:{userId:string})=>m.userId)))
        expect(roster.every(r=>(r.playerData as {players:string[]}).players.length===0)).toBe(true)
        for(const r of roster) expect(r.faabRemaining).toBe(expected.find((m:{userId:string})=>m.userId===r.platformUserId).nextFaab)
        const draft=await prisma.draftSession.findUniqueOrThrow({where:{id:next.draftId}})
        expect(draft).toMatchObject({status:'pre_draft',startedAt:null,sportType:sport,teamCount:8})
        expect((draft.slotOrder as unknown[]).length).toBe(8)
        const newLeague=await prisma.league.findUniqueOrThrow({where:{id:next.leagueId}})
        const oldLeague=await prisma.league.findUniqueOrThrow({where:{id:next.previousLeagueId}})
        expect(newLeague).toMatchObject({season:2027,sport,tenantId:oldLeague.tenantId,rosterSize:oldLeague.rosterSize,scoring:oldLeague.scoring,status:'setup',leagueVariant:'zombie'})
        expect(await prisma.zombieLeague.findUniqueOrThrow({where:{leagueId:next.leagueId}})).toMatchObject({season:2027,status:'setup',currentWeek:0,potTotal:0})
        expect(await prisma.zombieLeagueTeam.count({where:{leagueId:next.leagueId}})).toBe(0)
        expect(await prisma.zombieResourceLedger.count({where:{leagueId:next.leagueId}})).toBe(0)
        expect(await prisma.zombieResourceLedger.count({where:{leagueId:next.previousLeagueId,balance:2}})).toBe(1)
        const newZombie=await prisma.zombieLeague.findUniqueOrThrow({where:{leagueId:next.leagueId}})
        expect(await prisma.whispererRecord.count({where:{zombieLeagueId:newZombie.id}})).toBe(0)
        expect(await prisma.zombiePaidConfig.findUniqueOrThrow({where:{zombieLeagueId:newZombie.id}})).toMatchObject({
          buyInAmount:25,totalPot:0,totalCollected:0,totalPaidOut:0,paidUserIds:[],potIsLocked:false,
        })
        expect(await prisma.zombieWeeklyWinnings.count({where:{leagueId:next.leagueId}})).toBe(0)
        expect((await prisma.zombieWeeklyWinnings.findFirstOrThrow({where:{leagueId:next.previousLeagueId}})).amount).toBe(25)
        const oldConfig=await prisma.zombieLeagueConfig.findUniqueOrThrow({where:{leagueId:next.previousLeagueId}})
        expect(await prisma.zombieLeagueConfig.findUniqueOrThrow({where:{leagueId:next.leagueId}})).toMatchObject({serumReviveCount:oldConfig.serumReviveCount,autoSerumRevive:oldConfig.autoSerumRevive,zombieTradeBlocked:oldConfig.zombieTradeBlocked})
      }
      const repeated=await page.request.post(renewalPath,{data:{season:2026,previewHash:preview.previewHash}})
      expect(repeated.ok(),await repeated.text()).toBeTruthy()
      expect((await repeated.json()).alreadyRenewed).toBe(true)
      expect((await previewZombieUniverseRenewal(u.id,2026,userIds[0])).completed).toBe(true)
      const hub=await page.request.get('/api/zombie/universe-hub?universeId='+u.id)
      expect(hub.ok(),await hub.text()).toBeTruthy()
      const hubData=await hub.json()
      expect(hubData.universe.season).toBe(2027)
      expect(hubData.counts.leagueCount).toBe(3)
      expect(hubData.universe.leagues.every((l:{season:number})=>l.season===2027)).toBe(true)
      expect(await getUniverseStandings(u.id,2026)).toHaveLength(24)
      await syncUniverseStats(u.id,1,2026)
      expect(await prisma.zombieUniverseStat.count({where:{universeId:u.id,season:2026}})).toBe(24)
      expect((await prisma.zombieUniverseStat.findFirstOrThrow({where:{universeId:u.id,season:2026},orderBy:{currentSeasonPPW:'desc'}})).currentSeasonPPW).toBe(100)
      await syncUniverseStats(u.id,0,2027)
      expect(await prisma.zombieUniverseStat.count({where:{universeId:u.id,season:2027}})).toBe(0)
      expect(await buildUniverseWeeklyDigest(u.id,1,2026)).toContain('📋 Leagues: 3')
      expect(await buildUniverseWeeklyDigest(u.id,0,2027)).toContain('📋 Leagues: 3')
      const memberCtx=await page.context().browser()!.newContext()
      try {
        const member=await memberCtx.newPage()
        await signIn(member,userIds[1]+'@example.invalid',password,userIds[1])
        expect((await member.request.get(renewalPath+'?season=2026')).status()).toBe(403)
        expect((await member.request.post(renewalPath,{data:{season:2026,previewHash:preview.previewHash}})).status()).toBe(403)
      } finally {await memberCtx.close()}
      console.log(sport+': 3-level full renewal, placements, empty drafts, old-history preservation, rollback, concurrent retry and owner access passed')
      const ready=await page.request.get('/api/zombie/readiness?universeId='+u.id)
      expect(ready.ok(),await ready.text()).toBeTruthy()
      const readyReport=await ready.json()
      expect(readyReport.leagues).toHaveLength(3)
      expect(readyReport.leagues.every((l:{season:number})=>l.season===2027)).toBe(true)
      expect(readyReport.leagues[0].checks.find((c:{id:string})=>c.id==='managers').status).toBe('ready')
      // Reuse a completed controlled fixture only after all universe/history assertions above.
      // A linked league cannot bypass whole-universe renewal.
      const soloId=z.leagueId, soloPath='/api/zombie/league/'+soloId+'/renew'
      expect((await page.request.get(soloPath+'?season=2026')).status()).toBe(409)
      await prisma.zombieLeague.update({where:{leagueId:soloId},data:{universeId:null,levelId:null,isSingleLeague:true}})
      await prisma.zombieLeagueConfig.update({where:{leagueId:soloId},data:{universeId:null}})
      const soloBefore=await prisma.roster.findMany({where:{leagueId:soloId},orderBy:{id:'asc'}})
      const soloPreview=await page.request.get(soloPath+'?season=2026')
      expect(soloPreview.ok(),await soloPreview.text()).toBeTruthy()
      const soloPlan=await soloPreview.json()
      expect(soloPlan.assignments).toHaveLength(8)
      const wrongActor=await page.context().browser()!.newContext()
      try {
        const member=await wrongActor.newPage()
        await signIn(member,userIds[1]+'@example.invalid',password,userIds[1])
        expect((await member.request.get(soloPath+'?season=2026')).status()).toBe(403)
        expect((await member.request.post(soloPath,{data:{season:2026,previewHash:soloPlan.previewHash}})).status()).toBe(403)
        expect((await member.request.get('/api/zombie/readiness?leagueId='+soloId)).status()).toBe(403)
        expect((await member.request.get('/api/zombie/readiness?universeId='+u.id)).status()).toBe(403)
      } finally {await wrongActor.close()}
      const soloResults=await Promise.all([
        renewStandaloneZombieLeague(soloId,2026,userIds[0],soloPlan.previewHash),
        renewStandaloneZombieLeague(soloId,2026,userIds[0],soloPlan.previewHash),
      ])
      expect(soloResults.filter(r=>!r.alreadyRenewed)).toHaveLength(1)
      const soloNext=soloResults[0].leagues[0]
      leagues.push(soloNext.leagueId)
      expect(await prisma.zombieLeague.findUniqueOrThrow({where:{leagueId:soloNext.leagueId}})).toMatchObject({universeId:null,levelId:null,isSingleLeague:true,season:2027,status:'setup',currentWeek:0,potTotal:0})
      expect(await prisma.draftSession.findUniqueOrThrow({where:{id:soloNext.draftId}})).toMatchObject({status:'pre_draft',startedAt:null,teamCount:8})
      const soloRoster=await prisma.roster.findMany({where:{leagueId:soloNext.leagueId}})
      expect(new Set(soloRoster.map(r=>r.platformUserId))).toEqual(new Set(soloBefore.map(r=>r.platformUserId)))
      expect(soloRoster.every(r=>(r.playerData as {players:string[]}).players.length===0)).toBe(true)
      expect(await prisma.roster.findMany({where:{leagueId:soloId},orderBy:{id:'asc'}})).toEqual(soloBefore)
      expect(await prisma.whispererRecord.count({where:{zombieLeagueId:(await prisma.zombieLeague.findUniqueOrThrow({where:{leagueId:soloNext.leagueId}})).id}})).toBe(0)
      const soloAgain=await page.request.post(soloPath,{data:{season:2026,previewHash:soloPlan.previewHash}})
      expect(soloAgain.ok(),await soloAgain.text()).toBeTruthy()
      expect((await soloAgain.json()).alreadyRenewed).toBe(true)
      expect((await previewStandaloneZombieRenewal(soloId,2026,userIds[0])).completed).toBe(true)
      const soloReady=await page.request.get('/api/zombie/readiness?leagueId='+soloNext.leagueId)
      expect(soloReady.ok(),await soloReady.text()).toBeTruthy()
      expect((await soloReady.json()).leagues[0].checks.find((c:{id:string})=>c.id==='draft').status).toBe('waiting')
      console.log(sport+': standalone renewal, registered manager readiness, universe archive isolation and nonowner API protections passed')

    }
  } finally {
    await prisma.zombieMovementProjection.deleteMany({ where: { universeId: { in: universes } } })
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.zombieUniverse.deleteMany({ where: { id: { in: universes } } })
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
  }
})

test('four-sport reviewed capacity plans preserve archives and require renewed consent @zombie-rehearsal',async({page})=>{
 test.setTimeout(1_800_000)
 const target=new URL(process.env.DATABASE_URL||'http://invalid')
 if(!['127.0.0.1','localhost'].includes(target.hostname))throw new Error('LOCAL_DISPOSABLE_DATABASE_REQUIRED')
 if(process.env.UPSTASH_REDIS_REST_URL||process.env.UPSTASH_REDIS_REST_TOKEN)throw new Error('SHARED_REDIS_MUST_BE_DISABLED')
 const {runPresetEngine}=await import('../lib/league-creation/preset-engine/runPresetEngine')
 const {createCanonicalLeagueInTransaction}=await import('../lib/league-creation/canonical/createCanonicalLeagueInTransaction')
 const {createZombieLeague}=await import('../lib/zombie/setupEngine')
 const marker='manual-renewal-ci-'+randomUUID().slice(0,8)
 const password=randomUUID(),passwordHash=await bcrypt.hash(password,6)
 const users=Array.from({length:17},(_,i)=>marker+'-'+i)
 await prisma.appUser.createMany({data:users.map(id=>({id,username:id,email:id+'@example.invalid',emailVerified:new Date(),passwordHash}))})
 await signIn(page,users[0]+'@example.invalid',password,users[0])
 try {
 for(const [sport,preset] of [['NFL','fb_half_ppr'],['NBA','nba_points'],['NHL','nhl_points'],['MLB','mlb_points']] as const){
  const u=await prisma.zombieUniverse.create({data:{name:marker+' '+sport,sport,commissionedByUserId:users[0],createdByUserId:users[0],promotionCount:2,relegationCount:2}})
  const originals:string[]=[]
  for(const [li,name] of ['Gamma','Alpha'].entries()){
   const level=await prisma.zombieUniverseLevel.create({data:{universeId:u.id,name,tierLabel:name,rankOrder:li+1}})
   const body={concept:'zombie',sport,teamCount:8,draftType:'snake',scoringPreset:preset,leagueName:marker+' '+sport+' '+name,timezone:'America/New_York',conceptSetup:{}}
   const engine=runPresetEngine({...body,commissionerId:users[0]})
   const made=await prisma.$transaction(tx=>createCanonicalLeagueInTransaction(tx,users[0],body,engine,undefined,{tenantId:'allfantasy',season:2026}),{timeout:120000})
   const id=made.leagueId; originals.push(id)
   const z=await createZombieLeague({leagueId:id,sport,teamCount:8,season:2026},u.id,level.id)
   await prisma.zombieLeague.update({where:{id:z.id},data:{status:'complete',totalWeeks:1,currentWeek:1,seasonStartWeek:1,isPaid:true,potTotal:200}})
   await prisma.zombiePaidConfig.create({data:{zombieLeagueId:z.id,buyInAmount:25,totalPot:200,totalCollected:200,paidUserIds:[users[1+li*8]],potIsLocked:true}})
   await prisma.league.update({where:{id},data:{status:'complete'}})
   await prisma.draftSession.updateMany({where:{leagueId:id},data:{status:'completed',completedAt:new Date()}})
   await prisma.leagueWaiverSettings.update({where:{leagueId:id},data:{faabBudget:100,waiverEngineConfig:{faab_rollover_rule:li?'carry_over':'reset'}}})
   const season=await prisma.redraftSeason.create({data:{leagueId:id,sport,season:2026,status:'complete',totalWeeks:1,currentWeek:1,playoffStartWeek:2}})
   const roster=await prisma.roster.findMany({where:{leagueId:id},orderBy:{id:'asc'}})
   for(let i=0;i<8;i++){
    const owner=users[1+li*8+i]
    await prisma.roster.update({where:{id:roster[i].id},data:{platformUserId:owner,faabRemaining:13+i}})
    await prisma.zombieLeagueTeam.create({data:{leagueId:id,zombieLeagueId:z.id,rosterId:roster[i].id,displayName:owner}})
    await prisma.redraftRoster.create({data:{leagueId:id,seasonId:season.id,ownerId:owner,ownerName:owner,wins:8-i,losses:i,pointsFor:800-i*40}})
   }
   await prisma.zombieWeeklyResolution.create({data:{zombieLeagueId:z.id,week:1,status:'complete',matchupResults:[],newZombies:[],resolvedAt:new Date()}})
   await prisma.zombieWeeklyWinnings.create({data:{zombieLeagueId:z.id,leagueId:id,rosterId:roster[0].id,week:1,amount:25}})
  }
  const before=await prisma.roster.findMany({where:{leagueId:{in:originals}},orderBy:{id:'asc'}})

  const {getZombieUniverseRenewalEditor,previewReviewedZombieUniverseRenewal,saveZombieUniverseRenewalDraft}=await import('../lib/zombie/renewZombieUniverse')
  const {zombieRenewalDraftReadiness}=await import('../lib/zombie/zombieRenewalDraftReadiness')
  await prisma.zombieUniverse.update({where:{id:u.id},data:{promotionMode:'manual'}})
  await assert.rejects(getZombieUniverseRenewalEditor(u.id,2026,users[1]),/RENEWAL_OWNER_REQUIRED/)
  await assert.rejects(previewZombieUniverseRenewal(u.id,2026,users[0]),/RENEWAL_MANUAL_REVIEW_REQUIRED/)
  const editor=await getZombieUniverseRenewalEditor(u.id,2026,users[0])
  assert.equal(editor.managers!.length,16)
  const proposal={version:1,reason:'Reviewed next-season expansion and placements',replaceRecordedMovement:false,
   pools:editor.pools!.map(p=>({key:p.leagueId,templateLeagueId:p.leagueId,levelId:p.levelId,name:p.name,seats:10})),
   placements:editor.managers!.map(m=>({userId:m.userId,poolId:m.leagueId}))}
  if(sport==='NFL'){proposal.pools=[{...proposal.pools[1],seats:16}];proposal.placements.forEach(m=>m.poolId=proposal.pools[0].key)}
  if(sport==='MLB'){
   proposal.pools.forEach(p=>p.seats=8)
   proposal.pools.push({...proposal.pools[0],key:'expansion-third',name:'Expansion Gamma'})
   proposal.placements.forEach((m,i)=>m.poolId=proposal.pools[i%3].key)
  }
  const oldMovement=await prisma.zombieMovementRecord.create({data:{universeId:u.id,season:2026,userId:users[1],displayName:'Fixture old allocation',
   fromTierLabel:'Gamma',toTierLabel:'Alpha',movementType:'promoted',reason:'fixture_recorded',finalRecord:'8-0',finalPPW:100,finalTierRank:1,approvedBy:users[0]}})

  const path='/api/zombie-universe/'+u.id+'/renew'
  const editorResponse=await page.request.get(path+'?editor=1&season=2026')
  expect(editorResponse.status()).toBe(200)
  const apiPreview=await page.request.patch(path,{data:{season:2026,proposal}})
  expect(apiPreview.status()).toBe(200)
  const apiHash=(await apiPreview.json()).previewHash
  expect((await page.request.put(path,{data:{season:2026,proposal,previewHash:apiHash}})).status()).toBe(200)
  const memberContext=await page.context().browser()!.newContext()
  try{
   const member=await memberContext.newPage();await signIn(member,users[1]+'@example.invalid',password,users[1])
   expect((await member.request.get(path+'?editor=1&season=2026')).status()).toBe(403)
   expect((await member.request.patch(path,{data:{season:2026,proposal}})).status()).toBe(403)
   expect((await member.request.put(path,{data:{season:2026,proposal,previewHash:apiHash}})).status()).toBe(403)
   expect((await member.request.post(path,{data:{season:2026,proposal,previewHash:apiHash}})).status()).toBe(403)
  }finally{await memberContext.close()}
  if(sport==='NFL'){
   await page.setViewportSize({width:390,height:844})
   await page.goto('/zombie/universe/'+u.id)
   await page.getByRole('button',{name:'Edit placements and capacity',exact:true}).click()
   await expect(page.getByRole('button',{name:'Restore saved review draft'})).toBeVisible()
   await page.getByRole('button',{name:'Restore saved review draft'}).click()
   await page.getByRole('button',{name:'Preview this proposal',exact:true}).click()
   await expect(page.getByRole('button',{name:'Create season 2027',exact:true})).toBeDisabled()
   await page.getByRole('checkbox',{name:'I reviewed the placements and the fresh-season resets.'}).check()
   await expect(page.getByRole('button',{name:'Create season 2027',exact:true})).toBeEnabled()
   await page.getByLabel('Reason for these placements and capacity changes').fill('A changed proposal needs another preview')
   await expect(page.getByRole('button',{name:'Create season 2027',exact:true})).toHaveCount(0)
   await expect(page.getByRole('button',{name:'Save review draft',exact:true})).toBeDisabled()
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  }

  let review=await previewReviewedZombieUniverseRenewal(u.id,2026,users[0],proposal)
  await saveZombieUniverseRenewalDraft(u.id,2026,users[0],review.previewHash!,proposal)
  assert.deepEqual((await getZombieUniverseRenewalEditor(u.id,2026,users[0])).savedProposal,proposal)
  await assert.rejects(renewZombieUniverse(u.id,2026,users[0],review.previewHash!,proposal),/RENEWAL_MOVEMENT_REVIEW_REQUIRED/)
  assert.equal(await prisma.zombieLeague.count({where:{universeId:u.id,season:2027}}),0)
  proposal.replaceRecordedMovement=true
  await assert.rejects(renewZombieUniverse(u.id,2026,users[0],review.previewHash!,proposal),/RENEWAL_PREVIEW_CHANGED/)
  review=await previewReviewedZombieUniverseRenewal(u.id,2026,users[0],proposal)
  const trigger='manual_rollback_'+randomUUID().replace(/-/g,'')
  const priorCount=await prisma.league.count({where:{userId:users[0]}})
  try{
   await prisma.$executeRawUnsafe('CREATE FUNCTION '+trigger+'() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '+String.fromCharCode(39)+'manual_rollback_fixture'+String.fromCharCode(39)+'; END $$')
   await prisma.$executeRawUnsafe('CREATE TRIGGER '+trigger+' BEFORE INSERT ON zombie_leagues FOR EACH ROW WHEN (NEW."universeId"='+String.fromCharCode(39)+u.id+String.fromCharCode(39)+' AND NEW.season=2027) EXECUTE FUNCTION '+trigger+'()')
   await assert.rejects(renewZombieUniverse(u.id,2026,users[0],review.previewHash!,proposal),/manual_rollback_fixture/)
   assert.equal(await prisma.league.count({where:{userId:users[0]}}),priorCount)
   assert(await prisma.zombieMovementRecord.findUnique({where:{id:oldMovement.id}}))
   assert.equal(await prisma.zombieAuditLog.count({where:{universeId:u.id,eventType:'UNIVERSE_MOVEMENT_OVERRIDDEN'}}),0)
  }finally{
   await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS '+trigger+' ON zombie_leagues')
   await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS '+trigger+'()')
  }
  const results=await Promise.all([renewZombieUniverse(u.id,2026,users[0],review.previewHash!,proposal),renewZombieUniverse(u.id,2026,users[0],review.previewHash!,proposal)])
  assert.equal(results.filter(r=>!r.alreadyRenewed).length,1)
  const result=results.find(r=>!r.alreadyRenewed)!
  assert.equal(result.leagues.length,proposal.pools.length)
  assert.equal(result.placements.length,16);assert.equal(new Set(result.placements.map(m=>m.userId)).size,16)
  await assert.rejects(renewZombieUniverse(u.id,2026,users[0],review.previewHash!,{...proposal,reason:'Different unreviewed reason'}),/RENEWAL_PREVIEW_CHANGED/)
  assert.deepEqual(await prisma.roster.findMany({where:{leagueId:{in:originals}},orderBy:{id:'asc'}}),before)
  const override=await prisma.zombieAuditLog.findFirstOrThrow({where:{universeId:u.id,eventType:'UNIVERSE_MOVEMENT_OVERRIDDEN'}})
  assert.equal((override.metadata as any).before[0].id,oldMovement.id)
  assert.equal((override.metadata as any).reason,proposal.reason)
  assert.equal(await prisma.zombieAuditLog.count({where:{universeId:u.id,eventType:'UNIVERSE_RENEWAL_REVIEW_APPLIED'}}),1)
  let totalOpen=0
  for(const next of result.leagues){
   const pool=proposal.pools.find(p=>p.key===next.poolId)!
   const expected=review.assignments!.filter(m=>m.destinationLeagueId===pool.key)
   const roster=await prisma.roster.findMany({where:{leagueId:next.leagueId}})
   assert.equal(roster.length,pool.seats)
   for(const m of expected)assert.equal(roster.find(r=>r.platformUserId===m.userId)!.faabRemaining,m.nextFaab)
   const open=roster.filter(r=>(r.settings as any).openSlot);totalOpen+=open.length
   assert.equal(open.length,pool.seats-expected.length)
   assert.equal(await prisma.leagueEntrySlot.count({where:{leagueId:next.leagueId,status:'OPEN'}}),open.length)
   const league=await prisma.league.findUniqueOrThrow({where:{id:next.leagueId}})
   const ready=await zombieRenewalDraftReadiness(prisma,next.leagueId,pool.seats,league.settings)
   assert.equal(ready.ready,open.length===0)
   if(open.length){
    const start=await page.request.post('/api/leagues/'+next.leagueId+'/draft/controls',{data:{action:'start'},timeout:240000})
    expect(start.status(),await start.text()).toBe(409)
    expect((await start.json()).code).toBe('ZOMBIE_RENEWAL_SEATS_INCOMPLETE')
   }
   const draft=await prisma.draftSession.findUniqueOrThrow({where:{id:next.draftId}})
   assert.equal(draft.status,'pre_draft');assert.equal(draft.teamCount,pool.seats);assert.equal(draft.startedAt,null)
   const zombie=await prisma.zombieLeague.findUniqueOrThrow({where:{leagueId:next.leagueId}})
   assert.equal(zombie.currentTeamCount,expected.length);assert.equal(zombie.teamCount,pool.seats)
   assert.equal((await prisma.zombiePaidConfig.findUniqueOrThrow({where:{zombieLeagueId:zombie.id}})).totalCollected,0)
  }
  assert.equal(totalOpen,review.openSeats)
  console.log(JSON.stringify({event:'manual_four_sport_renewal_pass',sport,leagues:result.leagues.length,managers:16,openSeats:totalOpen,rollback:true,idempotent:true,auditPreserved:true}))


 }
 }finally {
 const owned=await prisma.league.findMany({where:{userId:users[0]},select:{id:true}})
 await prisma.analyticsEvent.deleteMany({where:{userId:{in:users}}})
 await prisma.league.deleteMany({where:{id:{in:owned.map(l=>l.id)}}})
 await prisma.zombieUniverse.deleteMany({where:{createdByUserId:users[0]}})
 await prisma.appUser.deleteMany({where:{id:{in:users}}})
 await prisma.$disconnect()
 }
})
