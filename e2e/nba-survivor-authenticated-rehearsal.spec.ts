/** Opt-in, real-route browser rehearsal against an allowlisted non-production database. */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { resolveDraftPoolCacheContext } from '../lib/draft-room/ensureDraftPoolReady'
import { loadNbaSurvivorRosterEligibility } from '../lib/draft-room/nbaSurvivorRosterEligibility'
import { canonicalName } from '../lib/draft-room/player-canonical-identity'
import { normalizePlayerList } from '../lib/draft-asset-pipeline'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

async function signIn(page: Page, email: string, password: string, userId: string) {
  const csrf = await (await page.request.get('/api/auth/csrf')).json()
  const response = await page.request.post('/api/auth/callback/credentials?json=true', {
    form: { csrfToken: csrf.csrfToken, login: email, password, json: 'true' },
  })
  expect(response.ok()).toBeTruthy()
  await expect.poll(async () => (await (await page.request.get('/api/auth/session')).json()).user?.id).toBe(userId)
}

test('two signed-in NBA Survivor managers see draft controls and private idol notices @db', async ({ browser, page }) => {
  test.skip(process.env.AF_NBA_SURVIVOR_BROWSER_DB !== '1', 'Explicit isolated database opt-in required')
  test.setTimeout(900_000)
  const identity = createRequire(import.meta.url)('../scripts/db-target-identity.cjs')
  if (identity.identifyTarget(process.env.DATABASE_URL).kind !== 'safe') throw new Error('ALLOWLISTED_TEST_DATABASE_REQUIRED')
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('SHARED_REDIS_MUST_BE_DISABLED')
  }
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = `nba-browser-${randomUUID().slice(0, 8)}`
  const userIds = Array.from({ length: 20 }, (_, index) => `${marker}-u${index + 1}`)
  const password = randomUUID()
  const passwordHash = await bcrypt.hash(password, 6)
  let leagueId: string | null = null
  const manager = await browser.newContext()
  const managerPage = await manager.newPage()
  try {
    await prisma.appUser.createMany({ data: userIds.map((id, index) => ({
      id, username: id, email: `${id}@example.invalid`, displayName: `Browser Manager ${index + 1}`,
      emailVerified: new Date(), passwordHash: index < 2 ? passwordHash : null,
    })) })
    const validated = validateCreatePayload({
      concept: 'survivor', sport: 'NBA', teamCount: 20, draftType: 'snake', scoringPreset: 'nba_points',
      leagueName: `${marker} Survivor`, timezone: 'America/New_York',
      conceptSetup: { commissionerParticipationMode: 'participating_player', survivorTribeCount: 4 },
    })
    expect(validated.ok).toBeTruthy()
    if (!validated.ok) throw new Error('Invalid test league')
    const preset = runPresetEngine({ ...validated.data, commissionerId: userIds[0] })
    leagueId = (await prisma.$transaction(
      tx => createCanonicalLeagueInTransaction(tx, userIds[0], validated.data, preset),
      { timeout: 120_000 },
    )).leagueId
    const rosters = await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } })
    expect(rosters).toHaveLength(20)
    rosters.sort((a, b) => Number(b.platformUserId === userIds[0]) - Number(a.platformUserId === userIds[0]))
    for (let i = 0; i < rosters.length; i++) {
      await prisma.roster.update({ where: { id: rosters[i].id }, data: { platformUserId: userIds[i] } })
      await prisma.leagueTeam.updateMany({ where: { leagueId, externalId: rosters[i].id }, data: {
        platformUserId: userIds[i], claimedByUserId: userIds[i], isOrphan: false,
        ownerName: `Browser Manager ${i + 1}`, teamName: `Browser Team ${i + 1}`,
      } })
    }
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    await prisma.draftSession.update({ where: { id: draft.id }, data: {
      slotOrder: rosters.map((row, index) => ({ slot: index + 1, rosterId: row.id, displayName: `Browser Team ${index + 1}` })),
      // Route compilation and two browser reconnects can exceed a normal pick
      // clock in this opt-in rehearsal. The pause/resume state is still tested.
      timerSeconds: 3600,
    } })
    await prisma.leagueSettings.update({ where: { leagueId }, data: {
      draftOrderLocked: true, pickTimerPreset: 'custom', pickTimerCustomValue: 3600,
    } })

    // Use the already-copied NBA player rows on this isolated branch; no provider calls.
    const eligibility = await loadNbaSurvivorRosterEligibility(240)
    expect(eligibility.ready, eligibility.reason).toBeTruthy()
    const rows = await prisma.sportsPlayer.findMany({ where: {
      sport: 'NBA', source: 'thesportsdb', status: 'Active',
      fetchedAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) }, expiresAt: { gt: new Date() },
      team: { not: null }, position: { in: ['PG', 'SG', 'SF', 'PF', 'C'] },
    }, orderBy: { name: 'asc' } })
    const seen = new Set<string>()
    const players = rows.filter(row => {
      const key = canonicalName(row.name)
      if (seen.has(key) || !eligibility.eligibleNames.has(key)) return false
      seen.add(key)
      return true
    })
    expect(players.length).toBeGreaterThanOrEqual(240)
    const cache = await resolveDraftPoolCacheContext(leagueId)
    const entries = normalizePlayerList(players.map((row, index) => ({
      playerId: row.id, name: row.name, position: row.position, team: row.team, adp: index + 1,
      imageUrl: row.imageUrl,
    })), 'NBA')
    await prisma.draftPoolCache.create({ data: {
      leagueId, cacheKey: cache.standardCacheKey, sourceFingerprint: cache.rosterFp,
      entryCount: entries.length, sport: 'NBA', poolType: 'pro', expiresAt: new Date(Date.now() + 3_600_000),
      payload: { entries, sport: 'NBA', count: entries.length, rosterConfigurationIncomplete: false },
    } })
    console.log('NBA browser fixture: 20 seats and local NBA pool ready')

    await signIn(page, `${userIds[0]}@example.invalid`, password, userIds[0])
    await signIn(managerPage, `${userIds[1]}@example.invalid`, password, userIds[1])
    console.log('NBA browser fixture: two distinct signed-in sessions')
    const draftDate = new Date(Date.now() + 86_400_000).toISOString()
    const schedule = await page.request.patch(`/api/leagues/${leagueId}/draft/settings`, { data: { draftDate } })
    expect(schedule.ok(), await schedule.text()).toBeTruthy()
    expect((await prisma.leagueSettings.findUniqueOrThrow({ where: { leagueId } })).draftDateUtc?.toISOString()).toBe(draftDate)
    expect((await managerPage.request.patch(`/api/leagues/${leagueId}/draft/settings`, { data: { draftDate } })).status()).toBe(403)
    console.log('NBA browser: schedule saved; manager edit rejected')

    const draftUrl = `/drafts/${draft.id}`
    await Promise.all([
      page.goto(draftUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 }),
      managerPage.goto(draftUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 }),
    ])
    await expect(page.getByTestId('draft-desktop-layout')).toBeVisible()
    await expect(managerPage.getByTestId('draft-desktop-layout')).toBeVisible()
    const managerBoard = managerPage.getByTestId('draft-desktop-layout')
    await expect(managerBoard.getByTestId('draft-board-cell-1')).toBeVisible()
    await expect(managerPage.getByTestId('draft-board-cell-commish-edit-1')).toHaveCount(0)
    console.log('NBA browser: both draft boards rendered; manager editor hidden')

    const start = await page.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'start' } })
    expect(start.ok(), await start.text()).toBeTruthy()
    expect((await managerPage.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'pause' } })).status()).toBe(403)
    const pause = await page.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'pause' } })
    expect(pause.ok(), await pause.text()).toBeTruthy()
    expect((await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('paused')
    await managerPage.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
    await expect(managerPage.getByTestId('draft-paused-room-banner')).toBeVisible()
    const resume = await page.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'resume' } })
    expect(resume.ok(), await resume.text()).toBeTruthy()
    expect((await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('in_progress')
    const managerSession = await (await managerPage.request.get(`/api/leagues/${leagueId}/draft/session`)).json()
    expect(managerSession.session?.status).toBe('in_progress')
    console.log('NBA browser: pause, reconnect, resume and manager session state verified')

    const idolPlayer = players.find(row => row.position === 'PG')!
    const secretText = `${marker} private idol notice`
    await prisma.leagueChatMessage.create({ data: {
      leagueId, userId: userIds[0], message: secretText, type: 'system',
      isPrivate: true, visibleToUserId: userIds[1], messageSubtype: 'chimmy_private',
      metadata: { chimmyPrivateReply: true, survivorIdolReveal: true, playerId: idolPlayer.id, playerName: idolPlayer.name, playerImageUrl: idolPlayer.imageUrl },
    } })
    const ownChatResponse = await managerPage.request.get(`/api/league/chat?leagueId=${leagueId}`)
    const commissionerChatResponse = await page.request.get(`/api/league/chat?leagueId=${leagueId}`)
    expect(ownChatResponse.ok()).toBeTruthy()
    expect(commissionerChatResponse.ok()).toBeTruthy()
    const ownChat = await ownChatResponse.json()
    const commissionerChat = await commissionerChatResponse.json()
    expect(JSON.stringify(ownChat.messages)).toContain(secretText)
    expect(JSON.stringify(commissionerChat.messages)).not.toContain(secretText)
    expect(JSON.stringify(commissionerChat.messages)).not.toContain(idolPlayer.id)
    console.log('NBA browser: owner-only idol notice hidden from playing commissioner')
  } finally {
    await manager.close()
    if (leagueId) {
      await prisma.analyticsEvent.deleteMany({ where: { OR: [{ meta: { path: ['leagueId'], equals: leagueId } }, { userId: { in: userIds } }] } })
      await prisma.automationLock.deleteMany({ where: { lockKey: `draft:${leagueId}:pick` } })
      await prisma.league.deleteMany({ where: { id: leagueId } })
    }
    await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
  }
})
