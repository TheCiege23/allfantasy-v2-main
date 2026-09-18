import { expect, test } from "@playwright/test"

test.describe.configure({ timeout: 180_000 })

test.describe("@rankings-v2 click audit", () => {
  test("audits rankings ai, coach insight, year plan, and mobile toggles", async ({ page }) => {
    const clickTestIdWithRetry = async (testId: string) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const target = page.getByTestId(testId).first()
        await target.waitFor({ state: "visible", timeout: 10_000 })
        try {
          await target.click({ timeout: 5_000 })
          return
        } catch {
          await page.waitForTimeout(250)
        }
      }
      await page.getByTestId(testId).first().click()
    }

    let coachCalls = 0
    let yearPlanCalls = 0
    const teams = [
      {
        rosterId: 1,
        ownerId: "owner-1",
        username: "alpha",
        displayName: "Alpha",
        avatar: null,
        winScore: 72,
        powerScore: 74,
        luckScore: 51,
        marketValueScore: 69,
        managerSkillScore: 66,
        composite: 75,
        rank: 1,
        prevRank: 2,
        rankDelta: -1,
        record: { wins: 7, losses: 2, ties: 0 },
        pointsFor: 1018.4,
        pointsAgainst: 940.8,
        expectedWins: 6.2,
        streak: 2,
        luckDelta: 0.8,
        shouldBeRecord: { wins: 6, losses: 3 },
        bounceBackIndex: 58,
        motivationalFrame: {
          headline: "Keep pressure on contenders",
          subtext: "Your process is stable and your weekly floor is improving.",
          suggestedAction: "Use depth to shop a 2-for-1 upgrade.",
          tone: "encouraging",
          trigger: "rank_change",
        },
        starterValue: 6150,
        benchValue: 2875,
        totalRosterValue: 9025,
        pickValue: 650,
        positionValues: {
          QB: { starter: 86, bench: 58, total: 144 },
          RB: { starter: 82, bench: 61, total: 143 },
          WR: { starter: 80, bench: 55, total: 135 },
          TE: { starter: 73, bench: 44, total: 117 },
        },
        rosterExposure: { QB: 24, RB: 34, WR: 31, TE: 11 },
        portfolioProjection: { year1: 76, year3: 72, year5: 68, volatilityBand: 12 },
        marketAdj: 2.1,
        phase: "in_season",
        explanation: {
          confidence: {
            score: 76,
            rating: "HIGH",
            drivers: [
              { id: "record_surge", polarity: "UP", impact: 0.34, evidence: { wins: 7, losses: 2, streak: 2 } },
            ],
          },
          drivers: [
            { id: "record_surge", polarity: "UP", impact: 0.34, evidence: { wins: 7, losses: 2, streak: 2 } },
            { id: "power_strength_gain", polarity: "UP", impact: 0.21, evidence: { psPercentile: 82 } },
          ],
          nextActions: [
            {
              id: "act-1",
              title: "Convert depth into starter upgrades",
              why: "Bench surplus can improve weekly ceiling.",
              expectedImpact: "MEDIUM",
              cta: { label: "Open Trade Hub", href: "/trade-finder" },
            },
          ],
          valid: true,
        },
        badges: [],
        rankChangeDrivers: [
          { id: "record_surge", label: "Win Streak Surge", polarity: "UP", value: 7, prevValue: 5, delta: 2, unit: "wins" },
        ],
        forwardOdds: { playoffPct: 78, top3Pct: 56, titlePct: 22, simCount: 2000 },
        confidenceBadge: { tier: "GOLD", label: "Stable", tooltip: "High data coverage and consistent trend signals." },
        rankSparkline: [3, 2, 2, 1],
      },
      {
        rosterId: 2,
        ownerId: "owner-2",
        username: "bravo",
        displayName: "Bravo",
        avatar: null,
        winScore: 66,
        powerScore: 63,
        luckScore: 48,
        marketValueScore: 64,
        managerSkillScore: 59,
        composite: 67,
        rank: 2,
        prevRank: 1,
        rankDelta: 1,
        record: { wins: 6, losses: 3, ties: 0 },
        pointsFor: 973.2,
        pointsAgainst: 948.6,
        expectedWins: 5.7,
        streak: -1,
        luckDelta: -0.3,
        shouldBeRecord: { wins: 6, losses: 3 },
        bounceBackIndex: 45,
        motivationalFrame: {
          headline: "Tighten weekly floor",
          subtext: "Big-play variance is masking position fragility.",
          suggestedAction: "Add a safer RB2 profile before playoffs.",
          tone: "cautionary",
          trigger: "streak_change",
        },
        starterValue: 5988,
        benchValue: 2604,
        totalRosterValue: 8592,
        pickValue: 580,
        positionValues: {
          QB: { starter: 74, bench: 50, total: 124 },
          RB: { starter: 71, bench: 49, total: 120 },
          WR: { starter: 76, bench: 53, total: 129 },
          TE: { starter: 62, bench: 38, total: 100 },
        },
        rosterExposure: { QB: 22, RB: 33, WR: 33, TE: 12 },
        portfolioProjection: { year1: 70, year3: 65, year5: 62, volatilityBand: 15 },
        marketAdj: 1.2,
        phase: "in_season",
        explanation: {
          confidence: {
            score: 68,
            rating: "MEDIUM",
            drivers: [
              { id: "record_slide", polarity: "DOWN", impact: 0.22, evidence: { wins: 6, losses: 3, streak: -1 } },
            ],
          },
          drivers: [
            { id: "record_slide", polarity: "DOWN", impact: 0.22, evidence: { wins: 6, losses: 3, streak: -1 } },
          ],
          nextActions: [],
          valid: true,
        },
        badges: [],
        rankChangeDrivers: [],
        forwardOdds: { playoffPct: 63, top3Pct: 37, titlePct: 14, simCount: 2000 },
        confidenceBadge: { tier: "SILVER", label: "Moderate", tooltip: "Decent coverage with some variance." },
        rankSparkline: [1, 1, 2, 2],
      },
    ]

    await page.route("**/api/admin/usage/log", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/leagues/league_rankings_v2_1/ldi-heatmap**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagueId: "league_rankings_v2_1",
          leagueName: "Audit League",
          season: "2026",
          week: 8,
          phase: "in_season",
          computedAt: Date.now(),
          cells: [],
        }),
      })
    })

    await page.route("**/api/rankings/league-v2**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagueId: "league_rankings_v2_1",
          leagueName: "Audit League",
          season: "2026",
          week: 8,
          phase: "in_season",
          isDynasty: true,
          isSuperFlex: true,
          teams,
          weeklyPointsDistribution: [
            { rosterId: 1, weeklyPoints: [121.2, 114.8, 131.5, 127.7] },
            { rosterId: 2, weeklyPoints: [117.2, 120.1, 108.3, 112.4] },
          ],
          computedAt: Date.now(),
          marketInsights: [],
          ldiChips: [],
          weeklyAwards: null,
          tradeHubShortcuts: [],
          partnerTendencies: [],
        }),
      })
    })

    await page.route("**/api/rankings/league-v2", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback()
        return
      }
      coachCalls += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bullets: [
            "You are leveraging roster depth effectively.",
            "TE replacement value is lagging league baseline.",
            "Package depth for one impact starter before playoffs.",
          ],
          challenge: "Complete one 2-for-1 upgrade this week.",
          tone: "motivational",
        }),
      })
    })

    await page.route("**/api/rankings/dynasty-roadmap", async (route) => {
      yearPlanCalls += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          roadmap: {
            horizon: "3-5 Year Plan",
            currentPhase: "Contending",
            overallStrategy: "Hold your contender window while reducing depth fragility.",
            yearPlans: [
              {
                year: 1,
                label: "Year 1: Stabilize Core",
                priorities: ["Upgrade RB2 floor", "Reduce bench overlap"],
                keyMoves: ["Trade two bench WRs for one top-24 RB"],
                targetPositions: ["RB", "TE"],
              },
            ],
            riskFactors: ["Injury risk concentration at RB."],
          },
        }),
      })
    })

    await page.goto("/e2e/rankings-v2", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("heading", { name: "Rankings V2 Harness" })).toBeVisible()
    await expect(page.getByTestId("rankings-v2-panel")).toBeVisible()

    await clickTestIdWithRetry("rankings-v2-view-tab-power")
    await clickTestIdWithRetry("rankings-v2-view-tab-dynasty")
    await clickTestIdWithRetry("rankings-v2-view-tab-composite")

    await page.getByTestId("rankings-v2-team-toggle-desktop-1").click()
    const expanded = page.getByTestId("rankings-v2-team-expanded-1")
    await expect(expanded).toBeVisible()

    /*
     * The manager-psychology panel this audit used to drive between the expand and the
     * coach insight was retired by dcaaa6946 (2026-09-10, "ownerless Competitive Edge
     * privacy pass") along with its API routes. The assertions below had not run since,
     * because the test died on `manager-psychology-panel` before reaching them.
     */
    await page.getByTestId("rankings-v2-coach-insight-button").click()
    await expect.poll(() => coachCalls).toBe(1)
    await expect(page.getByText(/What you're doing well/i)).toBeVisible()

    await page.getByTestId("rankings-v2-generate-year-plan-button").click()
    await expect.poll(() => yearPlanCalls).toBe(1)
    await expect(page.getByTestId("rankings-v2-regenerate-year-plan-button")).toBeVisible()
    await page.getByTestId("rankings-v2-regenerate-year-plan-button").click()
    await expect(page.getByTestId("rankings-v2-generate-year-plan-button")).toBeVisible()

    await page.getByTestId("rankings-v2-team-toggle-desktop-1").click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId("rankings-v2-team-toggle-mobile-1").click()
    await expect(page.getByTestId("rankings-v2-team-expanded-1")).toBeVisible()
  })
})
