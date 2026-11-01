import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
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
  it("shows upcoming group games with logos and venue while knockout slots are pending", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    const group = screen.getByRole("region", { name: "NBA Cup Group Play" })
    expect(within(group).getByText(/TD Garden/)).toBeInTheDocument()
    expect(within(group).getByRole("img", { name: "Boston Celtics" })).toHaveAttribute("src", "https://example.test/bos.png")
    expect(screen.getByText(/Join anytime/)).toBeInTheDocument()
    expect(screen.queryByText(/must be published/)).not.toBeInTheDocument()
    expect(screen.queryByTestId("pb-series-1002")).not.toBeInTheDocument()
  })
  it("opens the full-screen matchup and allows an upcoming pick after the first Cup game", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    fireEvent.click(within(screen.getByTestId("pb-series-1001")).getAllByRole("button", { name: /Open Boston Celtics versus Charlotte Hornets/ })[0])
    const matchup = screen.getByRole("dialog")
    expect(within(matchup).getByText("Chimmy Intelligence")).toBeInTheDocument()
    expect(within(matchup).getByRole("button", { name: "Pick Boston Celtics" })).toBeEnabled()
  })
  it("shows finished games on demand and keeps their pick buttons locked", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "All games" }))
    fireEvent.click(within(screen.getByTestId("pb-series-1002")).getAllByRole("button", { name: /Open Boston Celtics versus Charlotte Hornets/ })[0])
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick Boston Celtics" })).toBeDisabled()
  })
})
