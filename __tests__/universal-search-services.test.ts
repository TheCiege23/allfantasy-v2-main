import { describe, expect, it, vi } from "vitest"
import {
  getSportSearchFilterOptions,
  getUniversalLiveResults,
  getUniversalSearchPayload,
  mergeSearchResults,
  resolveStaticResults,
  type SearchResultItem,
} from "@/lib/search"

describe("universal search services", () => {
  it("returns quick actions for short queries and static results for longer queries", () => {
    const shortPayload = getUniversalSearchPayload("")
    expect(shortPayload.quickActions.length).toBeGreaterThan(0)
    expect(shortPayload.staticResults).toHaveLength(0)

    const longPayload = getUniversalSearchPayload("settings")
    expect(longPayload.quickActions.some((action) => action.id === "settings")).toBe(true)
    expect(longPayload.staticResults.some((result) => result.href === "/settings")).toBe(true)
    expect(longPayload.suggestLiveSearch).toBe(true)
  })

  it("exposes full multi-sport filter options", () => {
    const options = getSportSearchFilterOptions()
    const values = options.map((option) => option.value)
    expect(values).toContain("ALL")
    expect(values).toContain("NFL")
    expect(values).toContain("NHL")
    expect(values).toContain("NBA")
    expect(values).toContain("MLB")
    expect(values).toContain("NCAAB")
    expect(values).toContain("NCAAF")
    expect(values).toContain("SOCCER")
  })

  it("fetches and maps live league/player results with sport filtering", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith("/api/league/search")) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                id: "league-1",
                name: "Soccer Pro League",
                sport: "SOCCER",
                leagueVariant: "STANDARD",
                leagueSize: 12,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }
      if (url.startsWith("/api/players/search")) {
        return new Response(
          JSON.stringify([
            {
              id: "player-7",
              name: "Alex Striker",
              position: "FWD",
              team: "LIV",
              sport: "SOCCER",
              slug: "alex-striker-soccer-tsdb-7",
            },
            // No public slug: the name page, narrowed by sport, position and team.
            { id: "player-8", name: "Jo O'Neil Jr.", position: "MID", team: "ARS", sport: "SOCCER" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }
      return new Response("[]", { status: 404 })
    })

    const live = await getUniversalLiveResults("alex", {
      sportFilter: "SOCCER",
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalled()
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes("sport=SOCCER"))).toBe(true)
    expect(live.leagues[0]?.category).toBe("league")
    expect(live.players[0]?.category).toBe("player")
    expect(live.leagues[0]?.href).toBe("/leagues/league-1")
    // 2026-11-12: a player result opens that player's page, never the comparison tool's landing page.
    expect(live.players[0]?.href).toBe("/players/alex-striker-soccer-tsdb-7")
    expect(live.players[1]?.href).toBe("/player/jo-o'neil?sport=SOCCER&position=MID&team=ARS")
  })

  it("merges and deduplicates static and live results by destination", () => {
    const staticResults = resolveStaticResults("profile")
    const duplicate: SearchResultItem = {
      id: "manual-profile",
      label: "Profile",
      href: "/profile",
      category: "page",
    }
    const merged = mergeSearchResults(staticResults, { leagues: [duplicate], players: [] })
    const profileResults = merged.filter((item) => item.href === "/profile")
    expect(profileResults.length).toBe(1)
  })
})
