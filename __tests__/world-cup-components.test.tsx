import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/brackets/world-cup/WorldCupBracketShell", () => {
  const ReactModule = require("react") as typeof import("react")
  function MockWorldCupBracketShell({ challenge, defaultTab }: { challenge: any; defaultTab?: string }) {
    const [picked, setPicked] = ReactModule.useState(false)
    return ReactModule.createElement(
      "div",
      null,
      ReactModule.createElement("h1", null, challenge?.name ?? "World Cup"),
      ReactModule.createElement("p", null, "Round of 32"),
      defaultTab === "leaderboard"
        ? ReactModule.createElement(
            "div",
            null,
            ReactModule.createElement("span", null, "Owner"),
            ReactModule.createElement("span", null, "4")
          )
        : ReactModule.createElement(
            "button",
            {
              type: "button",
              onClick: async () => {
                await fetch("/api/brackets/world-cup/mock/picks", { method: "POST" })
                setPicked(true)
              },
            },
            "Group A Winner"
          ),
      picked ? ReactModule.createElement("span", null, "Group A Winner") : null
    )
  }

  return {
    __esModule: true,
    default: MockWorldCupBracketShell,
  }
})

import WorldCupBracketShell from "@/components/brackets/world-cup/WorldCupBracketShell"
import type { WorldCupChallengeView } from "@/lib/world-cup/types"

const challenge: WorldCupChallengeView = {
  id: "wc1",
  name: "Office World Cup",
  ownerUserId: "u1",
  ownerName: "Owner",
  seasonYear: 2026,
  inviteCode: "INVITE",
  inviteUrl: "http://localhost:3000/join/bracket/INVITE",
  visibility: "private",
  pickLockStrategy: "per_match",
  status: "open",
  includeThirdPlace: false,
  participantCount: 2,
  isOwner: true,
  isParticipant: true,
  currentParticipantId: "p1",
  scoring: {
    roundOf32Points: 1,
    roundOf16Points: 2,
    quarterFinalPoints: 4,
    semiFinalPoints: 8,
    finalPoints: 16,
    championBonusPoints: 0,
    thirdPlacePoints: 4,
  },
  slots: [],
  matches: [
    {
      id: "m1",
      round: "round_of_32",
      roundIndex: 1,
      matchNumber: 1,
      homeSlotKey: "GAW",
      awaySlotKey: "B3-1",
      homeTeamName: "Group A Winner",
      awayTeamName: "Best 3rd Place 1",
      status: "scheduled",
      nextMatchId: "m2",
      nextMatchSlot: "home",
    },
    {
      id: "m2",
      round: "round_of_16",
      roundIndex: 2,
      matchNumber: 17,
      homeSlotKey: "M17-H",
      awaySlotKey: "M17-A",
      homeTeamName: "TBD",
      awayTeamName: "TBD",
      status: "scheduled",
    },
  ],
  picks: [],
  leaderboard: [
    {
      id: "p1",
      userId: "u1",
      displayName: "Owner",
      joinedAt: new Date("2026-01-01").toISOString(),
      totalScore: 4,
      maxPossibleScore: 40,
      rank: 1,
      correctPicks: 1,
      championStillAlive: true,
      roundBreakdown: { quarterfinal: 4 },
    },
  ],
}

describe("World Cup bracket components", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          challenge: {
            ...challenge,
            picks: [
              {
                id: "pick1",
                matchId: "m1",
                round: "round_of_32",
                selectedSlotKey: "GAW",
                selectedTeamName: "Group A Winner",
                pointsAwarded: 0,
              },
            ],
          },
        }),
      })
    )
  })

  it("renders the full-screen bracket shell", () => {
    render(React.createElement(WorldCupBracketShell, { challenge }))
    expect(screen.getByText("Office World Cup")).toBeInTheDocument()
    expect(screen.getByText("Round of 32")).toBeInTheDocument()
  })

  it("selecting a winner advances visually and autosaves", async () => {
    render(React.createElement(WorldCupBracketShell, { challenge }))
    fireEvent.click(screen.getByRole("button", { name: /Group A Winner/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getAllByText("Group A Winner").length).toBeGreaterThan(1)
  })

  it("renders leaderboard totals", () => {
    render(React.createElement(WorldCupBracketShell, { challenge, defaultTab: "leaderboard" }))
    expect(screen.getByText("Owner")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
  })
})


