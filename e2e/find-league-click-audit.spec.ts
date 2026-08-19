import { expect, test, type Page } from "@playwright/test"

type DiscoveryCard = {
  source: "fantasy" | "creator" | "bracket"
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
  leagueType: "fantasy" | "creator" | "bracket"
  leagueStyle: string | null
  draftType: string | null
  draftStatus: string | null
  teamCount: number
  draftDate: string | null
  commissionerName: string | null
  aiFeatures: string[]
  rankingEffectScore?: number
  inviteOnlyByTier?: boolean
  canJoinByRanking?: boolean
}

function buildCard(id: string, overrides: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: "fantasy",
    id,
    name: `League ${id}`,
    description: "Public discoverable league",
    sport: "NFL",
    memberCount: 9,
    maxMembers: 12,
    joinUrl: `/join?code=${id.toUpperCase()}`,
    detailUrl: `/leagues/${id}`,
    ownerName: "Commissioner One",
    ownerAvatar: null,
    creatorSlug: null,
    creatorName: null,
    tournamentName: null,
    season: 2026,
    scoringMode: "PPR",
    isPaid: true,
    isPrivate: false,
    createdAt: new Date("2026-03-20T12:00:00.000Z").toISOString(),
    fillPct: 75,
    leagueType: "fantasy",
    leagueStyle: "dynasty",
    draftType: "snake",
    draftStatus: "pre_draft",
    teamCount: 12,
    draftDate: new Date("2026-08-19T23:00:00.000Z").toISOString(),
    commissionerName: "Commissioner One",
    aiFeatures: ["AI ADP", "Draft helper"],
    rankingEffectScore: 40,
    inviteOnlyByTier: false,
    canJoinByRanking: true,
    ...overrides,
  }
}

async function installFindLeagueRoutes(
  page: Page,
  options: { withPersonalizedRecommendations?: boolean } = {}
) {
  let latestParams = new URLSearchParams()
  let latestRecommendationParams = new URLSearchParams()
  const pageOne = [
    buildCard("joinable-alpha", { name: "Alpha Dynasty Room" }),
    buildCard("invite-only-beta", {
      name: "Beta Invite Dynasty",
      inviteOnlyByTier: true,
      canJoinByRanking: false,
      rankingEffectScore: 5,
    }),
  ]
  const pageTwo = [
    buildCard("joinable-gamma", {
      name: "Gamma Dynasty Room",
      draftType: "auction",
      draftStatus: "paused",
      aiFeatures: ["AI ADP"],
    }),
  ]
  const recommendationLeague = buildCard("recommended-fit", {
    name: "Recommended Dynasty Fit",
    sport: "NFL",
    draftType: "snake",
    draftStatus: "pre_draft",
    leagueStyle: "dynasty",
    rankingEffectScore: 52,
  })

  await page.route("**/api/discover/recommendations**", async (route) => {
    const url = new URL(route.request().url())
    latestRecommendationParams = url.searchParams
    const aiExplain = url.searchParams.get("aiExplain") === "1"
    if (options.withPersonalizedRecommendations) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          personalized: true,
          aiExplanationEnabled: aiExplain,
          profileSignals: {
            favoriteSports: ["NFL", "NBA"],
            historicalSports: ["NFL", "NHL"],
            pastLeagueCount: 9,
            hasDraftParticipation: true,
            leagueTypesJoined: ["fantasy:dynasty", "source:creator"],
            aiUsageLevel: "high",
          },
          leagues: [
            {
              league: recommendationLeague,
              explanation: aiExplain
                ? "AI sees this as your best fit given your NFL dynasty history and active draft habits."
                : "Strong sport match with your top preference (NFL). Similar league type to what you usually join (dynasty).",
              reasons: [
                "Strong sport match with your top preference (NFL).",
                "Similar league type to what you usually join (dynasty).",
              ],
              matchedSignals: ["favorite_sport", "league_type"],
              explanationSource: aiExplain ? "ai" : "deterministic",
            },
          ],
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        personalized: false,
        leagues: [],
      }),
    })
  })

  await page.route("**/api/discover/leagues**", async (route) => {
    const url = new URL(route.request().url())
    latestParams = url.searchParams
    const pageNum = Math.max(1, Number(url.searchParams.get("page") ?? "1"))
    const leagues = pageNum === 1 ? pageOne : pageTwo
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        leagues,
        total: 3,
        page: pageNum,
        limit: 12,
        totalPages: 2,
        hasMore: pageNum < 2,
        viewerTier: 4,
        viewerTierName: "Rising Starter",
        hiddenByTierPolicy: 1,
      }),
    })
  })

  return {
    getLatestParams: () => latestParams,
    getLatestRecommendationParams: () => latestRecommendationParams,
  }
}

test.describe("@find-league click audit", () => {
  test("filters, ranking effect, pagination, and join controls are fully wired", async ({ page }) => {
    const mocks = await installFindLeagueRoutes(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/find-league", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("find-league-ranking-banner")).toContainText("Rankings effect enabled")
    await expect(page.getByTestId("find-league-card-joinable-alpha")).toBeVisible()
    await expect(page.getByTestId("find-league-join-joinable-alpha")).toBeVisible()
    await expect(page.getByTestId("find-league-invite-required-invite-only-beta")).toBeVisible()
    await expect(page.getByTestId("find-league-join-invite-only-beta")).toHaveCount(0)
    await expect(page.getByTestId("find-league-view-joinable-alpha")).toBeVisible()

    // Join control wiring: visible, enabled, and points at join flow URL.
    await expect(page.getByTestId("find-league-join-joinable-alpha")).toHaveAttribute(
      "href",
      /\/join\?code=JOINABLE-ALPHA/
    )

    // The filters toggle is `sm:hidden` — it exists only on mobile, and its label
    // is "Filters" (it reads "Hide filters" once open), never "Show filters". At
    // this desktop viewport the panel is already expanded, so the old
    // unconditional click waited 30s for a control that is deliberately not
    // rendered here. Click it only when the layout actually collapses the panel.
    const filtersToggle = page.getByRole("button", { name: /^(filters|hide filters)$/i })
    if (await filtersToggle.isVisible().catch(() => false)) {
      await filtersToggle.click()
    }
    await page.getByLabel("Sport").selectOption("NFL")
    await page.getByLabel("League type").selectOption("dynasty")
    await page.getByLabel("Draft type").selectOption("snake")
    await page.getByLabel("Draft status").selectOption("pre_draft")
    await page.getByLabel("Entry fee").selectOption("paid")
    await page.getByLabel("Visibility").selectOption("all")
    await page.getByLabel("Sort").selectOption("ranking_match")
    await page.getByPlaceholder("Min").fill("10")
    await page.getByPlaceholder("Max").fill("14")
    await page.getByRole("checkbox", { name: /ai enabled/i }).check()

    await page.getByTestId("find-league-search-input").fill("alpha")
    await page.getByTestId("find-league-search-submit").click()

    await expect(page.getByTestId("find-league-card-joinable-alpha")).toBeVisible()
    await expect(page.getByTestId("find-league-card-joinable-alpha")).toContainText("League type:")
    await expect(page.getByTestId("find-league-card-joinable-alpha")).toContainText("Draft type:")
    await expect(page.getByTestId("find-league-card-joinable-alpha")).toContainText("Teams filled:")
    await expect(page.getByTestId("find-league-card-joinable-alpha")).toContainText("AI features:")

    const params = mocks.getLatestParams()
    expect(params.get("sport")).toBe("NFL")
    expect(params.get("style")).toBe("dynasty")
    expect(params.get("draftType")).toBe("snake")
    expect(params.get("draftStatus")).toBe("pre_draft")
    expect(params.get("entryFee")).toBe("paid")
    expect(params.get("visibility")).toBe("all")
    expect(params.get("aiEnabled")).toBe("true")
    expect(params.get("sort")).toBe("ranking_match")
    expect(params.get("teamCountMin")).toBe("10")
    expect(params.get("teamCountMax")).toBe("14")
    expect(params.get("q")).toBe("alpha")

    await page.getByRole("button", { name: /next/i }).click()
    await expect(page.getByText(/page 2 of 2/i)).toBeVisible()
    await expect(page.getByTestId("find-league-card-joinable-gamma")).toBeVisible()
    await page.getByRole("button", { name: /previous/i }).click()
    await expect(page.getByText(/page 1 of 2/i)).toBeVisible()
  })

  test("recommendation panel supports deterministic signals and optional AI explanations", async ({ page }) => {
    const mocks = await installFindLeagueRoutes(page, {
      withPersonalizedRecommendations: true,
    })

    await page.setViewportSize({ width: 390, height: 844 })
    // RecommendedLeaguesSection is mounted by PublicLeagueDiscoveryPage
    // (/discover/leagues), not by FindLeagueClient — /find-league never renders it,
    // so this test was asserting a panel on a page that does not host it. The
    // discovery spec does not cover recommendations either, which is why the gap
    // stayed invisible.
    await page.goto("/discover/leagues", { waitUntil: "domcontentloaded" })

    const recommendationSection = page.getByTestId("recommended-leagues-section")
    await expect(recommendationSection).toBeVisible()
    await expect(recommendationSection).toContainText("Deterministic-first matching")
    await expect(recommendationSection).toContainText("Favorite sports: NFL, NBA")
    await expect(recommendationSection).toContainText("Past leagues: 9")
    await expect(recommendationSection).toContainText("Draft participant")
    await expect(recommendationSection).toContainText("AI usage: high")
    await expect(recommendationSection).toContainText("Deterministic explanation")

    const initialRecommendationParams = mocks.getLatestRecommendationParams()
    expect(initialRecommendationParams.get("aiExplain")).toBeNull()

    await page.getByTestId("recommended-leagues-ai-toggle").click()
    await expect(page.getByTestId("recommended-leagues-ai-toggle")).toContainText("AI explanations on")
    await expect(recommendationSection).toContainText("AI-enhanced explanation")
    await expect(recommendationSection).toContainText(
      "AI sees this as your best fit given your NFL dynasty history and active draft habits."
    )

    const aiRecommendationParams = mocks.getLatestRecommendationParams()
    expect(aiRecommendationParams.get("aiExplain")).toBe("1")
  })
})

