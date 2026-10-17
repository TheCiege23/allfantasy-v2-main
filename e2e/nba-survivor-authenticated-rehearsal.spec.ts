/** Opt-in, real-route browser rehearsal against an allowlisted non-production database. */
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import { identifyTarget } from '../scripts/db-target-identity.cjs'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { resolveDraftPoolCacheContext } from '../lib/draft-room/ensureDraftPoolReady'
import { loadNbaSurvivorRosterEligibility } from '../lib/draft-room/nbaSurvivorRosterEligibility'
import { canonicalName } from '../lib/draft-room/player-canonical-identity'
import { normalizePlayerList } from '../lib/draft-asset-pipeline'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
import { getSurvivorConfig, upsertSurvivorConfig } from '../lib/survivor/SurvivorLeagueConfig'
import { firstEntryIntroStorageKey } from '../lib/league/post-create-welcome'

async function signIn(page: Page, email: string, password: string, userId: string) {
  const csrf = await (await page.request.get('/api/auth/csrf')).json()
  const response = await page.request.post('/api/auth/callback/credentials?json=true', {
    form: { csrfToken: csrf.csrfToken, login: email, password, json: 'true' },
  })
  expect(response.ok()).toBeTruthy()
  await expect.poll(async () => (await (await page.request.get('/api/auth/session')).json()).user?.id).toBe(userId)
}

function seedPick(args: { leagueId: string; userId: string; rosterId: string; playerId: string; playerName: string; position: string; team: string | null; overall: number }) {
  execFileSync(process.execPath, [
    '--conditions=react-server', '--import', 'tsx', resolve(__dirname, '../scripts/seed-nba-survivor-browser-pick.ts'),
    args.leagueId, args.userId, args.rosterId, args.playerId, args.playerName, args.position, args.team ?? '', String(args.overall),
  ], { env: process.env, stdio: 'pipe', timeout: 180_000 })
}

test('two signed-in NBA Survivor managers verify pick correction and private idol vault @db', async ({ browser, page }) => {
  test.skip(process.env.AF_NBA_SURVIVOR_BROWSER_DB !== '1', 'Explicit isolated database opt-in required')
  test.setTimeout(1_800_000)
  if (identifyTarget(process.env.DATABASE_URL).kind !== 'safe') throw new Error('ALLOWLISTED_TEST_DATABASE_REQUIRED')
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
    await upsertSurvivorConfig(leagueId, {
      tribeCount: 4, tribeSize: 5, idolCount: 7, exileReturnEnabled: true,
      mergeTrigger: 'player_count', mergePlayerCount: 10,
    })
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
    const firstPlayer = players.find(row => row.position === 'PG')!
    const replacement = players.find(row => row.position === 'PG' && row.id !== firstPlayer.id)!
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
    page.on('response', response => {
      if (response.url().includes('/draft/commissioner/pick-edit')) {
        console.log(`NBA browser: commissioner edit HTTP ${response.status()}`)
      }
    })
    // Age confirmation is a separate onboarding flow. Keep its optional
    // one-session prompt from covering draft controls in this fixture.
    await Promise.all([page, managerPage].map((viewer, index) => viewer.addInitScript(({ introKey }) => {
      sessionStorage.setItem('af_age_prompt_dismissed', '1')
      localStorage.setItem(introKey, '1')
    }, { introKey: firstEntryIntroStorageKey('survivor', leagueId!, userIds[index]) })))
    console.log('NBA browser fixture: two distinct signed-in sessions')
    const poolResponse = await page.request.get(`/api/leagues/${leagueId}/draft/pool`, { timeout: 120_000 })
    expect(poolResponse.ok()).toBeTruthy()
    const poolPayload = await poolResponse.json()
    expect(poolPayload.entries).toContainEqual(expect.objectContaining({ playerId: replacement.id }))
    console.log('NBA browser fixture: draft pool API contains replacement player')
    const draftDate = new Date(Date.now() + 86_400_000).toISOString()
    const schedule = await page.request.patch(`/api/leagues/${leagueId}/draft/settings`, { data: { draftDate } })
    expect(schedule.ok(), await schedule.text()).toBeTruthy()
    expect((await prisma.leagueSettings.findUniqueOrThrow({ where: { leagueId } })).draftDateUtc?.toISOString()).toBe(draftDate)
    expect((await managerPage.request.patch(`/api/leagues/${leagueId}/draft/settings`, { data: { draftDate } })).status()).toBe(403)
    console.log('NBA browser: schedule saved; manager edit rejected')

    const draftUrl = `/drafts/${draft.id}`
    await page.goto(draftUrl, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    await managerPage.goto(draftUrl, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    await expect(page.getByTestId('draft-desktop-layout')).toBeVisible()
    await expect(managerPage.getByTestId('draft-desktop-layout')).toBeVisible()
    await expect(page.getByTestId('draft-pool-loading-message')).toHaveCount(0, { timeout: 120_000 })
    await expect(managerPage.getByTestId('draft-pool-loading-message')).toHaveCount(0, { timeout: 120_000 })
    console.log('NBA browser: player pool loaded in both draft boards')
    const managerBoard = managerPage.getByTestId('draft-desktop-layout')
    await expect(managerBoard.getByTestId('draft-board-cell-1')).toBeVisible()
    await expect(managerPage.getByTestId('draft-board-cell-commish-edit-1')).toHaveCount(0)
    const initialManagerSync = await managerPage.request.get(`/api/leagues/${leagueId}/draft/live-sync?queue=0&chat=0`, { timeout: 120_000 })
    expect(initialManagerSync.ok()).toBeTruthy()
    console.log('NBA browser: both draft boards rendered; manager editor hidden')

    const start = await page.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'start' }, timeout: 120_000 })
    expect(start.ok(), await start.text()).toBeTruthy()
    console.log('NBA browser: draft started')
    seedPick({ leagueId, userId: userIds[0], rosterId: rosters[0].id,
      playerId: firstPlayer.id, playerName: firstPlayer.name, position: 'PG', team: firstPlayer.team, overall: 1 })
    console.log('NBA browser: first pick seeded through draft service')
    expect((await managerPage.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'pause' }, timeout: 120_000 })).status()).toBe(403)
    const pause = await page.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'pause' }, timeout: 120_000 })
    expect(pause.ok(), await pause.text()).toBeTruthy()
    expect((await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('paused')
    console.log('NBA browser: draft paused')
    const pausedManagerSync = await managerPage.request.get(`/api/leagues/${leagueId}/draft/live-sync?queue=0&chat=0`, { timeout: 120_000 })
    expect(pausedManagerSync.ok()).toBeTruthy()
    expect((await pausedManagerSync.json()).session?.status).toBe('paused')
    console.log('NBA browser: manager live-sync API sees paused state')
    await expect(managerPage.getByTestId('draft-paused-room-banner')).toBeVisible({ timeout: 90_000 })
    console.log('NBA browser: manager saw paused state through live sync')
    const forbiddenCorrection = await managerPage.request.post(`/api/leagues/${leagueId}/draft/commissioner/pick-edit`, {
      data: { action: 'REPLACE_PLAYER_ON_PICK', overallPickNumber: 1, playerId: replacement.id,
        playerName: replacement.name, position: 'PG', team: replacement.team, reason: 'Unauthorized rehearsal' },
    })
    expect(forbiddenCorrection.status()).toBe(403)
    console.log('NBA browser: manager pick correction rejected')
    const firstCell = page.getByTestId('draft-premium-board-zone').getByTestId('draft-board-cell-1')
    await expect(firstCell).toContainText(firstPlayer.name, { timeout: 90_000 })
    console.log('NBA browser: commissioner board updated through live sync')
    console.log('NBA browser: waiting for commissioner edit button hydration')
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="draft-premium-board-zone"] [data-testid="draft-board-cell-commish-edit-1"]')
      if (!button) return false
      const reactPropsKey = Object.keys(button).find(key => key.startsWith('__reactProps$'))
      return Boolean(reactPropsKey && typeof (button as unknown as Record<string, { onClick?: unknown }>)[reactPropsKey]?.onClick === 'function')
    }, null, { timeout: 60_000 })
    console.log('NBA browser: commissioner edit button hydrated')
    const editButton = firstCell.getByTestId('draft-board-cell-commish-edit-1')
    await editButton.focus({ timeout: 20_000 })
    await expect(editButton).toBeFocused()
    console.log('NBA browser: commissioner edit button focused')
    await editButton.press('Enter', { timeout: 20_000 })
    console.log('NBA browser: commissioner edit button activated by keyboard')
    const editor = page.getByTestId('draft-commish-edit-overlay')
    await expect(editor.getByTestId('commish-edit-panel')).toBeVisible({ timeout: 30_000 })
    console.log('NBA browser: commissioner editor visible')
    await editor.getByTestId('commish-edit-action').selectOption('REPLACE_PLAYER_ON_PICK', { timeout: 20_000 })
    console.log('NBA browser: replacement action selected')
    await expect(editor.getByTestId('commish-edit-overall')).toHaveValue('1')
    await editor.getByTestId('commish-edit-player-search').fill(replacement.name, { timeout: 20_000 })
    console.log('NBA browser: replacement player searched')
    await expect(editor.getByTestId('commish-edit-player-result-count')).not.toHaveText('No matches.', { timeout: 30_000 })
    await editor.getByTestId('commish-edit-player').selectOption(replacement.id, { timeout: 20_000 })
    console.log('NBA browser: replacement player selected')
    await editor.getByTestId('commish-edit-reason').fill('Correct an incorrect commissioner pick', { timeout: 20_000 })
    console.log('NBA browser: correction reason entered')
    await editor.getByTestId('commish-edit-submit').click({ timeout: 20_000 })
    console.log('NBA browser: correction submitted')
    await expect(editor.getByTestId('commish-edit-self-benefit')).toBeVisible({ timeout: 120_000 })
    await editor.getByTestId('commish-edit-self-benefit-confirm').click({ timeout: 20_000 })
    await expect(editor.getByTestId('commish-edit-success')).toContainText('Pick updated', { timeout: 120_000 })
    await expect.poll(async () => (await prisma.draftPick.findFirstOrThrow({ where: { sessionId: draft.id, overall: 1 } })).playerId).toBe(replacement.id)
    const correctionAudit = await prisma.draftPickAuditLog.findFirstOrThrow({ where: {
      draftSessionId: draft.id, overallPickNumber: 1, action: 'REPLACE_PLAYER_ON_PICK',
    } })
    expect(correctionAudit.actorUserId).toBe(userIds[0])
    expect(correctionAudit.reason).toBe('Correct an incorrect commissioner pick')
    await expect(firstCell).toContainText(replacement.name)
    console.log('NBA browser: commissioner corrected own pick in UI; manager denied; audit persisted')
    const resume = await page.request.post(`/api/leagues/${leagueId}/draft/controls`, { data: { action: 'resume' }, timeout: 120_000 })
    expect(resume.ok(), await resume.text()).toBeTruthy()
    expect((await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('in_progress')
    const managerSession = await (await managerPage.request.get(`/api/leagues/${leagueId}/draft/session`)).json()
    expect(managerSession.session?.status).toBe('in_progress')
    console.log('NBA browser: pause, reconnect, resume and manager session state verified')

    const idolPlayer = players.find(row => row.id !== firstPlayer.id && row.id !== replacement.id && row.imageUrl)!
    expect(idolPlayer?.imageUrl).toBeTruthy()
    seedPick({ leagueId, userId: userIds[1], rosterId: rosters[1].id,
      playerId: idolPlayer.id, playerName: idolPlayer.name, position: idolPlayer.position!, team: idolPlayer.team, overall: 2 })
    const survivorConfig = await getSurvivorConfig(leagueId)
    expect(survivorConfig?.configId).toBeTruthy()
    const ownerIdol = await prisma.survivorIdol.create({ data: {
      leagueId, configId: survivorConfig!.configId, rosterId: rosters[1].id,
      playerId: idolPlayer.id, powerType: 'protect_self', status: 'hidden',
      currentOwnerUserId: userIds[1], originalOwnerUserId: userIds[1],
    } })
    const ownerSummaryResponse = await managerPage.request.get(`/api/leagues/${leagueId}/survivor/summary`)
    const commissionerSummaryResponse = await page.request.get(`/api/leagues/${leagueId}/survivor/summary`)
    expect(ownerSummaryResponse.ok()).toBeTruthy()
    expect(commissionerSummaryResponse.ok()).toBeTruthy()
    const ownerSummary = await ownerSummaryResponse.json()
    const commissionerSummary = await commissionerSummaryResponse.json()
    expect(ownerSummary.myIdols).toContainEqual(expect.objectContaining({
      id: ownerIdol.id, playerId: idolPlayer.id, playerName: idolPlayer.name, playerImageUrl: idolPlayer.imageUrl,
    }))
    expect(commissionerSummary.myIdols).not.toContainEqual(expect.objectContaining({ id: ownerIdol.id }))
    expect(JSON.stringify(commissionerSummary)).not.toContain(ownerIdol.id)
    console.log('NBA browser: private idol summary contains owner headshot, sealed from playing commissioner')

    const survivorUrl = `/league/${leagueId}?view=survivor`
    // The first native league render compiles a large route in next dev. Loading
    // the two authenticated sessions serially avoids making both wait on that
    // cold compile while the draft room is still mounted in each browser.
    await page.goto(survivorUrl, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    await managerPage.goto(survivorUrl, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    for (const viewer of [page, managerPage]) {
      const idolTab = viewer.getByRole('button', { name: 'Idols & Advantages' })
      await expect(idolTab).toBeVisible({ timeout: 120_000 })
      await idolTab.click()
    }
    const ownerVault = managerPage.getByRole('heading', { name: 'Your idols & advantages' }).locator('..')
    const commissionerVault = page.getByRole('heading', { name: 'Your idols & advantages' }).locator('..')
    await expect(ownerVault).toContainText(idolPlayer.name)
    await expect(ownerVault.getByRole('img', { name: `${idolPlayer.name} headshot` })).toBeVisible()
    await expect(commissionerVault).toContainText('You have no active idols')
    await expect(commissionerVault).not.toContainText(idolPlayer.name)
    console.log('NBA browser: owner-only idol vault shows attached player headshot; playing commissioner sees no private idol')

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
    console.log('NBA browser: cleaning isolated fixture')
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
