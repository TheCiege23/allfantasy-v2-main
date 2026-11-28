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
      timeout: 90_000,
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

  // Copying an imported league into a new one is retired (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §10):
  // the request is refused before anything is written, and no league is created.
  const leaguesBefore = await prisma.league.count({ where: { userId: creatorUserId } })
  const copied = await page.request.post('/api/leagues', {
    data: { concept: 'redraft', sport: 'NFL', teamCount: 4, draftType: 'snake', scoringPreset: 'fb_half_ppr',
      leagueName: `Staging copy attempt ${randomUUID().slice(0, 8)}`, sourceLeagueId },
    timeout: 90_000,
  })
  expect(copied.status(), JSON.stringify(await copied.json())).toBe(410)
  expect(await prisma.league.count({ where: { userId: creatorUserId } })).toBe(leaguesBefore)
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
      timeout: 90_000,
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
