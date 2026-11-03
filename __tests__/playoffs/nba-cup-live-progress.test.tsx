import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import final from "../../contracts/espn/fixtures/scoreboard.NBA.20251216.json"
import scheduled from "../../contracts/espn/fixtures/scoreboard.NBA.20261106.json"
import { cupPointsLeaders, nbaCupGroupStandings } from "@/lib/playoffs/nbaCupProgress"
import { parseNbaCupScoreboard } from "@/lib/playoffs/nbaCupTournament"
import { nbaCupPublicLive } from "@/lib/playoffs/nbaCupPublicLive"
import { cupGameDetail } from "@/lib/playoffs/nbaCupBoard"
import { nbaCupSeriesRows } from "@/lib/playoffs/nbaCupCache"
import { mergeCupLiveView, useNbaCupLiveView } from "@/components/brackets/playoffs/useNbaCupLiveView"
import NbaCupTournamentPanel from "@/components/brackets/playoffs/NbaCupTournamentPanel"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import type { PlayoffChallengeView, PlayoffSeriesView } from "@/lib/playoffs/types"

const readView = vi.hoisted(() => vi.fn())
vi.mock("@/lib/playoffs/playoffService", () => ({ getPlayoffBracketView: readView }))
import { GET } from "@/app/api/brackets/playoffs/[challengeId]/live/route"

const teams = ["Atlanta Hawks", "Boston Celtics", "Charlotte Hornets", "Chicago Bulls", "Washington Wizards"]
const game = (home: string, away: string, winner: string | null = null, extra: Partial<PlayoffSeriesView> = {}): PlayoffSeriesView => ({
  ...buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 })[0], id: `${home}-${away}`, round: "cup_group_play",
  homeTeamName: home, awayTeamName: away, winnerTeamName: winner, status: winner ? "final" : "scheduled",
  liveHomeScore: winner ? 110 : null, liveAwayScore: winner ? 100 : null, providerGamesJson: { period: 4 }, ...extra,
})
const group = (games: PlayoffSeriesView[]) => nbaCupGroupStandings(games, 2026).find((row) => row.name === "East Group C")!
const view = (): PlayoffChallengeView => ({
  challenge: { id: "cup", name: "Private league name", sport: "nba_cup", seasonYear: 2026, ownerUserId: "owner-private", status: "open", isTestMode: false, inviteCode: "PRIVATE-CODE", createdAt: "", updatedAt: "" },
  viewerUserId: "private-user", activeEntry: { id: "e", name: "Private bracket name", userId: "private-user", pickCount: 1, isComplete: true, createdAt: "" },
  entries: [{ id: "e", name: "Private bracket name", userId: "private-user", pickCount: 1, isComplete: true, totalScore: 1, createdAt: "" }, { id: "draft", name: "Private draft name", userId: "draft-user", pickCount: 1, isComplete: false, createdAt: "" }],
  participants: [], rounds: ["cup_group_play"], series: [game(teams[0], teams[1], null, { id: "g", status: "in_progress", liveHomeScore: 0, liveAwayScore: 3, liveStatus: "11:20 - 1st", providerGamesJson: { privateMarker: "DO-NOT-EXPOSE", period: 1 } })],
  picks: [{ id: "p", entryId: "e", seriesId: "g", pickTeamName: teams[0], createdAt: "", updatedAt: "" }], nbaCupLastSyncedAt: "2026-11-07T00:00:00Z",
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("NBA Cup game detail ingestion", () => {
  it("keeps each team's game scoring leader from a captured final", () => {
    const result = parseNbaCupScoreboard(final, 2025)[0]
    expect(result.homeLeaders).toEqual([{ name: "OG Anunoby", points: 28 }])
    expect(result.awayLeaders?.length).toBeGreaterThan(0)
    expect(result.statusDetail).toMatch(/Final/i)
    expect(result.period).toBe(4)
  })
  it("excludes pregame season averages and preserves tied scorers with matching team identity", () => {
    expect(parseNbaCupScoreboard(scheduled, 2026).every((row) => !row.homeLeaders?.length && !row.awayLeaders?.length)).toBe(true)
    const leader = (name: string, team: string) => ({ athlete: { displayName: name }, team: { id: team }, value: 30 })
    expect(cupPointsLeaders({ team: { id: "1" }, leaders: [{ name: "pointsPerGame", leaders: [leader("Season", "1")] }] })).toEqual([])
    expect(cupPointsLeaders({ team: { id: "1" }, leaders: [{ name: "points", leaders: [leader("A", "1"), leader("B", "1"), leader("Wrong team", "2")] }] }))
      .toEqual([{ name: "A", points: 30 }, { name: "B", points: 30 }])
  })
})

describe("group records and qualification", () => {
  it("counts completed Cup games without substituting regular-season games or live leads", () => {
    const result = group([game(teams[0], teams[1], teams[0]), game(teams[0], teams[2], teams[0], { round: "round_1" }), game(teams[0], teams[3], teams[0], { status: "in_progress" })])
    expect(result.teams.find((row) => row.team === teams[0])).toMatchObject({ wins: 1, losses: 0, remaining: 3, status: "Schedule pending" })
    expect(result.teams.find((row) => row.team === teams[1])).toMatchObject({ wins: 0, losses: 1 })
  })
  it("scores overtime differential as zero and leaves missing period data pending", () => {
    expect(group([game(teams[0], teams[1], teams[0], { providerGamesJson: { period: 5 } })]).teams.find((row) => row.team === teams[0])?.differential).toBe(0)
    expect(group([game(teams[0], teams[1], teams[0], { providerGamesJson: {} })]).teams.find((row) => row.team === teams[0])?.differential).toBeNull()
  })
  it("calculates mathematical elimination from the complete group schedule", () => {
    const games = teams.flatMap((home, i) => teams.slice(i + 1).map((away) => game(home, away, home)))
    expect(group(games).scheduleComplete).toBe(true)
    expect(group(games).teams.find((row) => row.team === teams[0])).toMatchObject({ wins: 4, losses: 0, canWinGroup: true })
    expect(group(games).teams.find((row) => row.team === teams[4])).toMatchObject({ wins: 0, losses: 4, canWinGroup: false, canFinishSecond: false, status: "Eliminated" })
  })
  it("keeps ties unresolved, recognizes confirmed quarters, and scopes the draw to its season", () => {
    const games = teams.flatMap((home, i) => teams.slice(i + 1).map((away) => game(home, away)))
    expect(group(games).teams.every((row) => row.canWinGroup && row.tied && row.status !== "Qualified")).toBe(true)
    expect(group([...games, game(teams[0], "Miami Heat", null, { round: "cup_quarterfinals" })]).teams.find((row) => row.team === teams[0])?.status).toBe("Qualified")
    expect(nbaCupGroupStandings([], 2027)).toEqual([])
  })
})

describe("public results and live refresh", () => {
  it("keeps the merged card and modal details through refresh while stripping nested metadata", () => {
    const current = view()
    const parsed = parseNbaCupScoreboard(final, 2025)[0]
    const row = nbaCupSeriesRows([{ ...parsed, seriesNumber: 7 }])[0]
    current.series = [game(parsed.homeTeamName, parsed.awayTeamName, parsed.winnerTeamName, {
      ...row, id: "g", startsAt: row.startsAt?.toISOString(), providerGamesJson: {
        ...row.providerGamesJson,
        live: { ...row.providerGamesJson.live, privateMarker: "NESTED-PRIVATE", homeLeader: { ...parsed.homeLeader, extra: "SCORER-PRIVATE" } },
        teams: { ...row.providerGamesJson.teams, userId: "TEAM-PRIVATE" },
      },
    })]
    const update = nbaCupPublicLive(current)
    const refreshed = mergeCupLiveView(current, update)
    expect(cupGameDetail(refreshed.series[0])).toMatchObject({
      detail: "Final", period: 4, homeLeader: { name: "OG Anunoby", points: 28 },
      homeLines: [28, 31, 30, 35], homeAbbr: "NY", homeColor: "#1d428a",
    })
    for (const value of ["NESTED-PRIVATE", "SCORER-PRIVATE", "TEAM-PRIVATE"]) expect(JSON.stringify(update)).not.toContain(value)
    expect(refreshed.picks).toBe(current.picks)
  })
  it("reads main's older nested detail and keeps tied top scorers on the new cards", () => {
    const current = view()
    current.series[0].providerGamesJson = { live: { period: 2, clock: "4:12", homeLeader: { name: "Legacy scorer", points: 12 } } }
    expect(cupGameDetail(nbaCupPublicLive(current).series[0])).toMatchObject({ period: 2, clock: "4:12", homeLeader: { name: "Legacy scorer", points: 12 } })
    current.series[0].providerGamesJson = { homeLeaders: [{ name: "A", points: 30 }, { name: "B", points: 30 }] }
    expect(cupGameDetail(nbaCupPublicLive(current).series[0]).homeLeader).toEqual({ name: "A / B", points: 30 })
  })
  it("serves only the public projection from an anonymous read and rejects other sports", async () => {
    readView.mockResolvedValue(view())
    const request = new Request("https://example.test/api/brackets/playoffs/cup/live?entryId=someone-else")
    const response = await GET(request, { params: Promise.resolve({ challengeId: "cup" }) })
    expect(readView).toHaveBeenCalledWith({ challengeId: "cup", user: null })
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const data = await response.json()
    expect(Object.keys(data).sort()).toEqual(["scores", "series", "syncedAt"])
    expect(JSON.stringify(data)).not.toContain("private-user")
    const other = view(); other.challenge.sport = "nba"
    readView.mockResolvedValue(other)
    expect((await GET(request, { params: Promise.resolve({ challengeId: "cup" }) })).status).toBe(404)
  })
  it("excludes private identity, picks, metadata and drafts from the public projection", () => {
    const update = nbaCupPublicLive(view()), json = JSON.stringify(update)
    for (const value of ["private-user", "Private bracket name", "Private league name", "PRIVATE-CODE", "pickTeamName", "DO-NOT-EXPOSE", "Private draft name"]) expect(json).not.toContain(value)
    expect(update.scores).toEqual([{ entryId: "e", rank: null, totalScore: 1, potentialTotal: 0, correctPicks: 0, resolvedPicks: 0 }])
  })
  it("merges scores into the latest local state without overwriting edits or finalization", () => {
    const current = view(), update = nbaCupPublicLive(current)
    update.scores[0].totalScore = 2
    current.picks[0].pickTeamName = "Boston Celtics"
    const merged = mergeCupLiveView(current, update)
    expect(merged.picks).toBe(current.picks)
    expect(merged.activeEntry).toMatchObject({ totalScore: 2, name: "Private bracket name", isComplete: true })
    expect(merged.entries.find((entry) => entry.id === "draft")).toEqual(current.entries[1])
    update.syncedAt = "2026-11-06T23:00:00Z"
    expect(mergeCupLiveView(current, update)).toBe(current)
  })
  it("polls every 15 seconds and stops after unmount", async () => {
    vi.useFakeTimers()
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const setView = vi.fn(), fetcher = vi.fn(async () => new Response(JSON.stringify(nbaCupPublicLive(view())), { status: 200 }))
    vi.stubGlobal("fetch", fetcher)
    const hook = renderHook(() => useNbaCupLiveView("cup", true, setView))
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(setView).toHaveBeenCalledTimes(1)
    hook.unmount()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it("shows live zero scores, final scorers, group records and a delayed-feed message", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-07T00:05:00Z"))
    const current = view()
    const finished = game(teams[0], teams[1], teams[0], { providerGamesJson: { period: 4, homeLeaders: [{ name: "Home scorer", points: 31 }], awayLeaders: [{ name: "Away scorer", points: 28 }] } })
    render(<NbaCupTournamentPanel series={[...current.series, finished]} season={2026} syncedAt={current.nbaCupLastSyncedAt} />)
    expect(within(screen.getByRole("article", { name: "Atlanta Hawks versus Boston Celtics live score" })).getByText("0")).toBeInTheDocument()
    expect(screen.getByText("Top scorer: Home scorer · 31 pts")).toBeInTheDocument()
    expect(screen.getByText("Top scorer: Away scorer · 28 pts")).toBeInTheDocument()
    expect(screen.getAllByText("Cup group record: 1–0").length).toBeGreaterThan(0)
    expect(screen.getByRole("status")).toHaveTextContent("Live feed delayed")
    expect(screen.getByLabelText("Follow a team's qualification path")).toBeInTheDocument()
  })
})
