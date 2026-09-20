import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import MlbBracketBoard from "@/components/brackets/playoffs/MlbBracketBoard"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import type { PlayoffChallengeView, PlayoffSeriesView } from "@/lib/playoffs/types"

/*
 * `next/link` reads the App Router context and throws when it is absent, which
 * says nothing about this board. Stubbed to the anchor it renders in practice.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

function series(isTestMode: boolean): PlayoffSeriesView[] {
  return buildPlayoffTemplate({ sport: "mlb", seasonYear: 2026, isTestMode }).map((item) => ({
    ...item,
    id: `s${item.seriesNumber}`,
  }))
}

function buildView(overrides: Partial<PlayoffChallengeView> = {}): PlayoffChallengeView {
  return {
    viewerUserId: "user-1",
    challenge: {
      id: "challenge-1",
      name: "Front Office Fall Classic",
      ownerUserId: "user-1",
      sport: "mlb",
      seasonYear: 2026,
      status: "open",
      isTestMode: true,
      lockRule: "series_start",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activeEntry: {
      id: "entry-1",
      name: "Bracket 1",
      userId: "user-1",
      pickCount: 0,
      isComplete: false,
      totalScore: 0,
      createdAt: new Date().toISOString(),
    },
    entries: [
      {
        id: "entry-1",
        name: "Bracket 1",
        userId: "user-1",
        pickCount: 0,
        isComplete: false,
        totalScore: 0,
        createdAt: new Date().toISOString(),
      },
    ],
    picks: [],
    rounds: ["wild_card", "division_series", "league_championship", "world_series"],
    series: series(true),
    ...overrides,
  }
}

function card(seriesNumber: number) {
  return screen.getByTestId(`pb-series-${seriesNumber}`)
}

describe("MlbBracketBoard", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("renders all eleven series, both leagues and the champion slot", () => {
    render(<MlbBracketBoard view={buildView()} onViewChange={() => {}} />)
    for (let n = 1; n <= 11; n += 1) {
      expect(card(n)).toBeTruthy()
    }
    expect(screen.getByTestId("pb-champion")).toBeTruthy()
    expect(screen.getAllByText("Wild Card").length).toBeGreaterThan(0)
    expect(screen.getAllByText("World Series").length).toBeGreaterThan(0)
  })

  it("shows the scoring tiles the scorer will actually award", () => {
    render(<MlbBracketBoard view={buildView()} onViewChange={() => {}} />)
    const tiles = screen.getByTestId("pb-scoring-tiles")
    expect(within(tiles).getByText("5 pts")).toBeTruthy()
    expect(within(tiles).getByText("10 pts")).toBeTruthy()
    expect(within(tiles).getByText("18 pts")).toBeTruthy()
    expect(within(tiles).getByText("30 pts")).toBeTruthy()
  })

  it("leaves a series with an unresolved side unpickable", () => {
    render(<MlbBracketBoard view={buildView()} onViewChange={() => {}} />)
    // S5 is a Division Series: the #1 seed is known, its opponent is the
    // winner of a wild card nobody has picked yet.
    const buttons = within(card(5)).getAllByRole("button")
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false)
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
    expect(within(card(5)).getByText("TBD")).toBeTruthy()
  })

  it("keeps an unseeded pool pickable, because seeding migrates those picks", () => {
    // 🛑 The regression this guards: treating `AL1` as "no team yet" disables
    // every first-round row before standings close, and the seed-slot pick
    // flow (applyPlayoffSeedsToChallenge) then has nothing to migrate.
    render(<MlbBracketBoard view={buildView({ series: series(false) })} onViewChange={() => {}} />)
    const buttons = within(card(1)).getAllByRole("button") as HTMLButtonElement[]
    expect(buttons[0].disabled).toBe(false)
    expect(within(card(1)).getAllByText("AL3").length).toBeGreaterThan(0)
    expect(within(card(1)).getAllByText("slot").length).toBe(2)
  })

  it("posts one pick and takes the server's recomputed view wholesale", async () => {
    const next = buildView({ picks: [{ id: "p1", entryId: "entry-1", seriesId: "s1", pickTeamName: "Cleveland Guardians", createdAt: "", updatedAt: "" }] })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, view: next }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const onViewChange = vi.fn()

    render(<MlbBracketBoard view={buildView()} onViewChange={onViewChange} />)
    fireEvent.click(within(card(1)).getAllByRole("button")[0])

    await waitFor(() => expect(onViewChange).toHaveBeenCalledWith(next))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/brackets/playoffs/challenge-1/entries/entry-1/picks")
    expect(JSON.parse(init.body)).toEqual({ seriesId: "s1", pickTeamName: expect.any(String) })
  })

  it("carries a pick forward so the next round becomes pickable", () => {
    const view = buildView({
      picks: [
        {
          id: "p1",
          entryId: "entry-1",
          seriesId: "s1",
          pickTeamName: series(true).find((s) => s.seriesNumber === 1)!.homeTeamName,
          createdAt: "",
          updatedAt: "",
        },
      ],
    })
    render(<MlbBracketBoard view={view} onViewChange={() => {}} />)
    // S1 feeds S6 (the #2 seed's Division Series) — both rows are live now.
    const buttons = within(card(6)).getAllByRole("button") as HTMLButtonElement[]
    expect(buttons.every((b) => b.disabled)).toBe(false)
    expect(within(card(6)).queryByText("TBD")).toBeNull()
  })

  it("will not open the detail sheet on a matchup only the viewer's picks created", () => {
    const view = buildView({
      picks: [
        {
          id: "p1",
          entryId: "entry-1",
          seriesId: "s1",
          pickTeamName: series(true).find((s) => s.seriesNumber === 1)!.homeTeamName,
          createdAt: "",
          updatedAt: "",
        },
      ],
    })
    render(<MlbBracketBoard view={view} onViewChange={() => {}} />)
    const projected = screen.getByTestId("pb-status-6") as HTMLButtonElement
    expect(projected.disabled).toBe(true)
    expect(within(projected).getByText("your projection")).toBeTruthy()
    // S1 is a real, provider-filled matchup, so its sheet does open.
    expect((screen.getByTestId("pb-status-1") as HTMLButtonElement).disabled).toBe(false)
  })

  it("marks a settled pick right or wrong with the points it earned", () => {
    const filled = series(true)
    const s1 = filled.find((s) => s.seriesNumber === 1)!
    s1.status = "final"
    s1.winnerTeamName = s1.homeTeamName
    const view = buildView({
      series: filled,
      picks: [
        { id: "p1", entryId: "entry-1", seriesId: "s1", pickTeamName: s1.homeTeamName, createdAt: "", updatedAt: "" },
      ],
    })
    render(<MlbBracketBoard view={view} onViewChange={() => {}} />)
    expect(within(screen.getByTestId("pb-status-1")).getByText("Your pick ✓ +5")).toBeTruthy()
  })

  it("locks a series that has already started, and says why", () => {
    const filled = series(true)
    filled.find((s) => s.seriesNumber === 1)!.status = "in_progress"
    render(<MlbBracketBoard view={buildView({ series: filled })} onViewChange={() => {}} />)
    const button = within(card(1)).getAllByRole("button")[0] as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe("Series already started/locked")
  })

  it("states the basis for its percentages instead of implying a model", () => {
    render(<MlbBracketBoard view={buildView()} onViewChange={() => {}} />)
    // Stated twice on purpose — under the tree and in the rail.
    expect(screen.getAllByText(/not a scouting model/i).length).toBeGreaterThan(1)
    expect(within(screen.getByTestId("pb-decision-rail")).getByText(/Basis: seeding only/)).toBeTruthy()
  })

  it("renders no over/under or wagering control anywhere", () => {
    // The app's own terms say no betting markets exist; the design carried one.
    const { container } = render(<MlbBracketBoard view={buildView()} onViewChange={() => {}} />)
    expect(container.textContent).not.toMatch(/over\/under|o\/u|spread|wager|odds boost/i)
  })

  it("only offers a settings door when the caller gives it one", () => {
    const onOpenSettings = vi.fn()
    const { rerender } = render(<MlbBracketBoard view={buildView()} onViewChange={() => {}} />)
    expect(screen.queryByText("Settings")).toBeNull()
    rerender(
      <MlbBracketBoard view={buildView()} onViewChange={() => {}} onOpenSettings={onOpenSettings} />,
    )
    fireEvent.click(screen.getByText("Settings"))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
