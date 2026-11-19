import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { prisma } from '../lib/prisma'

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const

function requireIsolatedStaging() {
  test.skip(process.env.AF_LOCAL_LEAGUE_RUNTIME !== '1', 'Explicit local staging run required')
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
  if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.pathname !== '/allfantasy_staging') {
    throw new Error('This test only writes to the isolated loopback allfantasy_staging database.')
  }
}

test('authenticated league creation persists each sport, format, draft, seats, and draft board @local-staging', async ({ page }) => {
  requireIsolatedStaging()
  test.setTimeout(900_000)

  const creatorUserId = `league-staging-${randomUUID()}`
  await signInAs(page, { id: creatorUserId, name: 'League staging commissioner' })
  let sourceLeagueId = ''

  for (const sport of SPORTS) {
    const scoringPreset = LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport.redraft[sport]?.[0]
    expect(scoringPreset).toBeTruthy()
    const response = await page.request.post('/api/leagues', {
      data: {
        concept: 'redraft', sport, teamCount: 4, draftType: 'snake', scoringPreset,
        leagueName: `Staging ${sport} ${randomUUID().slice(0, 8)}`,
        ...(sport === 'SOCCER' ? { soccerPipeline: 'euro' } : {}),
      },
      timeout: 180_000,
    })
    const body = await response.json()
    expect(response.status(), `${sport}: ${JSON.stringify(body)}`).toBe(200)
    const leagueId = body.league.id as string
    if (sport === 'NFL') sourceLeagueId = leagueId
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
    const settings = league.settings as Record<string, unknown>
    expect(String(league.sport)).toBe(sport)
    expect(league.leagueType).toBe('redraft')
    expect(settings.requested_draft_type).toBe('snake')
    expect(await prisma.leagueEntrySlot.count({ where: { leagueId } })).toBe(4)
    expect(await prisma.draftSession.count({ where: { leagueId } })).toBeGreaterThan(0)
  }

  // Use an isolated Sleeper fixture to exercise the actual standalone carryover route.
  const friendUserId = `league-staging-friend-${randomUUID()}`
  const friend = await page.request.put('/api/e2e/run-relay', {
    headers: { 'x-allfantasy-e2e': '1' },
    data: { id: friendUserId, email: `${friendUserId}@allfantasy.test`, name: 'Imported friend', username: friendUserId },
  })
  expect(friend.ok()).toBeTruthy()
  const seats = await prisma.leagueEntrySlot.findMany({ where: { leagueId: sourceLeagueId }, orderBy: { slotNumber: 'asc' } })
  const sourcePlayerIds = seats.map((_, index) => `staging-sleeper-${randomUUID()}-${index}`)
  await prisma.player.createMany({ data: sourcePlayerIds.map((id, index) => ({
    id, name: `Imported Player ${index + 1}`, sport: 'NFL', league: 'NFL', position: 'WR', team: 'BUF',
  })) })
  await prisma.league.update({ where: { id: sourceLeagueId }, data: { platform: 'sleeper' } })
  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index]!
    const rosterId = seat.rosterId!
    const team = await prisma.leagueTeam.findUniqueOrThrow({ where: {
      leagueId_externalId: { leagueId: sourceLeagueId, externalId: rosterId },
    } })
    const managerId = `source-manager-${index + 1}`
    const sourceTeamId = `source-seat-${index + 1}`
    await prisma.roster.update({ where: { id: rosterId }, data: {
      platformUserId: managerId,
      playerData: { source_team_id: sourceTeamId, players: [sourcePlayerIds[index]], starters: [sourcePlayerIds[index]] },
    } })
    await prisma.leagueTeam.update({ where: { id: team.id }, data: {
      externalId: sourceTeamId, platformUserId: managerId,
      claimedByUserId: index === 0 ? creatorUserId : index === 1 ? friendUserId : null,
      isCommissioner: index === 0,
    } })
  }

  const imported = await page.request.post('/api/leagues', {
    data: { concept: 'redraft', sport: 'NFL', teamCount: 4, draftType: 'snake', scoringPreset: 'fb_half_ppr',
      leagueName: `Staging carried league ${randomUUID().slice(0, 8)}`, sourceLeagueId },
    timeout: 180_000,
  })
  const importedBody = await imported.json()
  expect(imported.status(), JSON.stringify(importedBody)).toBe(200)
  const targetLeagueId = importedBody.league.id as string
  expect(await prisma.draftPick.count({ where: { session: { leagueId: targetLeagueId } } })).toBe(4)
  expect(await prisma.leagueTeam.count({ where: { leagueId: targetLeagueId, claimedByUserId: friendUserId } })).toBe(1)
  const targetRosters = await prisma.roster.findMany({ where: { leagueId: targetLeagueId } })
  expect(targetRosters.flatMap((roster) => (roster.playerData as { players?: string[] })?.players ?? []).sort())
    .toEqual([...sourcePlayerIds].sort())

  const finalized = await page.request.post(`/api/leagues/${targetLeagueId}/import-carryover/finalize`, { timeout: 120_000 })
  const finalizedBody = await finalized.json()
  expect(finalized.status(), JSON.stringify(finalizedBody)).toBe(200)
  expect(finalizedBody.complete).toBe(true)
  expect(await prisma.redraftRosterPlayer.count({ where: { roster: { leagueId: targetLeagueId } } })).toBe(4)
})

test('every offered concept, sport, and draft mode creates a persisted league @local-staging', async ({ page }) => {
  requireIsolatedStaging()
  test.setTimeout(900_000)

  await signInAs(page, { id: `league-matrix-${randomUUID()}`, name: 'League matrix commissioner' })
  const catalog = LEAGUE_CREATE_OPTIONS_CATALOG_V1
  const cases = catalog.concepts.flatMap((concept) => {
    const sports = catalog.allowedSportsByConcept[concept.id] ?? []
    const draftTypes = catalog.allowedDraftTypesByConcept[concept.id] ?? []
    const pairs = [
      ...sports.map((sport) => ({ sport, draftType: draftTypes[0] })),
      ...draftTypes.slice(1).map((draftType) => ({ sport: sports[0], draftType })),
    ]
    return pairs.map(({ sport, draftType }) => {
      const scoringPreset = sport && catalog.allowedScoringPresetsByConceptSport[concept.id]?.[sport]?.[0]
      const teamCounts = sport && catalog.teamCountOptionsByConceptSport[concept.id]?.[sport]
      const teamCount = teamCounts?.find((count) => count >= 4) ?? teamCounts?.[0]
      return { concept: concept.id, sport, draftType, scoringPreset, teamCount }
    })
  })

  for (const item of cases) {
    expect(item.sport, `${item.concept} sport`).toBeTruthy()
    expect(item.draftType, `${item.concept} draft`).toBeTruthy()
    expect(item.scoringPreset, `${item.concept} scoring`).toBeTruthy()
    expect(item.teamCount, `${item.concept} teams`).toBeTruthy()
    const response = await page.request.post('/api/leagues', {
      data: {
        concept: item.concept, sport: item.sport, draftType: item.draftType,
        scoringPreset: item.scoringPreset, teamCount: item.teamCount,
        ...(item.sport === 'SOCCER' ? { soccerPipeline: 'euro' } : {}),
        leagueName: `Staging ${item.concept} ${item.draftType} ${randomUUID().slice(0, 8)}`,
      },
      timeout: 180_000,
    })
    const body = await response.json()
    expect(response.status(), `${item.concept}/${item.sport}/${item.draftType}: ${JSON.stringify(body)}`).toBe(200)
    const league = await prisma.league.findUniqueOrThrow({ where: { id: body.league.id } })
    const settings = league.settings as Record<string, unknown>
    expect(String(league.sport)).toBe(item.sport)
    // IDP is the defensive-player variant of the Redraft format.
    expect(league.leagueType).toBe(item.concept === 'idp' ? 'redraft' : item.concept)
    if (item.concept === 'idp') expect(league.leagueVariant).toBe('idp')
    expect(settings.requested_draft_type).toBe(item.draftType)
    expect(await prisma.draftSession.count({ where: { leagueId: league.id } })).toBeGreaterThan(0)
  }
})

test('Fantrax manager claims two franchises and keeps both when the commissioner converts the league', async ({ page }) => {
  requireIsolatedStaging()
  test.setTimeout(900_000)
  const suffix = randomUUID()
  const commissioner = 'fantrax-commissioner-' + suffix
  const manager = 'fantrax-manager-' + suffix
  const providerUser = 'provider-manager-' + suffix
  const leagueIds: string[] = []
  const players = [0, 1, 2].map(i => ({ source: randomUUID().slice(0, 5), native: 'fixture-' + suffix + '-' + i }))
  const body = { concept: 'dynasty', sport: 'NFL', teamCount: 4, draftType: 'snake', scoringPreset: 'fb_ppr' }
  const post = (path: string, data: unknown) => page.request.post(path, { data, timeout: 120_000 })
  try {
    await signInAs(page, { id: commissioner })
    const created = await post('/api/leagues', { ...body, leagueName: 'Fantrax source fixture' })
    expect(created.status()).toBe(200)
    const sourceId = (await created.json()).league.id as string
    leagueIds.push(sourceId)
    await prisma.league.update({ where: { id: sourceId }, data: { platform: 'fantrax' } })
    const seats = await prisma.leagueEntrySlot.findMany({ where: { leagueId: sourceId }, orderBy: { slotNumber: 'asc' } })
    expect(seats).toHaveLength(4)
    const invite = await prisma.leagueInvite.findFirstOrThrow({ where: { leagueId: sourceId } })
    await prisma.playerIdentityMap.createMany({ data: players.map((p, i) => ({
      canonicalName: 'Test Player ' + i, normalizedName: 'test player ' + suffix + '-' + i,
      sport: 'NFL', position: 'WR', currentTeam: 'BUF', fantraxId: p.source, sleeperId: p.native,
    })) })
    for (const [i, seat] of seats.entries()) {
      const rosterId = seat.rosterId!
      const externalId = 'source-team-' + i
      const ids = players[i] ? [players[i]!.source] : []
      await prisma.roster.update({ where: { id: rosterId }, data: {
        platformUserId: externalId, managerUserId: i === 0 ? commissioner : null,
        playerData: { source_team_id: externalId, players: ids, starters: ids },
      } })
      await prisma.leagueTeam.update({ where: { leagueId_externalId: { leagueId: sourceId, externalId: rosterId } }, data: {
        externalId, platformUserId: i === 1 || i === 2 ? providerUser : externalId,
        claimedByUserId: i === 0 ? commissioner : null, isCommissioner: i === 0, isOrphan: i === 3,
      } })
    }

    await signInAs(page, { id: manager })
    await prisma.platformIdentity.create({ data: {
      userId: manager, platform: 'fantrax', platformUserId: providerUser, platformUsername: providerUser, isVerified: true,
    } })
    for (const externalId of ['source-team-1', 'source-team-2', 'source-team-2']) {
      const claim = await post('/api/league/invite/claim', { token: invite.token, teamExternalId: externalId })
      expect(claim.status(), await claim.text()).toBe(200)
    }
    expect(await prisma.leagueManagerClaim.count({ where: { leagueId: sourceId, afUserId: manager } })).toBe(2)
    expect((await prisma.leagueInvite.findUniqueOrThrow({ where: { id: invite.id } })).useCount).toBe(invite.useCount + 2)

    await signInAs(page, { id: commissioner })
    const converted = await post('/api/leagues', { ...body, leagueName: 'Fantrax converted fixture', sourceLeagueId: sourceId })
    expect(converted.status(), await converted.text()).toBe(200)
    const target = (await converted.json()).league.id as string
    leagueIds.push(target)
    for (let attempt = 0; attempt < 2; attempt++) {
      const finalized = await post('/api/leagues/' + target + '/import-carryover/finalize', {})
      expect(finalized.status(), await finalized.text()).toBe(200)
      expect(await finalized.json()).toMatchObject({ complete: true, expectedPlayers: 3, materializedPlayers: 3 })
    }
    expect(await prisma.redraftRoster.count({ where: { leagueId: target } })).toBe(4)
    expect(await prisma.roster.count({ where: { leagueId: target, managerUserId: manager } })).toBe(2)
    expect(await prisma.redraftLeagueMember.count({ where: { leagueId: target, userId: manager } })).toBe(1)
    const rows = await prisma.redraftRoster.findMany({ where: { leagueId: target }, select: { ownerId: true } })
    expect(new Set(rows.map(r => r.ownerId)).size).toBe(4)
    const secondTeam = await prisma.redraftRoster.findFirstOrThrow({
      where: { leagueId: target, managerUserId: manager, ownerId: { not: manager } },
      select: { id: true, seasonId: true },
    })
    const waiverUrl = '/api/redraft/waivers?' + new URLSearchParams({ seasonId: secondTeam.seasonId, rosterId: secondTeam.id })
    expect((await page.request.get(waiverUrl)).status()).toBe(403)
    await signInAs(page, { id: manager })
    expect((await page.request.get(waiverUrl)).status()).toBe(200)
  } finally {
    await prisma.leagueManagerClaim.deleteMany({ where: { leagueId: { in: leagueIds } } })
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } })
    await prisma.playerIdentityMap.deleteMany({ where: { sleeperId: { in: players.map(p => p.native) } } })
    await prisma.platformIdentity.deleteMany({ where: { userId: manager, platform: 'fantrax' } })
    await prisma.appUser.deleteMany({ where: { id: { in: [commissioner, manager] } } })
  }
})

test('commissioner creates a 250-team redraft in the wizard with median and shared managers', async ({ page }) => {
  requireIsolatedStaging()
  test.setTimeout(600_000)
  const owner = 'wizard-scale-' + randomUUID()
  const name = 'Commissioner walkthrough ' + randomUUID().slice(0, 8)
  await signInAs(page, { id: owner })
  try {
    await page.goto('/create-league', { waitUntil: 'domcontentloaded', timeout: 240_000 })
    await page.getByTestId('g30-step-basics').click({ timeout: 90_000 })
    await page.getByTestId('g30-league-type-redraft').click()
    await page.getByTestId('g30-league-name').fill(name)
    await page.getByTestId('g30-team-count').fill('250')
    await page.getByTestId('g30-privacy-private').click()
    await page.getByText('Allow a manager to run multiple teams', { exact: true }).click()
    await page.getByTestId('g30-median-game').click()
    await page.getByTestId('g30-step-draft').click()
    await page.getByTestId('g31-draft-type-snake').click()
    await page.getByTestId('g30-draft-date').fill('2030-08-15')
    await page.getByTestId('g30-draft-time').fill('20:00')
    await page.getByTestId('g30-timezone').selectOption('America/New_York')
    await page.getByTestId('g30-step-review').click()
    await expect(page.getByTestId('g30-review-issues')).toHaveCount(0)
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/leagues' && r.request().method() === 'POST', { timeout: 300_000 })
    await page.getByTestId('g30-create-league-submit').click()
    const created = await response
    expect(created.status(), await created.text()).toBe(200)
    const leagueId = (await created.json()).league.id as string
    await expect(page).toHaveURL(new RegExp('/league/' + leagueId), { timeout: 180_000 })
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
    expect(league).toMatchObject({ name, leagueType: 'redraft', leagueSize: 250, medianGame: true, settings: { allow_multi_team_managers: true } })
    expect(await prisma.leagueEntrySlot.count({ where: { leagueId } })).toBe(250)
  } finally {
    await prisma.league.deleteMany({ where: { userId: owner } })
    await prisma.appUser.deleteMany({ where: { id: owner } })
  }
})
