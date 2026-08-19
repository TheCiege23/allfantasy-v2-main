import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

test.describe('@drama league drama click audit', () => {
  test('audits drama timeline, detail drill-downs, and story actions', async ({ page }) => {
    const timelineCalls: Array<{ sport: string | null; season: string | null; dramaType: string | null; offset: string | null }> = []
    const runBodies: Array<Record<string, unknown>> = []
    const storyBodies: Array<Record<string, unknown>> = []
    const rivalryCalls: Array<{ managerAId: string | null; managerBId: string | null }> = []

    await page.route('**/api/leagues/league_drama_1/drama/run', async (route) => {
      if (route.request().method() === 'POST') {
        runBodies.push(route.request().postDataJSON() as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            leagueId: 'league_drama_1',
            created: 4,
            updated: 2,
            eventIds: ['evt_rivalry', 'evt_trade'],
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.route('**/api/leagues/league_drama_1/drama/tell-story', async (route) => {
      if (route.request().method() === 'POST') {
        storyBodies.push(route.request().postDataJSON() as Record<string, unknown>)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            narrative:
              'A high-stakes rivalry is peaking after recent momentum swings, and this matchup now has playoff implications.',
            source: 'ai',
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.route('**/api/leagues/league_drama_1/drama/timeline**', async (route) => {
      const url = new URL(route.request().url())
      const offset = url.searchParams.get('offset')
      const sport = url.searchParams.get('sport')
      const season = url.searchParams.get('season')
      const dramaType = url.searchParams.get('dramaType')
      timelineCalls.push({ sport, season, dramaType, offset })
      const page1 = [
        {
          id: 'evt_rivalry',
          dramaType: 'RIVALRY_CLASH',
          headline: 'mgr_alpha vs mgr_bravo: Heated rivalry renewed',
          summary: 'Their rivalry game now swings playoff seeding.',
          dramaScore: 88,
          relatedManagerIds: ['mgr_alpha', 'mgr_bravo'],
          relatedTeamIds: ['team_alpha', 'team_bravo'],
          relatedMatchupId: 'match_1',
        },
        {
          id: 'evt_trade',
          dramaType: 'TRADE_FALLOUT',
          headline: 'Trade fallout after blockbuster swap',
          summary: 'Asset exchange shifted contender balance.',
          dramaScore: 79,
          relatedManagerIds: ['mgr_trade_a', 'mgr_trade_b'],
          relatedTeamIds: ['team_trade_a', 'team_trade_b'],
          relatedMatchupId: null,
        },
      ]
      const events =
        offset === '10'
          ? [
              {
                id: 'evt_old',
                dramaType: 'WIN_STREAK',
                headline: 'Legacy streak storyline',
                summary: 'Historical run still influences this season.',
                dramaScore: 64,
                relatedManagerIds: ['mgr_old'],
                relatedTeamIds: ['team_old'],
                relatedMatchupId: null,
              },
            ]
          : [...page1, ...Array.from({ length: 8 }).map((_, idx) => ({
              id: `evt_${idx}`,
              dramaType: 'PLAYOFF_BUBBLE',
              headline: `Bubble storyline ${idx + 1}`,
              summary: 'Cut-line pressure remains intense.',
              dramaScore: 62 - idx,
              relatedManagerIds: [],
              relatedTeamIds: [],
              relatedMatchupId: null,
            }))]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ timeline: events }),
      })
    })

    await page.route('**/api/leagues/league_drama_1/drama/evt_*', async (route) => {
      const url = route.request().url()
      const eventId = url.split('/').pop() ?? ''
      const data =
        eventId === 'evt_trade'
          ? {
              id: 'evt_trade',
              leagueId: 'league_drama_1',
              headline: 'Trade fallout after blockbuster swap',
              summary: 'Asset exchange shifted contender balance.',
              dramaType: 'TRADE_FALLOUT',
              dramaScore: 79,
              relatedManagerIds: ['mgr_trade_a', 'mgr_trade_b'],
              relatedTeamIds: ['team_trade_a', 'team_trade_b'],
              relatedMatchupId: null,
              createdAt: '2026-03-20T00:00:00.000Z',
            }
          : {
              id: 'evt_rivalry',
              leagueId: 'league_drama_1',
              headline: 'mgr_alpha vs mgr_bravo: Heated rivalry renewed',
              summary: 'Their rivalry game now swings playoff seeding.',
              dramaType: 'RIVALRY_CLASH',
              dramaScore: 88,
              relatedManagerIds: ['mgr_alpha', 'mgr_bravo'],
              relatedTeamIds: ['team_alpha', 'team_bravo'],
              relatedMatchupId: 'match_1',
              createdAt: '2026-03-20T00:00:00.000Z',
            }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data),
      })
    })

    await page.route('**/api/leagues/league_drama_1/rivalries**', async (route) => {
      const url = new URL(route.request().url())
      rivalryCalls.push({
        managerAId: url.searchParams.get('managerAId'),
        managerBId: url.searchParams.get('managerBId'),
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rivalries: [
            {
              id: 'riv_1',
            },
          ],
        }),
      })
    })

    // /app/league/* is session-gated; without this the page 307s to /login and
    // every assertion below fails as "element(s) not found".
    await signInAs(page, { id: 'e2e-drama-user' })

    await page.goto('/app/league/league_drama_1/drama')
    await expect(page.getByRole('heading', { name: 'League Drama Timeline' })).toBeVisible()
    await page.getByLabel('Drama sport filter').selectOption('NBA')
    await page.getByLabel('Drama season filter').fill('2025')
    await page.getByLabel('Drama type filter').selectOption('RIVALRY_CLASH')
    await page.getByLabel('Drama minimum score filter').fill('50')
    await page.getByRole('button', { name: 'Refresh storylines' }).click()
    await page.getByRole('button', { name: 'Tell me the story' }).first().click()
    await expect(page.getByText(/playoff implications/i)).toBeVisible()
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.getByText(/Legacy streak storyline/i)).toBeVisible()
    await page.getByRole('button', { name: 'Prev page' }).click()
    await page.getByRole('link', { name: 'Story detail' }).first().click()

    await page.waitForURL('**/drama/evt_rivalry')
    await expect(page.getByRole('button', { name: 'Open linked rivalry' })).toBeVisible()
    await page.getByRole('button', { name: 'Open linked rivalry' }).click()
    await page.waitForURL('**/rivalries/riv_1**')

    await page.goto('/app/league/league_drama_1/drama/evt_trade')
    await expect(page.getByRole('link', { name: 'Open trade fallout context' })).toBeVisible()
    await page.getByRole('button', { name: 'Tell me the story' }).click()
    await expect(page.getByText(/playoff implications/i)).toBeVisible()
    await page.getByRole('link', { name: 'Open drama timeline' }).click()
    await page.waitForURL('**/app/league/league_drama_1/drama')

    expect(runBodies.length).toBeGreaterThan(0)
    expect(storyBodies.length).toBeGreaterThan(0)
    expect(timelineCalls.some((c) => c.sport === 'NBA' && c.season === '2025')).toBe(true)
    expect(rivalryCalls.length).toBeGreaterThan(0)
  })
})
