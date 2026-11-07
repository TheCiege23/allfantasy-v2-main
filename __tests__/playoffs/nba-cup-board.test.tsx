import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { hydrateRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import MlbBracketBoard from "@/components/brackets/playoffs/MlbBracketBoard"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"

vi.mock("next/link", () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }))
vi.mock("@/app/components/TeamLogo", () => ({ TeamLogo: ({ teamAbbr, logoUrl }: any) => <img alt={teamAbbr} src={logoUrl || "https://example.test/fallback.png"} /> }))
afterEach(cleanup)

function view(): PlayoffChallengeView {
  const rows = buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 }).map((game) => ({ ...game, id: `s${game.seriesNumber}` }))
  const group = { ...rows[0], id: "group", round: "cup_group_play" as const, roundIndex: 0, seriesNumber: 1001, homeSeed: 0, awaySeed: 0, homeTeamName: "Boston Celtics", awayTeamName: "Charlotte Hornets", startsAt: "2099-11-06T00:00:00Z", venue: "TD Garden", location: "Boston, MA", nextSeriesNumber: null, sourceSeriesHome: null, sourceSeriesAway: null, gameLabel: "NBA Cup - Group Play" }
  return {
    viewerUserId: "user", challenge: { id: "cup", name: "Friends Cup", sport: "nba_cup", ownerUserId: "user", seasonYear: 2026, status: "open", isTestMode: false, firstGameStartsAt: "2020-10-30T00:00:00Z", createdAt: "", updatedAt: "" },
    activeEntry: { id: "entry", userId: "user", name: "My picks", pickCount: 0, isComplete: false, createdAt: "" }, entries: [], participants: [], picks: [], rounds: ["cup_group_play", "cup_quarterfinals", "cup_semifinals", "cup_championship"],
    series: [...rows, group, { ...group, id: "past", seriesNumber: 1002, startsAt: "2020-10-30T00:00:00Z", status: "final", winnerTeamName: "Boston Celtics" }],
    teamLogos: { "Boston Celtics": "https://example.test/bos.png", "Charlotte Hornets": "https://example.test/cha.png" },
  }
}

describe("NBA Cup remaining-game board", () => {
  it("hydrates across server and viewer time zones, then displays the viewer's local dates", async () => {
    const original = process.env.TZ
    const v = view()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const errors: unknown[] = []
    try {
      process.env.TZ = "UTC"
      container.innerHTML = renderToString(<MlbBracketBoard view={v} onViewChange={() => {}} />)
      expect(container.textContent).toContain("Nov 6")
      process.env.TZ = "America/New_York"
      let root: ReturnType<typeof hydrateRoot>
      await act(async () => { root = hydrateRoot(container, <MlbBracketBoard view={v} onViewChange={() => {}} />, { onRecoverableError: (error) => errors.push(error) }) })
      expect(errors).toEqual([])
      expect(container.textContent).toContain("Nov 5")
      await act(async () => root!.unmount())
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
      container.remove()
    }
  })
  it("shows whether the owner's NBA Cup entry is saved as a draft or finalized", () => {
    const v = view()
    const { rerender } = render(<MlbBracketBoard view={v} onViewChange={() => {}} />)
    expect(screen.getByTestId("cup-entry-draft-status")).toHaveTextContent("Picks saved — bracket not finalized")
    expect(screen.getByTestId("cup-entry-draft-status")).toHaveTextContent("Finalize picks to join the standings")
    const finalized = { ...v, activeEntry: { ...v.activeEntry!, finalizedAt: "2026-10-30T00:00:00Z" } }
    rerender(<MlbBracketBoard view={finalized} onViewChange={() => {}} />)
    expect(screen.queryByTestId("cup-entry-draft-status")).not.toBeInTheDocument()
    expect(screen.getByText(/Picks finalized/)).toBeInTheDocument()
  })
  it("filters group games by date and restores all dates", () => {
    const v = view()
    const first = v.series.find((game) => game.id === "group")!
    v.series.push({ ...first, id: "later", seriesNumber: 1003, startsAt: "2099-11-13T20:00:00Z" })
    render(<MlbBracketBoard view={v} onViewChange={() => {}} />)
    const selector = screen.getByLabelText("Show games by date")
    expect(screen.getByTestId("cup-game-1001")).toBeInTheDocument()
    expect(screen.getByTestId("cup-game-1003")).toBeInTheDocument()
    const later = within(selector).getByRole("option", { name: /Nov 13/ }) as HTMLOptionElement
    fireEvent.change(selector, { target: { value: later.value } })
    expect(screen.queryByTestId("cup-game-1001")).not.toBeInTheDocument()
    expect(screen.getByTestId("cup-game-1003")).toBeInTheDocument()
    fireEvent.change(selector, { target: { value: "all" } })
    expect(screen.getByTestId("cup-game-1001")).toBeInTheDocument()
  })
  it("offers a direct link to later Group Play dates with pick controls available", () => {
    const v = view()
    const first = v.series.find((game) => game.id === "group")!
    v.series.push({ ...first, id: "later", seriesNumber: 1003, startsAt: "2099-11-13T20:00:00Z" })
    render(<MlbBracketBoard view={v} onViewChange={() => {}} />)
    const dates = screen.getByRole("navigation", { name: "Jump to a Group Play date" })
    const later = within(dates).getByRole("link", { name: /Nov 13/ })
    const day = document.getElementById(later.getAttribute("href")!.slice(1))!
    expect(within(day).getByRole("button", { name: "Pick Boston Celtics" })).toBeEnabled()
    expect(screen.getByRole("link", { name: /Next date: .*Nov 13/ })).toHaveAttribute("href", later.getAttribute("href"))
  })

  it("shows mobile knockout rounds and only enables picks before tipoff", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    try {
      const v = view()
      v.activeEntry!.finalizedAt = "2020-10-29T00:00:00Z"
      const matchup = { homeTeamName: "Boston Celtics", awayTeamName: "Charlotte Hornets" }
      const quarter = v.series.find((game) => game.round === "cup_quarterfinals")!
      const semi = v.series.find((game) => game.round === "cup_semifinals")!
      Object.assign(quarter, matchup, { startsAt: "2020-12-04T00:00:00Z" })
      Object.assign(semi, matchup, { startsAt: "2099-12-08T00:00:00Z" })
      render(<MlbBracketBoard view={v} onViewChange={() => {}} />)
      expect(screen.queryByTestId("pb-scroller")).not.toBeInTheDocument()
      expect(within(screen.getByTestId(`cup-game-${quarter.seriesNumber}`)).getByRole("button", { name: "Pick Boston Celtics" })).toBeDisabled()
      expect(within(screen.getByRole("region", { name: "Semifinals" })).getByRole("button", { name: "Pick Boston Celtics" })).toBeEnabled()
      expect(screen.getByRole("region", { name: "Championship" })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("keeps incomplete group finals pending in the standings and tournament phases", () => {
    const v=view()
    v.series=v.series.filter((game) => game.id === "past").map((game) => ({...game,liveHomeScore:110,liveAwayScore:105}))
    render(<MlbBracketBoard view={v} onViewChange={() => {}} />)
    const standings=screen.getByTestId("cup-standings")
    expect(within(standings).getAllByText("Schedule pending")).toHaveLength(2)
    expect(within(standings).queryByText("Won group")).not.toBeInTheDocument()
    expect(within(standings).queryByText("Wild card")).not.toBeInTheDocument()
    expect(screen.getByRole("list",{name:"Tournament phases"}).firstElementChild).toHaveAttribute("data-state","now")
    expect(screen.getByText(/3 group games left/)).toBeInTheDocument()
  })
  it("does not turn an entry's projected knockout picks into confirmed qualifiers", () => {
    const v=view()
    v.picks=[{id:"guess",entryId:"entry",seriesId:"s1",pickTeamName:"Boston Celtics",createdAt:"",updatedAt:""}]
    render(<MlbBracketBoard view={v} onViewChange={() => {}} />)
    expect(within(screen.getByTestId("cup-standings")).queryByText("Qualified")).not.toBeInTheDocument()
  })
  it("explains group-play scoring above both stages using the scorer's points", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    fireEvent.click(screen.getByText("Scoring rules"))
    const scoring = screen.getByLabelText("NBA Cup scoring")
    expect(within(scoring).getByText(/Each correct Group Play winner earns 1 point/)).toHaveTextContent("Group Play and knockout points both count toward your league and universal standings.")
    const tiles = within(scoring).getByTestId("pb-scoring-tiles")
    expect(Array.from(tiles.children).map((tile) => tile.textContent)).toEqual([
      "Group Play1 ptSingle game", "Quarterfinals1 ptSingle game", "Semifinals2 ptsSingle game", "Championship4 ptsSingle game",
    ])
    expect(scoring.compareDocumentPosition(screen.getByRole("region", { name: "NBA Cup Group Play" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows upcoming group games with logos and venue while knockout slots are pending", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    const group = screen.getByRole("region", { name: "NBA Cup Group Play" })
    expect(within(group).getByText(/TD Garden/)).toBeInTheDocument()
    expect(within(group).getByRole("img", { name: "Boston Celtics" })).toHaveAttribute("src", "https://example.test/bos.png")
    expect(screen.getByText(/Join anytime/)).toBeInTheDocument()
    expect(screen.queryByText(/must be published/)).not.toBeInTheDocument()
    expect(screen.getByText(/Knockout picks open after Group Play ends/)).toBeVisible()
    expect(screen.queryByTestId("pb-scroller")).not.toBeInTheDocument()
    expect(screen.queryByTestId("cup-game-1002")).not.toBeInTheDocument()
    expect(within(screen.getByTestId("cup-game-1001")).getByRole("button", { name: "Pick Boston Celtics" })).toBeEnabled()
  })
  it("opens the full-screen matchup and allows an upcoming pick after the first Cup game", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    fireEvent.click(within(screen.getByTestId("cup-game-1001")).getByRole("button", { name: /Matchup details/ }))
    const matchup = screen.getByRole("dialog")
    expect(within(matchup).getByText("Chimmy Intelligence")).toBeInTheDocument()
    expect(within(matchup).getByRole("button", { name: "Pick Boston Celtics" })).toBeEnabled()
  })
  it("shows finished games on demand and keeps their pick buttons locked", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "All games" }))
    const card = screen.getByTestId("cup-game-1002")
    // A finished card shows the result, not pick buttons.
    expect(within(card).queryByRole("button", { name: /^Pick / })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole("button", { name: /Box score/ }))
    const sheet = screen.getByRole("dialog")
    expect(within(sheet).getByRole("region", { name: "Final score" })).toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: /^Pick / })).not.toBeInTheDocument()
  })
  it("shows a live game's clock, score, leading scorers and how your pick is doing", () => {
    const v = view()
    const live = v.series.find((row) => row.id === "group")!
    Object.assign(live, {
      startsAt: "2020-11-06T00:00:00Z", status: "in_progress", liveHomeScore: 88, liveAwayScore: 81, liveStatus: "4:12 - 3rd",
      providerGamesJson: { live: { detail: "4:12 - 3rd", period: 3, clock: "4:12", homeLeader: { name: "Jaylen Brown", points: 24 }, awayLeader: { name: "LaMelo Ball", points: 19 }, homeLines: [30, 28, 30], awayLines: [25, 31, 25] } },
    })
    v.picks = [{ id: "p", entryId: "entry", seriesId: "group", pickTeamName: "Boston Celtics", createdAt: "", updatedAt: "" }]
    render(<MlbBracketBoard view={v} onViewChange={() => {}} />)
    const card = screen.getByTestId("cup-game-1001")
    expect(within(card).getByText(/LIVE · Q3 4:12/)).toBeInTheDocument()
    expect(within(card).getByText("88")).toBeInTheDocument()
    expect(within(card).getByText(/Jaylen Brown 24 PTS/)).toBeInTheDocument()
    expect(within(card).getByText(/Your pick leads by 7/)).toBeInTheDocument()
    expect(within(screen.getByLabelText("Live games")).getByText("Q3 4:12")).toBeInTheDocument()
    fireEvent.click(within(card).getByRole("button", { name: /Live game details/ }))
    const sheet = screen.getByRole("dialog")
    expect(within(sheet).getByRole("region", { name: "Live score" })).toBeInTheDocument()
    expect(within(sheet).getByText("Score by quarter")).toBeInTheDocument()
    expect(within(sheet).getByText("Jaylen Brown")).toBeInTheDocument()
  })
})

