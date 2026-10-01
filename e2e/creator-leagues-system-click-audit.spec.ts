import { expect, test, type Page } from "@playwright/test"

type CreatorLeagueResponse = {
  id: string
  source: "creator"
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
  leagueType: "creator"
  leagueStyle: "community"
  draftType: null
  draftStatus: null
  teamCount: number
  draftDate: string | null
  commissionerName: string | null
  aiFeatures: string[]
  creatorLeagueType: "FANTASY" | "BRACKET"
  isCreatorVerified: boolean
}

function buildLeague(id: string, overrides: Partial<CreatorLeagueResponse> = {}): CreatorLeagueResponse {
  return {
    id,
    source: "creator",
    name: "Alpha Creator League",
    description: "Creator-hosted community league.",
    sport: "NFL",
    memberCount: 18,
    maxMembers: 24,
    joinUrl: `/creator/leagues/${id}?join=JOINCODE`,
    detailUrl: `/creator/leagues/${id}`,
    ownerName: "Alpha Creator",
    ownerAvatar: null,
    creatorSlug: "alpha-creator",
    creatorName: "Alpha Creator",
    tournamentName: null,
    season: null,
    scoringMode: "PPR",
    isPaid: false,
    isPrivate: false,
    createdAt: new Date("2026-03-28T12:00:00.000Z").toISOString(),
    fillPct: 75,
    leagueType: "creator",
    leagueStyle: "community",
    draftType: null,
    draftStatus: null,
    teamCount: 24,
    draftDate: null,
    commissionerName: "Alpha Creator",
    aiFeatures: [],
    creatorLeagueType: "FANTASY",
    isCreatorVerified: true,
    ...overrides,
  }
}

async function installCreatorLeaguesMocks(page: Page) {
  let latestParams = new URLSearchParams()
  const pageOne = [buildLeague("creator-league-alpha")]
  const pageTwo = [buildLeague("creator-league-beta", { name: "Beta Creator League", sport: "NBA" })]

  await page.route("**/api/creator-leagues**", async (route) => {
    const url = new URL(route.request().url())
    latestParams = url.searchParams
    const pageNum = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1)
    const leagues = pageNum === 1 ? pageOne : pageTwo
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        leagues,
        total: 13,
        page: pageNum,
        limit: 12,
        totalPages: 2,
        hasMore: pageNum < 2,
        featuredCreators: [
          {
            id: "creator-alpha",
            userId: "u-1",
            handle: "alpha-creator",
            slug: "alpha-creator",
            displayName: "Alpha Creator",
            creatorType: "analyst",
            bio: null,
            communitySummary: null,
            avatarUrl: null,
            bannerUrl: null,
            websiteUrl: null,
            socialHandles: null,
            isVerified: true,
            verificationBadge: "verified",
            visibility: "public",
            communityVisibility: "public",
            branding: null,
            followerCount: 240,
            leagueCount: 4,
            totalLeagueMembers: 412,
            createdAt: new Date("2026-03-28T12:00:00.000Z").toISOString(),
            updatedAt: new Date("2026-03-28T12:00:00.000Z").toISOString(),
          },
        ],
      }),
    })
  })

  return {
    getLatestParams: () => latestParams,
  }
}

test.describe("@creator-leagues-system click audit", () => {
  test("creator profiles, verified badges, discovery cards, and join buttons are wired", async ({ page }) => {
    const mocks = await installCreatorLeaguesMocks(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/creator-leagues", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("creator-leagues-featured-creators")).toBeVisible()
    const featuredCreator = page.getByTestId("creator-leagues-featured-creator-alpha-creator")
    await expect(featuredCreator).toContainText("Alpha Creator")
    await expect(featuredCreator.getByTestId("creator-verified-badge")).toBeVisible()

    const card = page.getByTestId("creator-league-card-creator-league-alpha")
    await expect(card).toBeVisible()
    await expect(card).toContainText("Alpha Creator League")
    await expect(card).toContainText("League type:")
    await expect(card).toContainText("Teams filled:")
    await expect(page.getByTestId("creator-discovery-join-creator-league-alpha")).toBeVisible()

    await page.getByTestId("creator-leagues-search-input").fill("alpha")
    await page.getByTestId("creator-leagues-sport").selectOption("NFL")
    await page.getByTestId("creator-leagues-sort").selectOption("newest")
    await page.getByTestId("creator-leagues-search-submit").click()

    const params = mocks.getLatestParams()
    expect(params.get("q")).toBe("alpha")
    expect(params.get("sport")).toBe("NFL")
    expect(params.get("sort")).toBe("newest")

    await page.getByRole("button", { name: "Next", exact: true }).click()
    await expect(page.getByTestId("creator-league-card-creator-league-beta")).toBeVisible()
    await page.getByRole("button", { name: /previous/i }).click()
    await expect(page.getByTestId("creator-league-card-creator-league-alpha")).toBeVisible()
  })
})

