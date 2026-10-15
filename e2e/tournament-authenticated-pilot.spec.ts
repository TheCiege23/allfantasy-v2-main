/** Signed-in invite rehearsal against the exact isolated tournament pilot database. */
import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { nba2026PilotProposal } from '../artifacts/tournament-nba-2026-pilot-proposal'
import { seasonContractHash } from '../lib/tournament/seasonCalendarVerification'
import { joinSeasonTournament } from '../lib/tournament/seasonRegistration'
import { loginAs } from './helpers/credentials-login'

test('signed-in NBA invite joins, freezes and provisions eight draft-locked leagues @db', async ({ browser, page, request }) => {
  test.skip(process.env.TOURNAMENT_PILOT_BROWSER !== '1', 'Requires the guarded isolated pilot database')
  test.setTimeout(900_000)
  const target = new URL(process.env.DATABASE_URL ?? '')
  expect(target.hostname).toBe('ep-billowing-dream-b7cf9pxk-pooler.c-13.us-east-1.aws.neon.tech')
  expect(target.pathname).toBe('/tournament_pilot')
  expect(process.env.COMMISH_TENANT_ID).toBe('tournament-pilot')
  expect((await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`)[0]?.database).toBe('tournament_pilot')

  const marker = `nba-invite-browser-${randomUUID()}`
  const tournamentId = marker
  const ownerId = `${marker}-owner`
  const friendId = `${marker}-friend`
  const otherIds = Array.from({ length: 63 }, (_, i) => `${marker}-${String(i + 1).padStart(2, '0')}`)
  const password = randomBytes(24).toString('hex')
  const passwordHash = await bcrypt.hash(password, 6)
  const config = nba2026PilotProposal()
  config.name = 'Synthetic NBA Invite Rehearsal'
  const hash = seasonContractHash({ config, calendarDigest: 'browser-rehearsal-only', acceptExcludedGames: true, acceptPendingGames: true })
  await prisma.tenant.upsert({ where: { id: 'tournament-pilot' }, update: {}, create: { id: 'tournament-pilot', slug: 'tournament-pilot', name: 'Tournament Pilot' } })
  await prisma.appUser.createMany({ data: [ownerId, friendId, ...otherIds].map(id => ({ id, username: id, email: `${id}@example.invalid`, emailVerified: new Date(), passwordHash, displayName: id })) })
  await prisma.tournamentShell.create({ data: { id: tournamentId, name: config.name, sport: 'NBA', status: 'rules_published', maxParticipants: 64, openingWeekStart: 1, commissionerId: ownerId, createdBy: ownerId } })
  const publication = await prisma.tournamentAuditLog.create({ data: {
    tournamentId, action: 'season_rules_published', actorType: 'commissioner', actorId: ownerId,
    targetType: 'tournament', targetId: tournamentId,
    data: { version: 1, sourceRevision: 'browser-rehearsal-only', config, hash,
      calendar: { digest: 'browser-rehearsal-only', checkedAt: new Date().toISOString(), regularGames: 0, pendingGames: 30, excludedGames: [] },
      acceptExcludedGames: true, acceptPendingGames: true },
  } })

  expect((await request.post('/api/tournament/season-registration', { data: { action: 'freeze', tournamentId, publicationId: publication.id } })).status()).toBe(401)
  await loginAs(page, `${ownerId}@example.invalid`, password)
  const opened = await page.request.post('/api/tournament/season-registration', { data: {
    action: 'open', tournamentId, publicationId: publication.id, closesAt: '2026-10-19T16:00:00.000Z', waitlistLimit: 0,
  } })
  expect(opened.ok(), await opened.text()).toBe(true)
  const invitePath = (await opened.json() as { invitePath: string }).invitePath
  const token = new URL(invitePath, 'http://localhost').searchParams.get('invite')!
  expect(token).toMatch(/^[a-f0-9]{64}$/)

  const friend = await browser.newPage()
  try {
    await loginAs(friend, `${friendId}@example.invalid`, password)
    await friend.goto(invitePath)
    await expect(friend.getByRole('heading', { name: 'Synthetic NBA Invite Rehearsal' })).toBeVisible()
    const join = friend.getByRole('button', { name: 'Join tournament' })
    await expect(join).toBeDisabled()
    await friend.getByLabel('I accept this published tournament rule version').check()
    const joinResponse = friend.waitForResponse(response => response.url().endsWith('/api/tournament/season-registration') && response.request().method() === 'POST')
    await join.click()
    const joined = await joinResponse
    expect(joined.ok(), `Join returned ${joined.status()}: ${await joined.text()}`).toBe(true)
    await expect.poll(async () => prisma.tournamentParticipant.count({ where: { tournamentId, userId: friendId, status: 'registered' } })).toBe(1)
    for (const userId of otherIds) expect((await joinSeasonTournament(userId, tournamentId, token, publication.id, hash)).status).toBe('registered')

    const board = await page.request.get(`/api/tournament/season-registration?tournamentId=${encodeURIComponent(tournamentId)}`)
    expect(board.ok(), await board.text()).toBe(true)
    expect((await board.json()).board).toMatchObject({ capacity: 64, registered: 64, waitlisted: 0, fullField: true })
    const frozen = await page.request.post('/api/tournament/season-registration', { data: { action: 'freeze', tournamentId, publicationId: publication.id } })
    expect(frozen.ok(), await frozen.text()).toBe(true)
    const freezeId = (await frozen.json() as { freezeId: string }).freezeId
    for (let i = 0; i < 8; i++) {
      const provisioned = await page.request.post('/api/tournament/season-setup', { data: { action: 'provision', tournamentId, freezeId } })
      expect(provisioned.ok(), await provisioned.text()).toBe(true)
      expect((await provisioned.json()).completed).toBe(i + 1)
    }
    expect(await prisma.tournamentLeague.count({ where: { tournamentId } })).toBe(8)
    expect(await prisma.draftSession.count({ where: { leagueId: { in: (await prisma.tournamentLeague.findMany({ where: { tournamentId }, select: { leagueId: true } })).flatMap(row => row.leagueId ? [row.leagueId] : []) }, status: 'tournament_setup_blocked' } })).toBe(8)

    await friend.reload()
    await expect(friend.getByRole('button', { name: 'Reveal my league' })).toBeVisible()
    await friend.getByRole('button', { name: 'Reveal my league' }).click()
    await expect(friend.getByRole('link', { name: 'Open my draft room' })).toHaveCount(0)
    const setup = await page.request.get(`/api/tournament/season-setup?tournamentId=${encodeURIComponent(tournamentId)}`)
    expect(setup.ok(), await setup.text()).toBe(true)
    const leagues = (await setup.json()).setup.leagues as Array<{ key: string; state: string; draftReleased: boolean }>
    expect(leagues).toHaveLength(8)
    expect(leagues.every(league => league.state === 'created' && !league.draftReleased)).toBe(true)
    const release = await page.request.post('/api/tournament/season-setup', { data: { action: 'release_draft', tournamentId, freezeId, key: leagues[0]!.key } })
    expect(release.status()).toBe(409)
    expect(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: 'season_opening_draft_released' } })).toBe(0)
  } finally {
    await friend.close()
    await prisma.$disconnect()
  }
})
