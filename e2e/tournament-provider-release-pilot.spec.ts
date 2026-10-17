/** Opt-in live-provider rehearsal. It publishes only on the isolated pilot database. */
import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/credentials-login'

test('approved NBA rules publish from live calendar and release an authenticated opening draft @db', async ({ browser, page }) => {
  test.skip(process.env.TOURNAMENT_PILOT_PROVIDER_BROWSER !== '1', 'Requires the isolated pilot DB and live NBA provider credentials')
  test.setTimeout(900_000)
  const { prisma } = require('../lib/prisma') as typeof import('../lib/prisma')
  const { nba2026PilotProposal } = require('../artifacts/tournament-nba-2026-pilot-proposal') as typeof import('../artifacts/tournament-nba-2026-pilot-proposal')
  const { joinSeasonTournament } = require('../lib/tournament/seasonRegistration') as typeof import('../lib/tournament/seasonRegistration')
  const target = new URL(process.env.DATABASE_URL ?? '')
  expect(target.hostname).toBe('ep-billowing-dream-b7cf9pxk-pooler.c-13.us-east-1.aws.neon.tech')
  expect(target.pathname).toBe('/tournament_pilot')
  expect(process.env.COMMISH_TENANT_ID).toBe('tournament-pilot')
  expect(process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED).toBe('true')
  expect((await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`)[0]?.database).toBe('tournament_pilot')

  const marker = `nba-provider-browser-${randomUUID()}`
  const ownerId = `${marker}-owner`
  const friendId = `${marker}-friend`
  const otherIds = Array.from({ length: 63 }, (_, i) => `${marker}-${String(i + 1).padStart(2, '0')}`)
  const password = randomBytes(24).toString('hex')
  const passwordHash = await bcrypt.hash(password, 6)
  await prisma.tenant.upsert({ where: { id: 'tournament-pilot' }, update: {}, create: { id: 'tournament-pilot', slug: 'tournament-pilot', name: 'Tournament Pilot' } })
  await prisma.appUser.createMany({ data: [ownerId, friendId, ...otherIds].map(id => ({ id, username: id, email: `${id}@example.invalid`, emailVerified: new Date(), passwordHash, displayName: id })) })
  await loginAs(page, `${ownerId}@example.invalid`, password)

  const config = nba2026PilotProposal()
  config.name = 'Isolated NBA Provider Draft Rehearsal'
  const saved = await page.request.post('/api/tournament/setup', { data: { action: 'save_blueprint', config } })
  expect(saved.ok(), `Save returned ${saved.status()}: ${await saved.text()}`).toBe(true)
  const tournamentId = (await saved.json() as { tournamentId: string }).tournamentId
  const revision = (await prisma.tournamentAuditLog.findFirstOrThrow({ where: { tournamentId, action: 'season_blueprint_created' } })).id
  const checked = await page.request.post('/api/tournament/setup', { data: { action: 'blueprint_check_calendar', tournamentId, revision }, timeout: 120_000 })
  expect(checked.ok(), `Calendar check returned ${checked.status()}: ${await checked.text()}`).toBe(true)
  const calendar = (await checked.json() as { calendar: { digest: string; ready: boolean; regularGames: number; pendingGames: number; excludedGames: unknown[] } }).calendar
  expect(calendar).toMatchObject({ ready: true, regularGames: 1200, pendingGames: 30 })
  expect(calendar.excludedGames).toHaveLength(56)
  await new Promise(resolve => setTimeout(resolve, 6_000))
  const published = await page.request.post('/api/tournament/setup', { data: {
    action: 'blueprint_publish_rules', tournamentId, revision, digest: calendar.digest,
    acceptExcludedGames: true, acceptPendingGames: true,
  }, timeout: 120_000 })
  expect(published.ok(), `Publication returned ${published.status()}: ${await published.text()}`).toBe(true)
  const { publicationId, hash } = await published.json() as { publicationId: string; hash: string }

  const opened = await page.request.post('/api/tournament/season-registration', { data: {
    action: 'open', tournamentId, publicationId, closesAt: '2026-10-19T16:00:00.000Z', waitlistLimit: 0,
  } })
  expect(opened.ok(), `Registration returned ${opened.status()}: ${await opened.text()}`).toBe(true)
  const invitePath = (await opened.json() as { invitePath: string }).invitePath
  const token = new URL(invitePath, 'http://localhost').searchParams.get('invite')!
  const friend = await browser.newPage()
  try {
    await loginAs(friend, `${friendId}@example.invalid`, password)
    await friend.goto(invitePath)
    await expect(friend.getByText('56 games excluded during scoring gaps')).toBeVisible()
    await expect(friend.getByText('30 NBA Cup-dependent games are pending.')).toBeVisible()
    await friend.getByLabel('I accept this published tournament rule version').check()
    const joinResponse = friend.waitForResponse(response => response.url().endsWith('/api/tournament/season-registration') && response.request().method() === 'POST')
    await friend.getByRole('button', { name: 'Join tournament' }).click()
    const joined = await joinResponse
    expect(joined.ok(), `Join returned ${joined.status()}: ${await joined.text()}`).toBe(true)
    for (const userId of otherIds) expect((await joinSeasonTournament(userId, tournamentId, token, publicationId, hash)).status).toBe('registered')

    const frozen = await page.request.post('/api/tournament/season-registration', { data: { action: 'freeze', tournamentId, publicationId } })
    expect(frozen.ok(), `Freeze returned ${frozen.status()}: ${await frozen.text()}`).toBe(true)
    const freezeId = (await frozen.json() as { freezeId: string }).freezeId
    for (let i = 0; i < 8; i++) {
      const provisioned = await page.request.post('/api/tournament/season-setup', { data: { action: 'provision', tournamentId, freezeId } })
      expect(provisioned.ok(), `Provision ${i + 1} returned ${provisioned.status()}: ${await provisioned.text()}`).toBe(true)
    }
    const setup = await page.request.get(`/api/tournament/season-setup?tournamentId=${encodeURIComponent(tournamentId)}`)
    expect(setup.ok()).toBe(true)
    const leagues = (await setup.json()).setup.leagues as Array<{ key: string; leagueId: string; draftReleased: boolean }>
    expect(leagues).toHaveLength(8)
    expect(leagues.every(league => !league.draftReleased)).toBe(true)

    await friend.reload()
    await friend.getByRole('button', { name: 'Reveal my league' }).click()
    await expect(friend.getByRole('link', { name: 'Open my draft room' })).toHaveCount(0)
    const assigned = await prisma.tournamentLeague.findFirstOrThrow({ where: { tournamentId, participants: { some: { userId: friendId } } } })
    const selected = leagues.find(league => league.leagueId === assigned.leagueId)!
    const released = await page.request.post('/api/tournament/season-setup', { data: {
      action: 'release_draft', tournamentId, freezeId, key: selected.key,
    }, timeout: 120_000 })
    expect(released.ok(), `Draft release returned ${released.status()}: ${await released.text()}`).toBe(true)
    expect((await released.json()).released).toBe(true)
    await friend.reload()
    await friend.getByRole('button', { name: 'Reveal my league' }).click()
    const link = friend.getByRole('link', { name: 'Open my draft room' })
    expect(assigned.draftSessionId).toBeTruthy()
    await expect(link).toHaveAttribute('href', `/drafts/${assigned.draftSessionId}`)
    await link.click()
    await expect(friend.getByTestId('draft-desktop-layout')).toBeVisible({ timeout: 120_000 })
    expect(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: 'season_opening_draft_released' } })).toBe(1)
  } finally {
    await friend.close()
    await prisma.$disconnect()
  }
})
