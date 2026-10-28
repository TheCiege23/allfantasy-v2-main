/** Four-sport native Zombie rehearsal on the disposable CI database. Synthetic scores exercise settlement, not provider calibration. */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
import { syncCompletedDraftToRedraftSeason } from '../lib/redraft/finalizeDraftToRedraftSeason'
import { ensureZombieSeasonActivated } from '../lib/zombie/activateNativeZombieLeague'
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
      passwordHash: i === 0 ? passwordHash : null,
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
      await prisma.zombieLeague.update({ where: { id: zombie.id }, data: {
        whispererCount: whisperers, weeklyUpdateAutoPost: true,
        weeklyUpdateApproval: false, weeklyUpdateDay: null, weeklyUpdateHour: null,
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
        data: { status: 'Zombie', weekBecameZombie: week, killedByRosterId: hordeRoster.id },
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

      if (sport === 'NFL') {
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
