import { expect, test } from "@playwright/test"
import { signInAs } from "./helpers/session-cookie"

test.describe.configure({ timeout: 180_000 })

test.describe("@legacy-score full click audit", () => {
  test("audits league legacy score interactions", async ({ page }) => {
    const leagueId = `e2e-legacy-${Date.now()}`

    const runPosts: Array<Record<string, unknown>> = []
    const explainPosts: Array<Record<string, unknown>> = []

    let leagueRows = [
      {
        id: "legacy-row-1",
        entityType: "MANAGER",
        entityId: "mgr_alpha",
        sport: "NFL",
        leagueId,
        overallLegacyScore: 78,
        championshipScore: 84,
        playoffScore: 76,
        consistencyScore: 75,
        rivalryScore: 61,
        awardsScore: 57,
        dynastyScore: 72,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "legacy-row-2",
        entityType: "MANAGER",
        entityId: "mgr_beta",
        sport: "NFL",
        leagueId,
        overallLegacyScore: 69,
        championshipScore: 64,
        playoffScore: 71,
        consistencyScore: 68,
        rivalryScore: 59,
        awardsScore: 52,
        dynastyScore: 66,
        updatedAt: new Date().toISOString(),
      },
    ]

    await page.route(`**/api/leagues/${leagueId}/legacy-score?**`, async (route) => {
      const url = new URL(route.request().url())
      const entityType = url.searchParams.get("entityType")
      const entityId = url.searchParams.get("entityId")
      const sport = url.searchParams.get("sport")
      if (entityType && entityId) {
        const record =
          leagueRows.find(
            (row) =>
              row.entityType === entityType &&
              row.entityId === entityId &&
              (!sport || row.sport === sport)
          ) ?? null
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ leagueId, record }),
        })
        return
      }
      const scoped = leagueRows.filter((row) => {
        const byType = entityType ? row.entityType === entityType : true
        const bySport = sport ? row.sport === sport : true
        return byType && bySport
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ leagueId, records: scoped, total: scoped.length }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/legacy-score/run`, async (route) => {
      const payload = (route.request().postDataJSON?.() ?? {}) as Record<string, unknown>
      runPosts.push(payload)
      leagueRows = [
        ...leagueRows,
        {
          id: "legacy-row-3",
          entityType: "TEAM",
          entityId: "team_1",
          sport: "NFL",
          leagueId,
          overallLegacyScore: 74,
          championshipScore: 79,
          playoffScore: 73,
          consistencyScore: 70,
          rivalryScore: 62,
          awardsScore: 55,
          dynastyScore: 69,
          updatedAt: new Date().toISOString(),
        },
      ]
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          leagueId,
          processed: 3,
          managerProcessed: 2,
          teamProcessed: 1,
          franchiseProcessed: 0,
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/legacy-score/explain`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      explainPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative:
            "Legacy remains high due to championships and playoff consistency, with rivalry and awards as secondary drivers.",
        }),
      })
    })

    await page.route(`**/api/leagues/${leagueId}/legacy-score/breakdown?**`, async (route) => {
      const url = new URL(route.request().url())
      const entityType = String(url.searchParams.get("entityType") ?? "")
      const entityId = String(url.searchParams.get("entityId") ?? "")
      const record =
        leagueRows.find((row) => row.entityType === entityType && row.entityId === entityId) ??
        leagueRows[0]
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagueId,
          record,
          breakdown: {
            championshipScore: record.championshipScore,
            playoffScore: record.playoffScore,
            consistencyScore: record.consistencyScore,
            rivalryScore: record.rivalryScore,
            awardsScore: record.awardsScore,
            dynastyScore: record.dynastyScore,
          },
        }),
      })
    })

    // This test starts on the ungated harness but then follows the breakdown
    // link onto /app/league/*, which is session-gated — without a session that
    // navigation 307s to /login and the breakdown assertions fail as missing text.
    await signInAs(page, { id: "e2e-legacy-user" })

    await page.goto(`/e2e/legacy-score?leagueId=${leagueId}`)
    await expect(page.getByRole("heading", { name: /e2e legacy score harness/i })).toBeVisible()
    await expect(page.getByText(/Legacy Score/i).first()).toBeVisible()

    await page.getByTestId("legacy-sport-filter").selectOption("NFL")
    await page.getByTestId("legacy-entity-type-filter").selectOption("MANAGER")
    await page.getByTestId("legacy-refresh").click()
    await expect(page.getByTestId("legacy-breakdown-link-MANAGER:mgr_alpha")).toBeVisible()

    await expect(page.getByTestId("legacy-compare-a")).toBeVisible()
    await expect(page.getByTestId("legacy-compare-b")).toBeVisible()

    await page.getByTestId("legacy-ai-explain-MANAGER:mgr_alpha").click()
    await expect.poll(() => explainPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/playoff consistency/i)).toBeVisible()

    await page.getByTestId("legacy-run-engine").click()
    await expect.poll(() => runPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/Engine complete:/i)).toBeVisible()

    const breakdownHref = await page
      .getByTestId("legacy-breakdown-link-MANAGER:mgr_alpha")
      .getAttribute("href")
    expect(breakdownHref).toContain(`/app/league/${leagueId}/legacy/breakdown`)
    await page.goto(String(breakdownHref))

    await expect(page.getByText(/Legacy score breakdown/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /why is this score high/i })).toBeVisible()
    await expect(page.getByRole("link", { name: /back to legacy/i })).toHaveAttribute(
      "href",
      /tab=Legacy/
    )

    await page.getByRole("button", { name: /why is this score high/i }).click()
    await expect(page.getByText(/championships and playoff consistency/i)).toBeVisible()
  })

  test("audits platform legacy leaderboard interactions", async ({ page }) => {
    const leagueId = `e2e-platform-legacy-${Date.now()}`
    const platformRows = [
      {
        id: "platform-legacy-row-1",
        entityType: "MANAGER",
        entityId: "mgr_gamma",
        sport: "NFL",
        leagueId,
        overallLegacyScore: 81,
        championshipScore: 87,
        playoffScore: 78,
        consistencyScore: 77,
        rivalryScore: 68,
        awardsScore: 60,
        dynastyScore: 79,
        updatedAt: new Date().toISOString(),
      },
    ]
    const refreshHits: string[] = []
    const explainPosts: Array<Record<string, unknown>> = []

    await page.route(`**/api/legacy-score/leaderboard?**`, async (route) => {
      refreshHits.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          records: platformRows,
          total: platformRows.length,
        }),
      })
    })
    await page.route(`**/api/leagues/${leagueId}/legacy-score/explain`, async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      explainPosts.push(payload)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative:
            "This platform legacy profile stands out due to title conversion and season-to-season stability.",
        }),
      })
    })

    await page.goto("/e2e/legacy-score-platform")
    await expect(page.getByRole("heading", { name: /e2e platform legacy harness/i })).toBeVisible()

    await page.getByTestId("platform-legacy-sport-filter").selectOption("NFL")
    await page.getByTestId("platform-legacy-entity-filter").selectOption("MANAGER")
    await page.getByTestId("platform-legacy-league-filter").fill(leagueId)
    await page.getByTestId("platform-legacy-refresh").click()
    await expect.poll(() => refreshHits.length).toBeGreaterThan(0)

    await expect(page.getByText(/mgr_gamma/i)).toBeVisible()
    await expect(page.getByText(/Open league Legacy tab/i)).toBeVisible()
    await expect(page.getByText(/Why is this score high/i)).toBeVisible()

    await page.getByTestId(`platform-legacy-explain-MANAGER:mgr_gamma:${leagueId}`).click()
    await expect.poll(() => explainPosts.length).toBeGreaterThan(0)
    await expect(page.getByText(/title conversion and season-to-season stability/i)).toBeVisible()
  })
})
