import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers/session-cookie";

test.describe.configure({ timeout: 180_000 });

test.describe("@graph league intelligence click audit", () => {
  test("audits graph panel interactions and API wiring", async ({ page }) => {
    const profileCalls: Array<{ season: string | null; sport: string | null; rebuild: string | null }> = [];
    const mapCalls: Array<{ season: string | null; sport: string | null; rebuild: string | null }> = [];
    const insightCalls: Array<Record<string, unknown>> = [];
    const rivalryCalls: Array<{ method: string; url: string }> = [];

    await page.route("**/api/bracket/my-leagues", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagues: [{ id: "league_graph_1", name: "Graph League", _count: { members: 12, entries: 12 } }],
        }),
      });
    });
    await page.route("**/api/bracket/leagues/league_graph_1/standings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          standings: [
            { entryId: "teamA", entryName: "Alpha", ownerName: "Alpha Manager", points: 901, picksCount: 100, rank: 1 },
            { entryId: "teamB", entryName: "Bravo", ownerName: "Bravo Manager", points: 855, picksCount: 98, rank: 2 },
          ],
        }),
      });
    });
    await page.route("**/api/bracket/entries?**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ entries: [] }) });
    });
    await page.route("**/api/league/roster?**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ roster: null }) });
    });
    await page.route("**/api/bracket/leagues/league_graph_1/chat", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) });
    });
    await page.route("**/api/legacy/identity", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ identity: { recommendedUserId: "graph-user-1", source: "e2e" } }),
      });
    });
    await page.route("**/api/leagues/league_graph_1/dynasty-backfill", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dynastySeasons: [
            { season: 2024, platformLeagueId: "p-2024", importedAt: "2026-03-20T00:00:00.000Z" },
            { season: 2025, platformLeagueId: "p-2025", importedAt: "2026-03-20T00:00:00.000Z" },
          ],
        }),
      });
    });
    await page.route("**/api/leagues/league_graph_1/relationship-profile**", async (route) => {
      const url = new URL(route.request().url());
      profileCalls.push({
        season: url.searchParams.get("season"),
        sport: url.searchParams.get("sport"),
        rebuild: url.searchParams.get("rebuild"),
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagueId: "league_graph_1",
          season: url.searchParams.get("season") ? Number(url.searchParams.get("season")) : null,
          strongestRivalries: [{ nodeA: "managerA", nodeB: "managerB", intensityScore: 77, weight: 12 }],
          tradeClusters: [{ id: "cluster-1", members: [{ nodeId: "managerA", entityId: "managerA" }, { nodeId: "managerB", entityId: "managerB" }] }],
          influenceLeaders: [{ nodeId: "managerA", entityId: "managerA", compositeScore: 0.9, centralityScore: 0.8, tradeInfluenceScore: 0.7, rivalryInfluenceScore: 0.9, championshipImpactScore: 0.5 }],
          centralManagers: [{ nodeId: "managerA", entityId: "managerA", centralityScore: 0.8, degree: 5, weightedDegree: 12 }],
          isolatedManagers: [{ nodeId: "managerB", entityId: "managerB" }],
          dynastyPowerTransitions: [{ fromSeason: 2024, toSeason: 2025, fromNodeIds: ["teamA"], toNodeIds: ["teamB"], type: "shift" }],
          repeatedEliminationPatterns: [{ eliminatorNodeId: "teamA", eliminatedNodeId: "teamB", count: 2, seasons: [2024, 2025] }],
          generatedAt: "2026-03-20T12:00:00.000Z",
        }),
      });
    });
    await page.route("**/api/leagues/league_graph_1/relationship-map**", async (route) => {
      const url = new URL(route.request().url());
      mapCalls.push({
        season: url.searchParams.get("season"),
        sport: url.searchParams.get("sport"),
        rebuild: url.searchParams.get("rebuild"),
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          leagueId: "league_graph_1",
          season: url.searchParams.get("season") ? Number(url.searchParams.get("season")) : null,
          nodes: [
            { nodeId: "managerA", nodeType: "Manager", entityId: "managerA", metadata: { ownerName: "Alpha Manager" } },
            { nodeId: "managerB", nodeType: "Manager", entityId: "managerB", metadata: { ownerName: "Bravo Manager" } },
            { nodeId: "teamA", nodeType: "TeamSeason", entityId: "teamA", metadata: { teamName: "Alpha" } },
            { nodeId: "teamB", nodeType: "TeamSeason", entityId: "teamB", metadata: { teamName: "Bravo" } },
          ],
          edges: [
            { edgeId: "e1", fromNodeId: "managerA", toNodeId: "managerB", edgeType: "RIVAL_OF", weight: 12, metadata: null },
            { edgeId: "e2", fromNodeId: "teamA", toNodeId: "teamB", edgeType: "TRADED_WITH", weight: 4, metadata: null },
          ],
          rivals: [{ nodeA: "managerA", nodeB: "managerB", weight: 12 }],
          tradePartners: [{ fromNodeId: "teamA", toNodeId: "teamB", tradeCount: 4, totalWeight: 4 }],
          managerScores: [],
          dramaTeams: [],
          eraDominance: [],
          powerShift: [],
        }),
      });
    });
    await page.route("**/api/leagues/league_graph_1/graph-insight", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      insightCalls.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          readableSummary:
            body.type === "summary"
              ? "Graph summary for this league is healthy."
              : "Explained relationship: this edge reflects repeated high-intensity interactions.",
          metricsInterpretation: null,
          momentumStoryline: null,
          generatedAt: "2026-03-20T12:00:00.000Z",
        }),
      });
    });
    await page.route("**/api/leagues/league_graph_1/rivalries**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      rivalryCalls.push({ method, url });
      if (url.includes("/rivalries/explain")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ narrative: "These managers keep colliding in close games." }),
        });
        return;
      }
      if (url.includes("/timeline")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            timeline: [{ eventType: "matchup", description: "One-point upset", createdAt: "2026-03-20T00:00:00.000Z" }],
          }),
        });
        return;
      }
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ detected: 1, updated: 1 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rivalries: [
            {
              id: "riv-1",
              leagueId: "league_graph_1",
              sport: "NBA",
              sportLabel: "NBA",
              managerAId: "managerA",
              managerBId: "managerB",
              rivalryScore: 78.2,
              rivalryTier: "Heated",
              tierBadgeColor: "red",
              firstDetectedAt: "2026-03-20T00:00:00.000Z",
              updatedAt: "2026-03-20T00:00:00.000Z",
              eventCount: 3,
            },
          ],
        }),
      });
    });

    // /leagues/<id> shows a sign-in wall to a settled-unauthenticated session since
    // 1f5105f6 (every fetch on that page is session-gated). The mocked league APIs
    // still answer; the visitor just has to be signed in to reach the tab.
    await signInAs(page, { id: "e2e-graph-user" });
    await page.goto("/leagues/league_graph_1?tab=Intelligence");
    await expect(page.getByRole("heading", { name: "League Intelligence Graph" }).first()).toBeVisible();

    await page.getByTitle("Filter graph by sport").selectOption("NBA");
    // The graph panel's own refresh (title "Refresh graph data"). Signed in, the shell's
    // "Refresh League Data" button is live and is the first button whose name contains
    // "Refresh"; clicking it reloads the league and remounts this panel with its sport
    // filter reset, so the later relationship-map request would lose sport=NBA.
    await page.getByTitle("Refresh graph data").click();
    await page.getByRole("button", { name: "Rebuild graph" }).first().click();

    await page.getByRole("button", { name: "graph", exact: true }).click();
    await expect(page.getByText(/Nodes:\s*4\s*·\s*Edges:\s*2/i)).toBeVisible();
    await page.getByRole("button", { name: "Edge details" }).first().click();
    await expect(page.getByRole("heading", { name: "Edge detail" })).toBeVisible();
    await page.getByRole("button", { name: "Explain this relationship" }).click();
    await expect(page.getByText(/Explained relationship:/i)).toBeVisible();
    await page.getByRole("button", { name: "Back" }).first().click();

    await page.getByRole("button", { name: "Alpha Manager" }).first().click();
    await expect(page.getByRole("heading", { name: "Node detail" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).first().click();

    await page.getByRole("button", { name: "Explain with Chimmy" }).click();
    await expect(page.getByRole("dialog", { name: "Chimmy's graph insight" })).toBeVisible();
    await expect(page.getByText(/Graph summary for this league is healthy/i)).toBeVisible();
    await page.getByRole("button", { name: "Regenerate" }).click();
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "rivalries", exact: true }).click();
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await expect(page.getByText(/These managers keep colliding/i)).toBeVisible();
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(page.getByText(/One-point upset/i)).toBeVisible();

    expect(profileCalls.some((c) => c.sport === "NBA")).toBe(true);
    expect(profileCalls.some((c) => c.rebuild === "1")).toBe(true);
    expect(mapCalls.some((c) => c.sport === "NBA")).toBe(true);
    expect(insightCalls.some((c) => c.type === "summary")).toBe(true);
    expect(insightCalls.some((c) => c.type === "rivalry" || c.type === "timeline")).toBe(true);
    expect(rivalryCalls.length).toBeGreaterThan(0);
  });
});
