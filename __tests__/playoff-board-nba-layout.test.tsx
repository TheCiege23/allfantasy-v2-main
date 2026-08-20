import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: function MockImage({ src, className }: { src?: string; className?: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} className={className} alt="" />
  },
}))

import PlayoffBracketBoard from "@/components/brackets/playoffs/PlayoffBracketBoard"
import type { PlayoffPickView, PlayoffSeriesView } from "@/lib/playoffs/types"

const rounds = ["round_1", "conference_semifinals", "conference_finals", "finals"] as const

function mk(opts: Partial<PlayoffSeriesView> & Pick<PlayoffSeriesView, "id" | "seriesNumber">): PlayoffSeriesView {
  return {
    round: "round_1",
    roundIndex: 1,
    conference: "east",
    homeSeed: 1,
    awaySeed: 8,
    homeTeamName: "A",
    awayTeamName: "B",
    winnerTeamName: null,
    bestOf: 7,
    status: "scheduled",
    startsAt: null,
    nextSeriesNumber: null,
    nextSeriesSlot: null,
    sourceSeriesHome: null,
    sourceSeriesAway: null,
    ...opts,
  }
}

describe("PlayoffBracketBoard NBA layout", () => {
  it("places West left, Finals + Champion center, East right with AF wordmark and Robot King", () => {
    const picks: PlayoffPickView[] = []
    const series: PlayoffSeriesView[] = [
      mk({
        id: "e-r1",
        seriesNumber: 1,
        conference: "east",
        round: "round_1",
      }),
      mk({
        id: "w-r1",
        seriesNumber: 5,
        conference: "west",
        round: "round_1",
      }),
      mk({
        id: "s15",
        seriesNumber: 15,
        conference: "finals",
        round: "finals",
        roundIndex: 4,
      }),
    ]

    const { container } = render(<PlayoffBracketBoard sport="nba" rounds={[...rounds]} series={series} picks={picks} />)

    const order = Array.from(container.querySelectorAll("[data-testid]"))
      .map((el) => el.getAttribute("data-testid"))
      .filter(Boolean)
    const westIdx = order.indexOf("nba-bracket-west")
    const centerIdx = order.indexOf("nba-bracket-center-finals")
    const eastIdx = order.indexOf("nba-bracket-east")
    expect(westIdx).toBeGreaterThanOrEqual(0)
    expect(centerIdx).toBeGreaterThanOrEqual(0)
    expect(eastIdx).toBeGreaterThanOrEqual(0)
    expect(westIdx).toBeLessThan(centerIdx)
    expect(centerIdx).toBeLessThan(eastIdx)

    expect(screen.getByTestId("nba-bracket-center-finals")).toBeInTheDocument()
    expect(screen.getByTestId("nba-bracket-champion")).toBeInTheDocument()
    expect(screen.getByTestId("nba-bracket-af-wordmark")).toBeInTheDocument()
    expect(screen.getByText(/^Eastern Conference$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Western Conference$/i)).toBeInTheDocument()
    expect(screen.getByText(/^NBA Finals$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Champion$/i)).toBeInTheDocument()
    expect(screen.getAllByText(/^First Round$/i)).toHaveLength(2)
    expect(screen.getByTestId("nba-east-round_1")).toBeInTheDocument()
    expect(screen.getByTestId("nba-west-round_1")).toBeInTheDocument()
    expect(screen.getByTestId("nba-bracket-frame")).toBeInTheDocument()
    expect(screen.getByTestId("nba-bracket-robot-king")).toBeInTheDocument()
  })

  it("renders seeded teams as “1 Thunder” style, hides S# chips, shows 0-0 and Next: TBD for active series", () => {
    const series: PlayoffSeriesView[] = [
      mk({
        id: "w5",
        seriesNumber: 5,
        round: "round_1",
        conference: "west",
        homeTeamName: "Thunder (W1)",
        awayTeamName: "Suns (W8)",
        homeSeed: 1,
        awaySeed: 8,
      }),
    ]
    render(<PlayoffBracketBoard sport="nba" rounds={[...rounds]} series={series} picks={[]} />)

    expect(screen.getByText("1 Thunder")).toBeInTheDocument()
    expect(screen.getByText("8 Suns")).toBeInTheDocument()
    expect(screen.queryByText("Thunder (W1)")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("nba-series-record").some((el) => el.textContent === "0-0")).toBe(true)
    expect(screen.getByTestId("nba-series-next")).toHaveTextContent(/Next:\s*TBD/i)
    expect(screen.queryByText(/^S5$/)).not.toBeInTheDocument()
  })

  it("calls onPick with canonical labels when buttons are selectable", () => {
    const onPick = vi.fn()
    const series: PlayoffSeriesView[] = [
      mk({
        id: "s1",
        seriesNumber: 1,
        round: "round_1",
        conference: "east",
        homeTeamName: "Celtics (E1)",
        awayTeamName: "76ers (E8)",
      }),
    ]
    render(<PlayoffBracketBoard sport="nba" rounds={[...rounds]} series={series} picks={[]} onPick={onPick} />)

    fireEvent.click(screen.getByRole("button", { name: "Celtics (E1)" }))
    expect(onPick).toHaveBeenCalledWith("s1", "Celtics (E1)")
  })

  it("shows champion projection with seed style when Finals pick uses template label", () => {
    const series: PlayoffSeriesView[] = [
      mk({
        id: "s15",
        seriesNumber: 15,
        conference: "finals",
        round: "finals",
        roundIndex: 4,
        homeTeamName: "Thunder (W1)",
        awayTeamName: "Celtics (E1)",
      }),
    ]
    const picks: PlayoffPickView[] = [
      {
        id: "pick-1",
        entryId: "entry-1",
        seriesId: "s15",
        pickTeamName: "Thunder (W1)",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]
    render(<PlayoffBracketBoard sport="nba" rounds={[...rounds]} series={series} picks={picks} />)

    const champion = screen.getByTestId("nba-bracket-champion")
    expect(champion).toHaveTextContent("1 Thunder")
  })

  it("does not invoke onPick when conference semifinal teams are locked", () => {
    const onPick = vi.fn()
    const series = [
      mk({
        id: "s9",
        round: "conference_semifinals",
        roundIndex: 2,
        seriesNumber: 9,
        conference: "east",
        homeTeamName: "Winner S1",
        awayTeamName: "Winner S2",
        displayHomeTeamName: "Winner S1",
        displayAwayTeamName: "Winner S2",
        homeSelectable: false,
        awaySelectable: false,
      }),
    ]
    render(<PlayoffBracketBoard sport="nba" rounds={[...rounds]} series={series} picks={[]} onPick={onPick} />)

    const b1 = screen.getByRole("button", { name: "Winner S1" })
    const b2 = screen.getByRole("button", { name: "Winner S2" })
    expect(b1).toBeDisabled()
    expect(b2).toBeDisabled()

    fireEvent.click(b1)
    fireEvent.click(b2)
    expect(onPick).not.toHaveBeenCalled()
  })

  it("omits Next: TBD when series is final", () => {
    const series: PlayoffSeriesView[] = [
      mk({
        id: "done",
        seriesNumber: 3,
        conference: "east",
        round: "round_1",
        status: "final",
        winnerTeamName: "Celtics (E1)",
        homeTeamName: "Celtics (E1)",
        awayTeamName: "Heat (E8)",
      }),
    ]
    const { container } = render(<PlayoffBracketBoard sport="nba" rounds={[...rounds]} series={series} picks={[]} />)
    expect(container.querySelector('[data-testid="nba-series-next"]')).toBeNull()
  })
})
