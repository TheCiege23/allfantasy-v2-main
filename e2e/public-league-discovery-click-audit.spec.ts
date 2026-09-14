import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

type DiscoveryCard = {
  source: 'fantasy' | 'creator' | 'bracket'
  id: string
  name: string
  description: string | null
  sport: string
  memberCount: number
  maxMembers: number
  joinUrl: string
  detailUrl: string
  ownerName: string | null
  ownerAvatar: string | null
  creatorSlug: string | null
  creatorName: string | null
  tournamentName: string | null
  season: number | null
  scoringMode: string | null
  isPaid: boolean
  isPrivate: boolean
  createdAt: string
  fillPct: number
  leagueType: 'fantasy' | 'creator' | 'bracket'
  leagueStyle: string | null
  draftType: string | null
  teamCount: number
  draftDate: string | null
  commissionerName: string | null
  aiFeatures: string[]
  creatorLeagueType?: string | null
  isCreatorVerified?: boolean
  leagueTier?: number | null
  canJoinByRanking?: boolean
  inviteOnlyByTier?: boolean
}

async function gotoWithRetry(page: Page, url: string) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      return
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      const canRetry =
        attempt < 2 &&
        (message.includes('net::ERR_ABORTED') || message.includes('interrupted by another navigation'))
      if (!canRetry) throw error
      await page.waitForTimeout(250)
    }
  }
}

function createCard(
  id: string,
  overrides: Partial<DiscoveryCard> = {}
): DiscoveryCard {
  return {
    source: 'fantasy',
    id,
    name: `League ${id}`,
    description: 'Rank-matched public league',
    sport: 'NFL',
    memberCount: 6,
    maxMembers: 12,
    joinUrl: `/join?code=${id.toUpperCase()}`,
    detailUrl: `/leagues/${id}`,
    ownerName: 'Commissioner',
    ownerAvatar: null,
    creatorSlug: null,
    creatorName: null,
    tournamentName: null,
    season: 2026,
    scoringMode: 'PPR',
    isPaid: false,
    isPrivate: false,
    createdAt: new Date('2026-03-24T12:00:00.000Z').toISOString(),
    fillPct: 50,
    leagueType: 'fantasy',
    leagueStyle: 'redraft',
    draftType: null,
    teamCount: 12,
    draftDate: null,
    commissionerName: 'Commissioner',
    aiFeatures: ['Coach'],
    leagueTier: 5,
    canJoinByRanking: true,
    inviteOnlyByTier: false,
    ...overrides,
  }
}

async function installDiscoveryRoutes(page: Page) {
  /*
   * ⚠ A REAL SESSION, NOT A COOKIE THE SERVER CANNOT READ. This used to mint its token with a
   * hardcoded secret: 'playwright-secret', which never matches the server's NEXTAUTH_SECRET.
   * The server logged ERR_JWE_DECRYPTION_FAILED for every request carrying it (34 times in one
   * nightly core 3/3 run) and treated the viewer as signed OUT, while the /api/auth/session mock
   * below told the client the opposite. The spec claimed a signed-in "Ranked Viewer" that only
   * half the stack believed in. signInAs signs with the server's own secret and seeds the
   * AppUser row the session needs; e2e/helpers/session-cookie.ts records why both are required.
   */
  await signInAs(page, { id: 'viewer-1', email: 'viewer@allfantasy.test', name: 'Ranked Viewer' })

  const alphaCreatorLeague = createCard('creator-league-1', {
    source: 'creator',
    leagueType: 'creator',
    name: 'Alpha Creator League',
    description: 'Dynasty creator room for rank-matched NFL players.',
    joinUrl: '/creator/leagues/creator-league-1?join=JOINALPHA',
    detailUrl: '/creator/leagues/creator-league-1',
    creatorSlug: 'alpha-creator',
    creatorName: 'Alpha Creator',
    ownerName: 'Alpha Creator',
    sport: 'NFL',
    leagueStyle: 'dynasty',
    fillPct: 78,
    memberCount: 14,
    maxMembers: 18,
    isCreatorVerified: true,
    leagueTier: 5,
  })

  const betaCreatorLeague = createCard('creator-league-2', {
    source: 'creator',
    leagueType: 'creator',
    name: 'Beta Creator League',
    description: 'Second-page creator room for pagination coverage.',
    joinUrl: '/creator/leagues/creator-league-2?join=JOINBETA',
    detailUrl: '/creator/leagues/creator-league-2',
    creatorSlug: 'beta-creator',
    creatorName: 'Beta Creator',
    ownerName: 'Beta Creator',
    sport: 'NBA',
    leagueStyle: 'redraft',
    fillPct: 72,
    memberCount: 9,
    maxMembers: 14,
    leagueTier: 5,
  })

  const bracketLeague = createCard('bracket-league-1', {
    source: 'bracket',
    leagueType: 'bracket',
    name: 'March Bracket Bash',
    joinUrl: '/brackets/join?code=BRACKET1',
    detailUrl: '/brackets/leagues/bracket-league-1',
    tournamentName: 'March Madness',
    sport: 'NCAAB',
    leagueStyle: 'bracket',
    fillPct: 88,
    memberCount: 44,
    maxMembers: 50,
  })

  const paidFantasyLeague = createCard('fantasy-league-paid', {
    name: 'High Stakes Hoops',
    sport: 'NBA',
    isPaid: true,
    leagueStyle: 'redraft',
    fillPct: 61,
    memberCount: 11,
    maxMembers: 18,
  })

  const fillerCards = Array.from({ length: 10 }, (_, index) =>
    createCard(`filler-${index + 1}`, {
      name: `Filler League ${index + 1}`,
      sport: index % 2 === 0 ? 'NFL' : 'MLB',
      leagueStyle: index % 3 === 0 ? 'keeper' : 'redraft',
      fillPct: 35 + index,
      createdAt: new Date(`2026-03-${String(10 + index).padStart(2, '0')}T12:00:00.000Z`).toISOString(),
    })
  )

  const allCards = [
    alphaCreatorLeague,
    bracketLeague,
    paidFantasyLeague,
    ...fillerCards,
    betaCreatorLeague,
  ]

  const alphaCreator = {
    id: 'creator-alpha',
    userId: 'viewer-1',
    handle: 'alpha-creator',
    slug: 'alpha-creator',
    displayName: 'Alpha Creator',
    creatorType: 'analyst',
    bio: 'Host of a weekly multi-sport strategy show.',
    communitySummary: 'Public creator leagues for managers in the same competitive tier.',
    avatarUrl: null,
    bannerUrl: null,
    websiteUrl: null,
    socialHandles: null,
    isVerified: true,
    verificationBadge: 'verified',
    visibility: 'public',
    communityVisibility: 'public',
    branding: {
      primaryColor: '#1E3A8A',
      accentColor: '#F97316',
      tagline: 'Same-level competition with creator recaps.',
    },
    followerCount: 82,
    leagueCount: 2,
    totalLeagueMembers: 23,
    featuredRank: 4,
    featuredScore: 210,
    isFollowing: false,
    topSports: ['NFL', 'NBA'],
    featuredLeague: {
      id: 'creator-league-1',
      name: 'Alpha Creator League',
      sport: 'NFL',
      inviteUrl: '/creator/leagues/creator-league-1?join=JOINALPHA',
      leagueTier: 5,
      canJoinByRanking: true,
      inviteOnlyByTier: false,
    },
    viewerTier: 5,
    viewerTierName: 'Game Manager',
    hiddenLeagueCount: 1,
    isOwner: false,
    createdAt: new Date('2026-03-20T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-20T00:00:00.000Z').toISOString(),
  }

  const creatorLeagueDetail = {
    id: 'creator-league-1',
    creatorId: 'creator-alpha',
    type: 'FANTASY',
    leagueId: 'league-alpha-1',
    bracketLeagueId: null,
    name: 'Alpha Creator League',
    slug: 'alpha-creator-league',
    description: 'Dynasty creator room for rank-matched NFL players.',
    sport: 'NFL',
    inviteCode: 'JOINALPHA',
    inviteUrl: '/creator/leagues/creator-league-1?join=JOINALPHA',
    shareUrl: '/creator/leagues/creator-league-1',
    isPublic: true,
    maxMembers: 18,
    memberCount: 14,
    fillRate: 0.78,
    joinDeadline: null,
    coverImageUrl: null,
    communitySummary: 'Film-room style recaps and rank-matched competition.',
    latestRecapTitle: 'Alpha recap',
    latestRecapSummary: 'The room is filling fast with Tier 4-6 managers.',
    latestCommentary: 'This creator league stays competitive by grouping nearby manager tiers together.',
    creator: { slug: 'alpha-creator' },
    isMember: false,
    leagueTier: 5,
    canJoinByRanking: true,
    inviteOnlyByTier: false,
    viewerTier: 5,
    viewerTierName: 'Game Manager',
    createdAt: new Date('2026-03-22T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-22T00:00:00.000Z').toISOString(),
  }

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'viewer-1',
          email: 'viewer@allfantasy.test',
          name: 'Ranked Viewer',
        },
        expires: new Date('2026-04-30T00:00:00.000Z').toISOString(),
      }),
    })
  })

  await page.route('**/api/discover/trending**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, leagues: [alphaCreatorLeague, bracketLeague, paidFantasyLeague] }),
    })
  })

  await page.route('**/api/discover/recommended**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, leagues: [alphaCreatorLeague, paidFantasyLeague] }),
    })
  })

  await page.route('**/api/discover/recommendations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        personalized: true,
        leagues: [
          {
            league: alphaCreatorLeague,
            explanation: 'Best fit for your current Tier 5 NFL dynasty profile.',
          },
        ],
      }),
    })
  })

  await page.route('**/api/discover/leagues**', async (route) => {
    const url = new URL(route.request().url())
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()
    const sport = (url.searchParams.get('sport') || '').trim().toUpperCase()
    const format = (url.searchParams.get('format') || 'all').trim()
    const style = (url.searchParams.get('style') || 'all').trim()
    const entryFee = (url.searchParams.get('entryFee') || 'all').trim()
    const sort = (url.searchParams.get('sort') || 'popularity').trim()
    const pageNumber = Math.max(1, Number(url.searchParams.get('page') || '1'))
    const limit = Math.max(1, Number(url.searchParams.get('limit') || '12'))

    let results = [...allCards]

    if (q) {
      results = results.filter((card) => {
        const haystack = [card.name, card.description || '', card.creatorName || '', card.ownerName || '']
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }

    if (sport) results = results.filter((card) => card.sport === sport)
    if (format !== 'all') results = results.filter((card) => card.source === format)
    if (style !== 'all') results = results.filter((card) => card.leagueStyle === style)
    if (entryFee === 'free') results = results.filter((card) => !card.isPaid)
    if (entryFee === 'paid') results = results.filter((card) => card.isPaid)

    if (sort === 'newest') {
      results.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    } else if (sort === 'filling_fast') {
      results.sort((left, right) => right.fillPct - left.fillPct)
    } else {
      results.sort((left, right) => right.memberCount - left.memberCount)
    }

    const total = results.length
    const start = (pageNumber - 1) * limit
    const pageItems = results.slice(start, start + limit)
    const totalPages = Math.max(1, Math.ceil(total / limit))

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        leagues: pageItems,
        total,
        page: pageNumber,
        limit,
        totalPages,
        hasMore: start + pageItems.length < total,
        viewerTier: 5,
        viewerTierName: 'Game Manager',
        hiddenByTierPolicy: 3,
      }),
    })
  })

  await page.route('**/api/creators/alpha-creator/leagues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([creatorLeagueDetail]),
    })
  })

  await page.route('**/api/creators/alpha-creator', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(alphaCreator),
    })
  })

  await page.route('**/api/creator/leagues/creator-league-1**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(creatorLeagueDetail),
    })
  })

  await page.route('**/api/creator-invites/join', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, creatorLeagueId: 'creator-league-1' }),
    })
  })
}

test.describe('@discovery public league discovery click audit', () => {
  test('filters, search, league navigation, joins, creator links, pagination, and empty state all work', async ({
    page,
  }) => {
    await installDiscoveryRoutes(page)

    await page.setViewportSize({ width: 1440, height: 1100 })
    await gotoWithRetry(page, '/tools/public-league-discovery-harness')

    const mainResults = page.getByTestId('discovery-results-grid')

    await expect(page.getByTestId('public-league-discovery-page')).toBeVisible()
    await expect(mainResults.getByTestId('league-discovery-card-creator-creator-league-1')).toBeVisible()
    await expect(page.getByTestId('discovery-ranking-banner')).toContainText('Game Manager')
    await expect(page.getByTestId('discovery-pagination')).toBeVisible()

    await page.getByTestId('discovery-pagination-next').click()
    await expect(page.getByText('Page 2 of 2')).toBeVisible()
    await expect(mainResults.getByTestId('league-discovery-card-fantasy-filler-9')).toBeVisible()

    await page.getByTestId('discovery-pagination-prev').click()
    await expect(mainResults.getByTestId('league-discovery-card-creator-creator-league-1')).toBeVisible()

    await page.getByTestId('discovery-format-creator').click()
    await expect(page.getByTestId('discovery-format-creator')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('discovery-style-dynasty').click()
    await expect(page.getByTestId('discovery-style-dynasty')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('discovery-entry-fee-free').click()
    await expect(page.getByTestId('discovery-entry-fee-free')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('discovery-sort-filling_fast').click()
    await expect(page.getByTestId('discovery-sort-filling_fast')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('discovery-sport-select').selectOption('NFL')

    await page.getByTestId('discovery-search-input').fill('Alpha')
    await page.getByTestId('discovery-search-submit').click()

    await expect(mainResults.getByTestId('league-discovery-card-creator-creator-league-1')).toBeVisible()
    await expect(mainResults.getByTestId('league-discovery-card-fantasy-fantasy-league-paid')).toHaveCount(0)

    await mainResults.getByTestId('league-discovery-creator-alpha-creator').click()
    await expect(page).toHaveURL(/\/creators\/alpha-creator/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Alpha Creator', exact: true })).toBeVisible()

    await page.goBack({ waitUntil: 'domcontentloaded' })
    await expect(mainResults.getByTestId('league-discovery-view-creator-league-1')).toBeVisible()
    await mainResults.getByTestId('league-discovery-view-creator-league-1').click()
    await expect(page).toHaveURL(/\/creator\/leagues\/creator-league-1$/, { timeout: 15_000 })
    await expect(page.getByText('Alpha Creator League')).toBeVisible()

    await page.goBack({ waitUntil: 'domcontentloaded' })
    await expect(mainResults.getByTestId('league-discovery-join-creator-league-1')).toBeVisible()
    await mainResults.getByTestId('league-discovery-join-creator-league-1').click()
    await expect(page).toHaveURL(/\/creator\/leagues\/creator-league-1\?join=JOINALPHA/, {
      timeout: 15_000,
    })
    await expect(page.getByTestId('creator-league-join-result')).toContainText('You joined this league.')

    await gotoWithRetry(page, '/tools/public-league-discovery-harness')
    await page.getByTestId('discovery-format-bracket').click()
    await expect(page.getByTestId('discovery-format-bracket')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('discovery-style-dynasty').click()
    await expect(page.getByTestId('discovery-style-dynasty')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('discovery-empty-state')).toBeVisible()
  })

  test('mobile and desktop layouts stay usable without dead controls', async ({ page }) => {
    await installDiscoveryRoutes(page)

    await page.setViewportSize({ width: 1365, height: 960 })
    await gotoWithRetry(page, '/tools/public-league-discovery-harness')
    await expect(page.getByTestId('discovery-filters-panel')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()

    await page.setViewportSize({ width: 390, height: 844 })
    await gotoWithRetry(page, '/tools/public-league-discovery-harness')
    await expect(page.getByTestId('discovery-search-input')).toBeVisible()
    await expect(page.getByTestId('discovery-format-creator')).toBeVisible()
    await expect(page.getByTestId('discovery-sort-filling_fast')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  })
})
