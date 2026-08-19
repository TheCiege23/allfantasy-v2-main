import { expect, test } from "@playwright/test"
import { signInAs } from "./helpers/session-cookie"

test.describe.configure({ timeout: 180_000 })

test.describe("@hall-of-fame full click audit", () => {
  test("audits league Hall of Fame interactions end to end", async ({ page }) => {
    const leagueId = `e2e-hof-${Date.now()}`
    const season = "2026"

    const rebuildPosts: Array<Record<string, unknown>> = []
    const syncPosts: Array<Record<string, unknown>> = []
    const runPosts: Array<Record<string, unknown>> = []
    const storyPosts: Array<Record<string, unknown>> = []

    const hofRows = [
      { rosterId: "mgr_1", championships: 3, seasonsPlayed: 8, score: 0.872 },
      { rosterId: "mgr_2", championships: 1, seasonsPlayed: 6, score: 0.662 },
    ]
    const seasonRows = [
      { rosterId: "mgr_1", wins: 11, losses: 3, pointsFor: 1678, champion: true },
      { rosterId: "mgr_2", wins: 9, losses: 5, pointsFor: 1540, champion: false },
    ]
    let entriesState = [
      {
        id: "entry-1",
        entityType: "MANAGER",
        entityId: "mgr_1",
        sport: "NFL",
        leagueId,
        season,
        category: "all_time_great_managers",
        title: "All-Time Great Manager — mgr_1",
        summary: "Three titles in the measured window.",
        inductedAt: new Date().toISOString(),
        score: 0.88,
      },
      {
        id: "entry-2",
        entityType: "MOMENT",
        entityId: "matchup_41",
        sport: "NFL",
        leagueId,
        season,
        category: "biggest_upsets",
        title: "Big Upset — mgr_2 over mgr_1",
        summary: "A major seed-gap upset.",
        inductedAt: new Date().toISOString(),
        score: 0.81,
      },
    ]
    let momentsState = [
      {
        id: "moment-1",
        leagueId,
        sport: "NFL",
        season,
        headline: "Championship — Season 2026",
        summary: "A dramatic title finish.",
        relatedManagerIds: ["mgr_1", "mgr_2"],
        relatedTeamIds: ["mgr_1"],
        relatedMatchupId: null,
        significanceScore: 0.93,
        createdAt: new Date().toISOString(),
      },
    ]

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/entries?**`, async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get("sport")
      const category = url.searchParams.get("category")
      const entityType = url.searchParams.get("entityType")
      const seasonFilter = url.searchParams.get("season")
      const scoped = entriesState.filter((row) => {
        const bySport = sport ? row.sport === sport : true
        const byCategory = category ? row.category === category : true
        const byEntityType = entityType ? row.entityType === entityType : true
        const bySeason = seasonFilter ? row.season === seasonFilter : true
        return bySport && byCategory && byEntityType && bySeason
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ leagueId, entries: scoped, total: scoped.length }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/moments?**`, async (route) => {
      const url = new URL(route.request().url())
      const sport = url.searchParams.get("sport")
      const seasonFilter = url.searchParams.get("season")
      const scoped = momentsState.filter((row) => {
        const bySport = sport ? row.sport === sport : true
        const bySeason = seasonFilter ? row.season === seasonFilter : true
        return bySport && bySeason
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ leagueId, moments: scoped, total: scoped.length }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/entries/entry-2`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entry: entriesState[1],
          whyInductedPrompt: "Category: biggest_upsets\nSignificance score: 0.81",
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/moments/moment-1`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          moment: momentsState[0],
          whyInductedPrompt: "Season: 2026\nSignificance score: 0.93",
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/tell-story`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      storyPosts.push(payload)
      const type = String(payload.type ?? "")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative:
            type === "entry"
              ? "This induction matters because the upset changed league history and title odds."
              : "This moment matters because the title game reshaped league legacy context.",
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/sync-moments`, async (route) => {
      const payload = (route.request().postDataJSON?.() ?? {}) as Record<string, unknown>
      syncPosts.push(payload)
      momentsState = [
        ...momentsState,
        {
          id: "moment-2",
          leagueId,
          sport: "NFL",
          season,
          headline: "Record season — mgr_1",
          summary: "A record points-for run.",
          relatedManagerIds: ["mgr_1"],
          relatedTeamIds: ["mgr_1"],
          relatedMatchupId: null,
          significanceScore: 0.79,
          createdAt: new Date().toISOString(),
        },
      ]
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, leagueId, created: 1, sport: "NFL" }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/run`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      runPosts.push(payload)
      entriesState = [
        ...entriesState,
        {
          id: "entry-3",
          entityType: "DYNASTY_RUN",
          entityId: "mgr_1",
          sport: "NFL",
          leagueId,
          season,
          category: "longest_dynasties",
          title: "Dynasty Run — mgr_1",
          summary: "Three titles in six seasons.",
          inductedAt: new Date().toISOString(),
          score: 0.86,
        },
      ]
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagueId,
          entriesCreated: 1,
          entriesUpdated: 2,
          momentsCreated: 1,
          managersInducted: 2,
          teamsInducted: 1,
          dynastiesInducted: 1,
          championshipRunsInducted: 1,
          recordSeasonsInducted: 1,
          iconicRivalriesInducted: 0,
        }),
      })
    })

    const hallOfFameRouteHandler = async (route: any) => {
      if (route.request().method() === "POST") {
        rebuildPosts.push({})
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ leagueId, rebuilt: true }),
        })
        return
      }
      const url = new URL(route.request().url())
      const seasonParam = url.searchParams.get("season")
      if (seasonParam) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ leagueId, season: seasonParam, rows: seasonRows }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ leagueId, rows: hofRows }),
      })
    }
    await page.route(`**/api/leagues/${leagueId}/hall-of-fame`, hallOfFameRouteHandler)
    await page.route(`**/api/leagues/${leagueId}/hall-of-fame?**`, hallOfFameRouteHandler)

    // The entry-detail leg of this test lands on /app/league/*, which is
    // session-gated; anonymously it 307s to /login and the detail assertions
    // fail as missing buttons rather than as a redirect.
    await signInAs(page, { id: "e2e-hof-user" })

    await page.goto(`/e2e/hall-of-fame?leagueId=${leagueId}`)
    await expect(page.getByRole("heading", { name: /e2e hall of fame harness/i })).toBeVisible()
    await expect(page.getByText(/Hall of Fame/i).first()).toBeVisible()
    await expect(page.getByText(/Manager mgr_1/i).first()).toBeVisible()

    await page.getByTestId("hof-season-filter").selectOption(season)
    await page.getByTestId("hof-rebuild").click()
    await expect.poll(() => rebuildPosts.length).toBeGreaterThan(0)

    await page.getByTestId("hof-sport-filter").selectOption("NFL")
    await page.getByTestId("hof-category-filter").selectOption("biggest_upsets")
    await page.getByTestId("hof-entity-type-filter").selectOption("MOMENT")
    await page.getByTestId("hof-timeline-sort").selectOption("recent")
    await page.getByTestId("hof-refresh").click()
    await expect(page.getByText(/Big Upset/i).first()).toBeVisible()

    await page.getByTestId("hof-sync-moments").click()
    await expect.poll(() => syncPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/Synced moments:/i)).toBeVisible()

    await page.getByTestId("hof-run-engine").click()
    await expect.poll(() => runPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/Engine complete:/i)).toBeVisible()

    await page.getByTestId("hof-entry-story-entry-2").click()
    await expect.poll(() => storyPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/changed league history and title odds/i)).toBeVisible()

    await page.getByTestId("hof-moment-story-moment-1").click()
    await expect(page.getByText(/title game reshaped league legacy context/i)).toBeVisible()

    const entryDetailHref = await page.getByTestId("hof-entry-detail-entry-2").getAttribute("href")
    expect(entryDetailHref).toContain(`/app/league/${leagueId}/hall-of-fame/entries/entry-2`)
    await page.goto(String(entryDetailHref))
    await expect(page.getByRole("button", { name: /tell me why this matters/i }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: /back to hall of fame/i })).toHaveAttribute(
      "href",
      /tab=Hall of Fame/
    )
    await page.getByRole("button", { name: /tell me why this matters/i }).first().click()
    await expect(page.getByText(/changed league history and title odds/i)).toBeVisible()
  })

  test("audits platform Hall of Fame view interactions", async ({ page }) => {
    const leagueId = `e2e-platform-hof-${Date.now()}`
    const entries = [
      {
        id: "platform-entry-1",
        entityType: "MANAGER",
        entityId: "mgr_alpha",
        sport: "NFL",
        leagueId,
        season: "2026",
        category: "all_time_great_managers",
        title: "All-Time Great Manager — mgr_alpha",
        summary: "An elite track record across multiple years.",
        inductedAt: new Date().toISOString(),
        score: 0.9,
      },
    ]
    const moments = [
      {
        id: "platform-moment-1",
        leagueId,
        sport: "NFL",
        season: "2026",
        headline: "Championship — Season 2026",
        summary: "A defining title run.",
        significanceScore: 0.94,
        createdAt: new Date().toISOString(),
      },
    ]
    const platformRefreshes: string[] = []
    const storyPosts: Array<Record<string, unknown>> = []

    await page.route(`**/api/hall-of-fame/entries?**`, async (route) => {
      platformRefreshes.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries, total: entries.length }),
      })
    })
    await page.route(`**/api/hall-of-fame/moments?**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ moments, total: moments.length }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/hall-of-fame/tell-story`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      storyPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative:
            "This cross-league Hall of Fame highlight matters because it anchors long-term commissioner storytelling.",
        }),
      })
    })

    await page.goto("/e2e/hall-of-fame-platform")
    await expect(page.getByRole("heading", { name: /e2e platform hall of fame harness/i })).toBeVisible()

    await page.getByTestId("platform-hof-sport-filter").selectOption("NFL")
    await page.getByTestId("platform-hof-season-filter").fill("2026")
    await page.getByTestId("platform-hof-category-filter").selectOption("all_time_great_managers")
    await page.getByTestId("platform-hof-league-filter").fill(leagueId)
    await page.getByTestId("platform-hof-refresh").click()
    await expect.poll(() => platformRefreshes.length).toBeGreaterThan(0)

    await expect(page.getByText(/All-Time Great Manager/i)).toBeVisible()
    await expect(page.getByText(/Championship — Season 2026/i)).toBeVisible()

    await page.getByTestId("platform-hof-entry-story-platform-entry-1").click()
    await expect.poll(() => storyPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/anchors long-term commissioner storytelling/i)).toBeVisible()

    await page.getByTestId("platform-hof-moment-story-platform-moment-1").click()
    await expect(page.getByText(/anchors long-term commissioner storytelling/i)).toBeVisible()
  })
})
