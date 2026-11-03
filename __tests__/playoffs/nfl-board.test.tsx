import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import MlbBracketBoard from "@/components/brackets/playoffs/MlbBracketBoard"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import type { PlayoffChallengeView, PlayoffPickView } from "@/lib/playoffs/types"

vi.mock("next/link", () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }))
vi.mock("@/app/components/TeamLogo", () => ({ TeamLogo: ({ teamAbbr }: any) => <img alt={teamAbbr} /> }))
afterEach(cleanup)

const FIELD: Record<string, string> = {
  AFC1: "Denver Broncos", AFC2: "New England Patriots", AFC3: "Jacksonville Jaguars", AFC4: "Pittsburgh Steelers",
  AFC5: "Houston Texans", AFC6: "Buffalo Bills", AFC7: "Los Angeles Chargers",
  NFC1: "Seattle Seahawks", NFC2: "Chicago Bears", NFC3: "Philadelphia Eagles", NFC4: "Carolina Panthers",
  NFC5: "Los Angeles Rams", NFC6: "San Francisco 49ers", NFC7: "Green Bay Packers",
}

function view(picks: Array<[number, string]> = []): PlayoffChallengeView {
  const series = buildPlayoffTemplate({ sport: "nfl", seasonYear: 2026 }).map((row) => ({
    ...row,
    id: `s${row.seriesNumber}`,
    homeTeamName: FIELD[row.homeTeamName] ?? row.homeTeamName,
    awayTeamName: FIELD[row.awayTeamName] ?? row.awayTeamName,
    startsAt: row.round === "nfl_wild_card" ? "2099-01-09T18:00:00.000Z" : null,
  }))
  return {
    viewerUserId: "u",
    challenge: { id: "nfl", name: "Sunday Crew", sport: "nfl", ownerUserId: "u", seasonYear: 2026, status: "open", isTestMode: false, firstGameStartsAt: "2099-01-09T18:00:00.000Z", createdAt: "", updatedAt: "" },
    activeEntry: { id: "e", userId: "u", name: "My picks", pickCount: picks.length, isComplete: false, createdAt: "" },
    entries: [], participants: [], series,
    picks: picks.map(([n, team]) => ({ id: `p${n}`, entryId: "e", seriesId: `s${n}`, pickTeamName: team, createdAt: "", updatedAt: "" })) as PlayoffPickView[],
    rounds: ["nfl_wild_card", "nfl_divisional", "nfl_conference", "nfl_super_bowl"],
  } as unknown as PlayoffChallengeView
}

describe("NFL bracket board", () => {
  it("draws AFC and NFC as mirrored halves meeting at the Super Bowl, with picks open", () => {
    render(<MlbBracketBoard view={view()} onViewChange={() => {}} />)
    expect(screen.getByText(/14 teams · AFC and NFC/)).toBeInTheDocument()
    expect(screen.getByText("Picks open")).toBeInTheDocument()
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument()
    // Seed-slope "series reads" are meaningless for NFL names and reseeded slots.
    expect(screen.queryByTestId("pb-decision-rail")).not.toBeInTheDocument()
    expect(within(screen.getByTestId("pb-champion")).getAllByText("Super Bowl").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Wild Card").length).toBeGreaterThanOrEqual(2)
    // The 1 seed waits in the divisional round; its opponent is not decided yet.
    expect(within(screen.getByTestId("pb-series-7")).getByText("Broncos")).toBeInTheDocument()
  })

  it("fills the 1 seed's opponent from the entry's own Wild Card picks", () => {
    render(<MlbBracketBoard view={view([[1, "New England Patriots"], [2, "Buffalo Bills"], [3, "Houston Texans"]])} onViewChange={() => {}} />)
    // Winners 2, 6, 5: the lowest seed left is the Bills.
    expect(within(screen.getByTestId("pb-series-7")).getByText("Bills")).toBeInTheDocument()
    expect(within(screen.getByTestId("pb-series-8")).getByText("Patriots")).toBeInTheDocument()
    expect(within(screen.getByTestId("pb-series-8")).getByText("Texans")).toBeInTheDocument()
  })
})
