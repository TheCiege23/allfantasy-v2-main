import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import CfpBowlSchedule from "@/components/brackets/playoffs/CfpBowlSchedule"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"

describe("CFP bowl schedule", () => {
  it("shows the announced bowls without inventing bracket assignments or kickoff times", () => {
    render(<CfpBowlSchedule season={2026} series={[]} />)
    const schedule = screen.getByTestId("cfp-bowl-schedule")
    expect(within(schedule).getByText("Fiesta Bowl")).toBeInTheDocument()
    expect(within(schedule).getAllByText("Matchup to be announced")).toHaveLength(6)
    expect(within(schedule).getAllByText("Jan 1, 2027 · time TBA")).toHaveLength(3)
  })

  it("uses a published bowl matchup and kickoff when available", () => {
    const game = { gameLabel: "Vrbo Fiesta Bowl", startsAt: "2026-12-31T00:30:00.000Z", awayTeamName: "Georgia", homeTeamName: "Oregon" } as PlayoffSeriesView
    render(<CfpBowlSchedule season={2026} series={[game]} />)
    expect(screen.getByText("Georgia vs Oregon")).toBeInTheDocument()
    expect(screen.getByText("Dec 30, 2026, 7:30 PM ET")).toBeInTheDocument()
  })

  it("does not present 2026 bowl assignments as another season's schedule", () => {
    const { container } = render(<CfpBowlSchedule season={2027} series={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("does not present an unannounced slot as a team", () => {
    const game = { gameLabel: "Fiesta Bowl", startsAt: null, awayTeamName: "TBD", homeTeamName: "CFP1" } as PlayoffSeriesView
    render(<CfpBowlSchedule season={2026} series={[game]} />)
    expect(screen.queryByText("TBD vs CFP1")).not.toBeInTheDocument()
    expect(screen.getAllByText("Matchup to be announced")).toHaveLength(6)
  })
})
