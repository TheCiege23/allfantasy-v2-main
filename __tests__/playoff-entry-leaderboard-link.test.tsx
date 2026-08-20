import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import PlayoffBracketEntryShell from "@/components/brackets/playoffs/PlayoffBracketEntryShell"
import { playoffChallengeLeaderboardHref } from "@/lib/playoffs/playoffBracketDataSource"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"

function buildEntryView(): PlayoffChallengeView {
  return {
    viewerUserId: "user-1",
    challenge: {
      id: "challenge-z",
      name: "NHL Test Pool",
      ownerUserId: "user-1",
      sport: "nhl",
      seasonYear: 2026,
      status: "open",
      isTestMode: false,
      visibility: "private",
      maxParticipants: 100,
      maxEntriesPerParticipant: 5,
      scoringStyle: "series_winner",
      lockRule: "first_tipoff",
      inviteCode: "ABCDEFGH",
      inviteUrl: "/brackets/leagues/challenge-z",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    participants: [],
    activeEntry: {
      id: "entry-99",
      name: "Bracket 1",
      userId: "user-1",
      pickCount: 0,
      isComplete: false,
      createdAt: new Date().toISOString(),
    },
    entries: [],
    series: [],
    picks: [],
    rounds: ["round_1", "conference_semifinals", "conference_finals", "finals"],
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe("PlayoffBracketEntryShell leaderboard link", () => {
  it("links to tab=leaderboard with hash anchor for reliable browser targeting", () => {
    render(<PlayoffBracketEntryShell initialView={buildEntryView()} />)

    const link = screen.getByTestId("playoff-entry-leaderboard-link")
    expect(link).toHaveAttribute("href", playoffChallengeLeaderboardHref("challenge-z"))
    expect(link).toHaveAccessibleName(/view pool leaderboard/i)
    expect(screen.getByText(/Opens the pool dashboard leaderboard/i)).toBeInTheDocument()
  })
})
