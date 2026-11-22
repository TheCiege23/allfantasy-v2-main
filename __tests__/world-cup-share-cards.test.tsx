import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("WorldCupShareCard", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => undefined) },
    })
  })

  it("builds safe invite share copy with invite details", async () => {
    const WorldCupShareCard = (await import("@/components/brackets/world-cup/WorldCupShareCards")).default
    render(
      <WorldCupShareCard
        kind="invite"
        poolName="Office Cup"
        inviteUrl="https://allfantasy.com/join/bracket/INVITE"
        inviteCode="INVITE"
      />
    )

    const preview = screen.getByTestId("world-cup-share-preview-invite")
    expect(preview).toHaveTextContent("Join my World Cup Bracket Pool on AllFantasy")
    expect(preview).toHaveTextContent("Invite code: INVITE")
    expect(preview.textContent?.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager/)
    fireEvent.click(screen.getByRole("button", { name: /Copy share text/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("INVITE"))
  })

  it("uses finalized leaderboard rows supplied by the caller and omits unfinalized private names", async () => {
    const WorldCupShareCard = (await import("@/components/brackets/world-cup/WorldCupShareCards")).default
    render(
      <WorldCupShareCard
        kind="leaderboard"
        poolName="Office Cup"
        leaderboard={[
          {
            rank: 1,
            entryId: "final-1",
            entryName: "Finalized Entry",
            participantId: "p1",
            userId: "u1",
            username: null,
            avatarUrl: null,
            displayName: "Final User",
            totalScore: 50,
            maxPossibleScore: 100,
            correctPicks: 5,
            incorrectPicks: 0,
            championPickName: "Argentina",
            championTeamId: "arg",
            championStillAlive: true,
            roundBreakdown: {},
            joinedAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ]}
      />
    )

    const preview = screen.getByTestId("world-cup-share-preview-leaderboard")
    expect(preview).toHaveTextContent("#1 Finalized Entry - 50 pts")
    expect(preview).not.toHaveTextContent("Unfinalized Entry")
    expect(preview.textContent?.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager/)
  })

  it("shares only the current user's bracket summary props", async () => {
    const WorldCupShareCard = (await import("@/components/brackets/world-cup/WorldCupShareCards")).default
    render(
      <WorldCupShareCard
        kind="bracket"
        poolName="Office Cup"
        entryName="My Bracket"
        rank={3}
        totalScore={24}
        championName="Brazil"
        isComplete
      />
    )

    const preview = screen.getByTestId("world-cup-share-preview-bracket")
    expect(preview).toHaveTextContent("My World Cup bracket is locked in")
    expect(preview).toHaveTextContent("My Bracket - 24 pts - rank #3")
    expect(preview).toHaveTextContent("Champion pick: Brazil")
    expect(preview).not.toHaveTextContent("Other User")
  })

  it("shares public AI recap text and keeps mobile buttons visible", async () => {
    const WorldCupShareCard = (await import("@/components/brackets/world-cup/WorldCupShareCards")).default
    render(
      <WorldCupShareCard
        kind="recap"
        poolName="Office Cup"
        recapBody="AI recap from public pool chat. Finalized entries included: 2."
      />
    )

    const card = screen.getByTestId("world-cup-share-card-recap")
    expect(within(card).getByText(/Chimmy recap from Office Cup/i)).toBeInTheDocument()
    expect(within(card).getByRole("button", { name: /Copy share text/i })).toHaveClass("min-h-11")
    expect(within(card).getByRole("button", { name: /^Share$/i })).toHaveClass("min-h-11")
  })
})
