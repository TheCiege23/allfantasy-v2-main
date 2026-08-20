import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import PlayoffBracketBoard from "@/components/brackets/playoffs/PlayoffBracketBoard"
import type { PlayoffPickView, PlayoffSeriesView } from "@/lib/playoffs/types"

const rounds = ["round_1", "conference_semifinals", "conference_finals", "finals"] as const

const series: PlayoffSeriesView[] = [
  {
    id: "s1",
    round: "round_1",
    roundIndex: 1,
    seriesNumber: 1,
    conference: "east",
    homeSeed: 1,
    awaySeed: 8,
    homeTeamName: "Celtics (E1)",
    awayTeamName: "76ers (E8)",
    winnerTeamName: null,
    bestOf: 7,
    status: "scheduled",
    startsAt: null,
    nextSeriesNumber: 9,
    nextSeriesSlot: "home",
    sourceSeriesHome: null,
    sourceSeriesAway: null,
  },
]

const picks: PlayoffPickView[] = []

describe("PlayoffBracketBoard", () => {
  it("renders round columns and series cards", () => {
    render(<PlayoffBracketBoard rounds={[...rounds]} series={series} picks={picks} />)

    expect(screen.getByText("Round 1")).toBeInTheDocument()
    expect(screen.getByText("Conference Semis")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Celtics (E1)" })).toBeInTheDocument()
  })

  it("keeps matchup sides inactive when explicitly marked not selectable", () => {
    const semifinalSeries: PlayoffSeriesView[] = [
      {
        id: "s9",
        round: "conference_semifinals",
        roundIndex: 2,
        seriesNumber: 9,
        conference: "east",
        homeSeed: 0,
        awaySeed: 0,
        homeTeamName: "Winner S1",
        awayTeamName: "Winner S2",
        winnerTeamName: null,
        bestOf: 7,
        status: "scheduled",
        startsAt: null,
        nextSeriesNumber: null,
        nextSeriesSlot: null,
        sourceSeriesHome: 1,
        sourceSeriesAway: 2,
      },
    ]
    const onPick = vi.fn()
    render(
      <PlayoffBracketBoard
        rounds={[...rounds]}
        series={semifinalSeries.map((item) => ({
          ...item,
          displayHomeTeamName: item.homeTeamName,
          displayAwayTeamName: item.awayTeamName,
          homeSelectable: false,
          awaySelectable: false,
        }))}
        picks={picks}
        onPick={onPick}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Winner S1" }))
    fireEvent.click(screen.getByRole("button", { name: "Winner S2" }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it("calls onPick when a team is selected", () => {
    const onPick = vi.fn()
    render(<PlayoffBracketBoard rounds={[...rounds]} series={series} picks={picks} onPick={onPick} />)

    fireEvent.click(screen.getByRole("button", { name: "Celtics (E1)" }))

    expect(onPick).toHaveBeenCalledWith("s1", "Celtics (E1)")
  })
})
