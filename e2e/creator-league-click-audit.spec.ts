import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

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
      await page.waitForTimeout(200)
    }
  }
}

async function installCreatorRoutes(page: Page) {
  const creator: any = {
    id: 'creator-alpha',
    userId: 'viewer-1',
    handle: 'alpha-creator',
    slug: 'alpha-creator',
    displayName: 'Alpha Creator',
    creatorType: 'analyst',
    bio: 'Fantasy analyst, podcaster, and creator host.',
    communitySummary: 'Branded creator leagues, fast recaps, and community discussion across football and hoops.',
    avatarUrl: null,
    bannerUrl: null,
    websiteUrl: 'https://alpha.example.com',
    socialHandles: null,
    isVerified: true,
    verificationBadge: 'partner',
    visibility: 'public',
    communityVisibility: 'public',
    branding: {
      tagline: 'Creator-hosted competition with a weekly show energy.',
      communityName: 'Alpha Creator Club',
      inviteHeadline: 'Join the room before lineups lock.',
      primaryColor: '#2F6FED',
      accentColor: '#FF7A18',
      backgroundColor: '#0D1526',
    },
    followerCount: 42,
    leagueCount: 2,
    totalLeagueMembers: 86,
    isFollowing: false,
    topSports: ['NFL', 'NBA'],
    featuredLeague: {
      id: 'creator-league-1',
      name: 'Alpha Public League',
      sport: 'NFL',
      inviteUrl: '/creator/leagues/creator-league-1?join=JOINALPHA',
    },
    isOwner: true,
    createdAt: new Date('2026-03-20T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-20T00:00:00.000Z').toISOString(),
  }

  const analytics = {
    profileViews: 122,
    followCount: 42,
    leagueJoins: 18,
    inviteShares: 9,
    leagueMembers: 86,
    publicLeagues: 1,
    conversionRate: 0.148,
    topShareChannel: 'direct',
    featuredRank: 4,
    period: '30d',
  }

  const league: any = {
    id: 'creator-league-1',
    creatorId: 'creator-alpha',
    type: 'FANTASY',
    leagueId: 'league-alpha-1',
    bracketLeagueId: null,
    name: 'Alpha Public League',
    slug: 'alpha-public-league',
    description: 'Open league from Alpha Creator.',
    sport: 'NFL',
    inviteCode: 'JOINALPHA',
    inviteUrl: '/creator/leagues/creator-league-1?join=JOINALPHA',
    shareUrl: '/creator/leagues/creator-league-1',
    isPublic: true,
    maxMembers: 100,
    memberCount: 22,
    fillRate: 0.22,
    joinDeadline: null,
    coverImageUrl: null,
    communitySummary: 'Weekly recap league tied to the Alpha Creator audience.',
    latestRecapTitle: 'Alpha recap: studio room is heating up',
    latestRecapSummary: 'The room is filling fast and draft-season chatter is already live.',
    latestCommentary: 'The creator is framing this league like a live weekly show with audience stakes.',
    isMember: false,
    creator: { slug: 'alpha-creator' },
    createdAt: new Date('2026-03-20T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-20T00:00:00.000Z').toISOString(),
  }

  const privateLeague: any = {
    ...league,
    id: 'creator-league-2',
    name: 'Alpha Private Room',
    slug: 'alpha-private-room',
    inviteCode: 'ROOMALPHA',
    inviteUrl: '/creator/leagues/creator-league-2?join=ROOMALPHA',
    shareUrl: '/creator/leagues/creator-league-2',
    isPublic: false,
    communitySummary: 'Invite-only community for subscribers and creator guests.',
  }

  let followRequests = 0
  let leagueShareRequests = 0
  let profileShareRequests = 0
  let joinRequests = 0
  let brandingSaves = 0

  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          ;(window as Window & { __copiedText?: string }).__copiedText = text
        },
      },
      configurable: true,
    })
  })

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'viewer-1',
          name: 'Alpha Creator',
          email: 'alpha@example.com',
          image: null,
        },
        expires: new Date('2026-04-27T00:00:00.000Z').toISOString(),
      }),
    })
  })

  await page.route('**/api/creators/me', async (route) => {
    if (route.request().method() === 'POST' || route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      creator.handle = String(body.handle || creator.handle)
      creator.displayName = String(body.displayName || creator.displayName)
      creator.creatorType = String(body.creatorType || creator.creatorType)
      creator.bio = String(body.bio || creator.bio)
      creator.communitySummary = String(body.communitySummary || creator.communitySummary)
      creator.websiteUrl = String(body.websiteUrl || creator.websiteUrl)
      creator.visibility = String(body.visibility || creator.visibility)
      creator.communityVisibility = String(body.communityVisibility || creator.communityVisibility)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(creator) })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        creator,
        leagues: [league, privateLeague],
      }),
    })
  })

  await page.route('**/api/creators?**', async (route) => {
    const url = new URL(route.request().url())
    const sort = url.searchParams.get('sort')
    if (sort) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          creators: [
            {
              userId: 'viewer-1',
              handle: 'alpha-creator',
              slug: 'alpha-creator',
              displayName: 'Alpha Creator',
              avatarUrl: null,
              verified: true,
              verificationBadge: 'partner',
              leagueCount: 2,
              totalMembers: 86,
              rank: 1,
            },
          ],
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        creators: [{ ...creator, isOwner: false, isFollowing: false }],
        nextCursor: null,
      }),
    })
  })

  await page.route('**/api/creators/alpha-creator/follow', async (route) => {
    followRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  })

  await page.route('**/api/creators/alpha-creator/unfollow', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  })

  await page.route('**/api/creators/alpha-creator/share', async (route) => {
    profileShareRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'http://127.0.0.1:3000/creators/alpha-creator' }),
    })
  })

  await page.route('**/api/creators/alpha-creator/analytics?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(analytics),
    })
  })

  await page.route('**/api/creators/alpha-creator/branding', async (route) => {
    brandingSaves += 1
    const body = route.request().postDataJSON() as Record<string, string>
    creator.branding = {
      ...creator.branding,
      ...body,
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(creator),
    })
  })

  await page.route('**/api/creators/alpha-creator/leagues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([league, privateLeague]),
    })
  })

  await page.route('**/api/creators/alpha-creator', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(creator),
    })
  })

  await page.route('**/api/creator/leagues/creator-league-1/share', async (route) => {
    leagueShareRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'http://127.0.0.1:3000/creator/leagues/creator-league-1?join=JOINALPHA' }),
    })
  })

  await page.route('**/api/creator/leagues/creator-league-1**', async (route) => {
    if (route.request().url().includes('/share')) {
      await route.fallback()
      return
    }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      league.name = String(body.name || league.name)
      league.sport = String(body.sport || league.sport)
      league.description = String(body.description || league.description)
      league.communitySummary = String(body.communitySummary || league.communitySummary)
      league.latestRecapTitle = String(body.latestRecapTitle || league.latestRecapTitle)
      league.latestRecapSummary = String(body.latestRecapSummary || league.latestRecapSummary)
      league.latestCommentary = String(body.latestCommentary || league.latestCommentary)
      league.coverImageUrl = body.coverImageUrl ? String(body.coverImageUrl) : null
      league.isPublic = Boolean(body.isPublic ?? league.isPublic)
      if (body.regenerateInvite) {
        league.inviteCode = 'NEWALPHA'
        league.inviteUrl = '/creator/leagues/creator-league-1?join=NEWALPHA'
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(league) })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...league, creator: { slug: 'alpha-creator' } }),
    })
  })

  await page.route('**/api/creator-invites/join', async (route) => {
    joinRequests += 1
    league.isMember = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, creatorLeagueId: league.id }),
    })
  })

  return {
    counts: {
      get followRequests() {
        return followRequests
      },
      get leagueShareRequests() {
        return leagueShareRequests
      },
      get profileShareRequests() {
        return profileShareRequests
      },
      get joinRequests() {
        return joinRequests
      },
      get brandingSaves() {
        return brandingSaves
      },
    },
  }
}

test.describe('@community creator league click audit', () => {
  test('desktop audit covers discovery, follow, profile route, analytics, branding, join, and share flows', async ({ page }) => {
    const routes = await installCreatorRoutes(page)

    await page.setViewportSize({ width: 1440, height: 1100 })
    await gotoWithRetry(page, '/creators')

    await expect(page.getByTestId('creator-profile-card-alpha-creator')).toBeVisible()
    await expect(page.getByText(/subscribe/i)).toHaveCount(0)

    const followButton = page.getByTestId('creator-follow-button-alpha-creator')
    await clickHydrated(followButton)
    await expect(followButton).toContainText('Following')
    await expect.poll(() => routes.counts.followRequests).toBe(1)

    await clickHydrated(page.getByTestId('creator-profile-link-alpha-creator'))
    await expect(page).toHaveURL(/\/creators\/alpha-creator/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Alpha Creator' })).toBeVisible()

    await clickHydrated(page.getByTestId('creator-analytics-tab'))
    await expect(page.getByTestId('creator-analytics-panel')).toBeVisible()

    await clickHydrated(page.getByTestId('creator-branding-tab'))
    await page.getByTestId('creator-branding-tagline').fill('Fresh creator tagline')
    await clickHydrated(page.getByTestId('creator-branding-save-button'))
    await expect.poll(() => routes.counts.brandingSaves).toBe(1)

    await clickHydrated(page.getByTestId('creator-community-tab'))
    await clickHydrated(page.getByTestId('creator-league-share-creator-league-1'))
    await expect.poll(() => routes.counts.leagueShareRequests).toBe(1)

    const joinLink = page.getByTestId('creator-league-join-creator-league-1')
    await expect(joinLink).toHaveAttribute('href', '/creator/leagues/creator-league-1?join=JOINALPHA')
    await clickHydrated(joinLink)

    await expect(page).toHaveURL(/\/creator\/leagues\/creator-league-1\?join=JOINALPHA/, {
      timeout: 15_000,
    })
    await expect(page.getByTestId('creator-league-join-result')).toContainText('You joined this league.')
    await expect.poll(() => routes.counts.joinRequests).toBe(1)

    await clickHydrated(page.getByTestId('creator-invite-share-button'))
    await expect(page.getByTestId('creator-invite-share-button')).toContainText('Shared')

    await clickHydrated(page.getByTestId('creator-league-back-to-profile'))
    await expect(page).toHaveURL(/\/creators\/alpha-creator/, { timeout: 15_000 })
  })

  test('mobile and desktop layouts avoid overflow and keep creator controls reachable', async ({ page }) => {
    await installCreatorRoutes(page)

    await page.setViewportSize({ width: 1365, height: 960 })
    await gotoWithRetry(page, '/creators')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()

    await page.setViewportSize({ width: 390, height: 844 })
    await gotoWithRetry(page, '/creators/alpha-creator')
    await expect(page.getByTestId('creator-community-tab')).toBeVisible()
    await expect(page.getByTestId('creator-analytics-tab')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()

    await gotoWithRetry(page, '/creator/leagues/creator-league-1?join=JOINALPHA')
    await expect(page.getByTestId('creator-invite-copy-button')).toBeVisible()
    await expect(page.getByTestId('creator-invite-share-button')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  })

  test('createor alias renders the creator dashboard surface', async ({ page }) => {
    await installCreatorRoutes(page)

    await gotoWithRetry(page, '/createor')
    await expect(page.getByRole('heading', { name: 'Creator dashboard' })).toBeVisible()
    await expect(page.getByText('Creator profile settings')).toBeVisible()
    await expect(page.getByTestId('creator-branding-save-button')).toBeVisible()
  })
})
