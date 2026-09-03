import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers/session-cookie";

test.describe.configure({ timeout: 180_000 });

test.describe("@relationship integration click audit", () => {
  test("audits unified relationship/storytelling drill-down paths", async ({ page }) => {
    const insightGets: Array<{ sport: string | null; season: string | null }> = [];
    const insightPosts: Array<Record<string, unknown>> = [];
    const explainPosts: Array<Record<string, unknown>> = [];
    const dramaTimelineCalls: Array<{ relatedManagerId: string | null; sport: string | null; season: string | null }> = [];
    const rivalryPairCalls: Array<{ managerAId: string | null; managerBId: string | null }> = [];

    await page.route("**/api/leagues/league_rel_1/relationship-insights/explain", async (route) => {
      explainPosts.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative:
            "This rivalry escalates because graph centrality, behavior heat, and recent drama are aligned around the same manager pair.",
          source: "ai",
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/relationship-insights**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/relationship-insights/explain")) {
        await route.fallback();
        return;
      }
      if (route.request().method() === "POST") {
        insightPosts.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            orchestration: { leagueId: "league_rel_1", sport: "NBA", season: 2026, graphRebuilt: true },
            insights: {
              leagueId: "league_rel_1",
              sport: "NBA",
              season: 2026,
              relationshipProfile: { strongestRivalries: [], influenceLeaders: [], centralManagers: [] },
              rivalries: [{ id: "riv_1" }],
              profiles: [{ id: "profile_1" }],
              drama: [{ id: "evt_1" }],
              storylines: [
                {
                  id: "story_1",
                  headline: "team_alpha vs team_bravo rivalry surge",
                  storylineScore: 92,
                  rivalryId: "riv_1",
                  rivalryTier: "Heated",
                  dramaEventId: "evt_1",
                  dramaType: "RIVALRY_CLASH",
                  managerAId: "team_alpha",
                  managerBId: "team_bravo",
                  reasons: ["Rivalry score 90", "Linked drama RIVALRY_CLASH"],
                },
              ],
            },
          }),
        });
        return;
      }

      insightGets.push({
        sport: url.searchParams.get("sport"),
        season: url.searchParams.get("season"),
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagueId: "league_rel_1",
          sport: "NBA",
          season: 2026,
          relationshipProfile: { strongestRivalries: [{ id: "x" }], influenceLeaders: [], centralManagers: [] },
          rivalries: [{ id: "riv_1" }],
          profiles: [{ id: "profile_1" }],
          drama: [{ id: "evt_1" }],
          storylines: [
            {
              id: "story_1",
              headline: "team_alpha vs team_bravo rivalry surge",
              storylineScore: 92,
              rivalryId: "riv_1",
              rivalryTier: "Heated",
              dramaEventId: "evt_1",
              dramaType: "RIVALRY_CLASH",
              managerAId: "team_alpha",
              managerBId: "team_bravo",
              reasons: ["Rivalry score 90", "Linked drama RIVALRY_CLASH"],
            },
          ],
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/rivalries/riv_1/timeline**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timeline: [
            {
              eventId: "rev_1",
              eventType: "h2h_matchup",
              season: 2026,
              matchupId: "match_1",
              tradeId: null,
              description: "Intense head-to-head matchup.",
              createdAt: "2026-03-20T00:00:00.000Z",
            },
          ],
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/rivalries/riv_1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "riv_1",
          leagueId: "league_rel_1",
          sport: "NBA",
          sportLabel: "NBA",
          managerAId: "team_alpha",
          managerBId: "team_bravo",
          rivalryScore: 90,
          rivalryTier: "Heated",
          tierBadgeColor: "red",
          firstDetectedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
          eventCount: 5,
          linkedDramaCount: 1,
          linkedDramaEventIds: ["evt_1"],
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/rivalries?**", async (route) => {
      const url = new URL(route.request().url());
      rivalryPairCalls.push({
        managerAId: url.searchParams.get("managerAId"),
        managerBId: url.searchParams.get("managerBId"),
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rivalries: [{ id: "riv_1" }],
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/drama/timeline**", async (route) => {
      const url = new URL(route.request().url());
      dramaTimelineCalls.push({
        relatedManagerId: url.searchParams.get("relatedManagerId"),
        sport: url.searchParams.get("sport"),
        season: url.searchParams.get("season"),
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timeline: [
            {
              id: "evt_1",
              dramaType: "RIVALRY_CLASH",
              headline: "team_alpha vs team_bravo rivalry clash",
              summary: "A rivalry game with playoff implications.",
              dramaScore: 87,
              relatedManagerIds: ["team_alpha", "team_bravo"],
              relatedTeamIds: ["team_alpha", "team_bravo"],
              relatedMatchupId: "match_1",
            },
          ],
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/drama/evt_1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "evt_1",
          leagueId: "league_rel_1",
          headline: "team_alpha vs team_bravo rivalry clash",
          summary: "A rivalry game with playoff implications.",
          dramaType: "RIVALRY_CLASH",
          dramaScore: 87,
          relatedManagerIds: ["team_alpha", "team_bravo"],
          relatedTeamIds: ["team_alpha", "team_bravo"],
          relatedMatchupId: "match_1",
          createdAt: "2026-03-20T00:00:00.000Z",
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/drama/tell-story", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          narrative: "This rivalry storyline ties directly to graph centrality and behavior signals.",
          source: "ai",
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/psychological-profiles/profile_1/evidence**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          evidence: [
            {
              id: "ev_1",
              evidenceType: "trade_activity",
              value: 88,
              sourceReference: "trade_history",
              createdAt: "2026-03-20T00:00:00.000Z",
            },
          ],
        }),
      });
    });

    await page.route("**/api/leagues/league_rel_1/psychological-profiles/profile_1?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "profile_1",
          leagueId: "league_rel_1",
          managerId: "team_alpha",
          sport: "NBA",
          sportLabel: "NBA",
          profileLabels: ["aggressive trader"],
          aggressionScore: 84,
          activityScore: 78,
          tradeFrequencyScore: 90,
          waiverFocusScore: 42,
          riskToleranceScore: 76,
          evidence: [
            {
              id: "ev_1",
              evidenceType: "trade_activity",
              value: 88,
              sourceReference: "trade_history",
              createdAt: "2026-03-20T00:00:00.000Z",
            },
          ],
        }),
      });
    });

    /*
     * `/app/league/*` is session-gated (lib/auth/session-auth-paths.ts). The gate only
     * fires when NEXTAUTH_SECRET is set — unset locally, SET in CI — so anonymously this
     * spec passed on a developer machine and 307'd to /login on every CI run, failing as
     * "element(s) not found" rather than as a redirect. Same fix, same reason, as
     * league-drama / hall-of-fame / legacy-score.
     */
    await signInAs(page, { id: "e2e-relationship-user" });

    await page.goto("/app/league/league_rel_1/relationship-insights");
    await expect(page.getByRole("heading", { name: "Relationship & Storytelling Insights" })).toBeVisible();
    await page.getByLabel("Unified insights sport filter").selectOption("NBA");
    await page.getByLabel("Unified insights season filter").fill("2026");
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("button", { name: "Sync layer" }).click();
    await page.getByRole("button", { name: "AI explain" }).first().click();
    await expect.poll(() => explainPosts.length).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Rivalry context" }).first().click();
    await page.waitForURL("**/app/league/league_rel_1/rivalries/riv_1**");
    await expect(page.getByRole("heading", { name: "Rivalry Detail" })).toBeVisible();
    await page.getByRole("link", { name: /Open linked drama context/i }).click();
    await page.waitForURL("**/app/league/league_rel_1/drama**");
    await expect(page.getByRole("heading", { name: "League Drama Timeline" })).toBeVisible();
    await page.getByRole("link", { name: "Story detail" }).click();
    await page.waitForURL("**/app/league/league_rel_1/drama/evt_1");
    await page.getByRole("button", { name: "Open linked rivalry" }).click();
    await page.waitForURL("**/app/league/league_rel_1/rivalries/riv_1**");

    await page.goto("/app/league/league_rel_1/psychological-profiles/profile_1?tab=evidence");
    await expect(page.getByRole("heading", { name: "Manager Psychological Profile" })).toBeVisible();
    await page.getByRole("link", { name: "Open trade context" }).click();
    await page.waitForURL("**/app/league/league_rel_1?tab=Trades");

    expect(insightGets.some((c) => c.sport === "NBA" && c.season === "2026")).toBe(true);
    expect(insightPosts.length).toBeGreaterThan(0);
    expect(explainPosts.length).toBeGreaterThan(0);
    expect(dramaTimelineCalls.some((c) => c.relatedManagerId === "team_alpha")).toBe(true);
    expect(rivalryPairCalls.some((c) => c.managerAId === "team_alpha" && c.managerBId === "team_bravo")).toBe(true);
  });
});
