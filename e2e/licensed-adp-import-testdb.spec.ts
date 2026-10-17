import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { prisma } from '../lib/prisma'

const ADMIN_EMAIL = 'draft-admin-20260927@example.invalid'
test.use({ actionTimeout: 120_000, navigationTimeout: 300_000 })

test('admin validates a licensed export before an explicit import @db', async ({ page, request }) => {
  test.skip(process.env.AF_SEVEN_SPORT_DRAFT_TEST_DB !== '1', 'Explicit guarded test database run required')
  test.setTimeout(900_000)
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  if (process.env.ADMIN_EMAILS?.toLowerCase().split(/[,;\n\r]+/).map(value => value.trim()).includes(ADMIN_EMAIL) !== true) throw new Error('SYNTHETIC_ADMIN_ALLOWLIST_REQUIRED')

  const marker = randomUUID()
  const source = `ltest-${marker.replaceAll('-', '').slice(0, 24)}`
  const playerName = `Fixture Licensed Player ${marker}`
  const password = randomUUID()
  let userId: string | undefined
  let playerId: string | undefined
  try {
    const denied = await request.post('/api/admin/fantasy-data/adp-import', { data: {} })
    expect(denied.status()).toBe(401)
    const user = await prisma.appUser.create({ data: { username: `draft-admin-${marker}`, email: ADMIN_EMAIL, emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 6) } })
    userId = user.id
    await prisma.userProfile.upsert({ where: { userId }, update: { ageConfirmedAt: new Date() }, create: { userId, ageConfirmedAt: new Date() } })
    const player = await prisma.sportsPlayer.create({ data: { sport: 'NFL', source: 'licensed-export-browser', externalId: marker, name: playerName, position: 'WR', team: 'KC', expiresAt: new Date(Date.now() + 7 * 86400000) } })
    playerId = player.id
    const csrf = await (await page.request.get('/api/auth/csrf')).json()
    await page.request.post('/api/auth/callback/credentials?json=true', { form: { csrfToken: csrf.csrfToken, login: ADMIN_EMAIL, password, json: 'true' } })
    expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(userId)
    const board = {
      evidenceType: 'observed_drafts', licensedForUse: true, sport: 'NFL', source,
      season: new Date().getFullYear(), format: 'redraft', scoring: 'PPR', asOf: new Date().toISOString(),
      players: [{ canonicalPlayerId: playerId, providerPlayerId: `provider-${marker}`, playerName, position: 'WR', team: 'KC', adp: 12.5, draftSampleSize: 40 }],
    }
    await page.goto('/admin/adp-import', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /licensed.*ADP|ADP.*import/i })).toBeVisible({ timeout: 120_000 })
    await page.getByLabel('JSON export file').setInputFiles({ name: 'synthetic-licensed-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(board)) })
    await expect(page.getByLabel('Export JSON')).toHaveValue(new RegExp(`provider-${marker}`), { timeout: 120_000 })
    const previewPromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/fantasy-data/adp-import' && response.request().method() === 'POST', { timeout: 300_000 })
    await page.getByRole('button', { name: 'Validate export' }).click()
    const preview = await previewPromise
    expect(preview.status(), await preview.text()).toBe(200)
    expect(await preview.json()).toMatchObject({ dryRun: true, accepted: 1, source })
    expect(await prisma.adpDataRecord.count({ where: { source, playerId } })).toBe(0)
    expect(await prisma.adpRefreshRun.count({ where: { trigger: 'licensed_market_export', qualitySummary: { path: ['source'], equals: source } } })).toBe(0)
    await expect(page.getByRole('status')).toContainText('No data has been written')
    const importPromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/fantasy-data/adp-import' && response.request().method() === 'POST', { timeout: 300_000 })
    await page.getByRole('button', { name: 'Import validated export' }).click()
    const imported = await importPromise
    expect(imported.status(), await imported.text()).toBe(200)
    expect(await imported.json()).toMatchObject({ dryRun: false, accepted: 1, source })
    await expect(page.getByRole('status')).toContainText('Imported 1')
    const rows = await prisma.adpDataRecord.findMany({ where: { source, playerId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sport: 'NFL', format: 'redraft', scoring: 'PPR', adp: 12.5 })
    expect(rows[0]!.createdAt.toISOString()).toBe(board.asOf)
    expect(await prisma.adpRefreshRun.count({ where: { trigger: 'licensed_market_export', qualitySummary: { path: ['source'], equals: source } } })).toBe(1)
  } finally {
    if (playerId) {
      await prisma.adpDataRecord.deleteMany({ where: { source, playerId } })
      await prisma.adpRefreshRun.deleteMany({ where: { trigger: 'licensed_market_export', qualitySummary: { path: ['source'], equals: source } } })
      await prisma.sportsPlayer.deleteMany({ where: { id: playerId, source: 'licensed-export-browser' } })
    }
    if (userId) {
      await prisma.analyticsEvent.deleteMany({ where: { userId } })
      await prisma.appUser.deleteMany({ where: { id: userId } })
    }
    if (playerId) {
      expect(await prisma.adpDataRecord.count({ where: { source } })).toBe(0)
      expect(await prisma.adpRefreshRun.count({ where: { trigger: 'licensed_market_export', qualitySummary: { path: ['source'], equals: source } } })).toBe(0)
    }
    await prisma.$disconnect()
  }
})
