import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PlayoffBracketShell from "@/components/brackets/playoffs/PlayoffBracketShell"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"

const pushMock = vi.hoisted(() => vi.fn())
const useSearchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams()))
const createPlayoffBracketEntryClientMock = vi.hoisted(() => vi.fn())
const getPlayoffBracketViewClientMock = vi.hoisted(() => vi.fn())
const savePlayoffBracketPickClientMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => useSearchParamsMock(),
}))

vi.mock("@/lib/playoffs/playoffClientApi", () => ({
  createPlayoffBracketEntryClient: createPlayoffBracketEntryClientMock,
  getPlayoffBracketViewClient: getPlayoffBracketViewClientMock,
  savePlayoffBracketPickClient: savePlayoffBracketPickClientMock,
}))

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}))

function buildView(overrides: Partial<PlayoffChallengeView> = {}): PlayoffChallengeView {
  return {
    viewerUserId: "user-1",
    challenge: {
      id: "challenge-1",
      name: "NBA Playoff Bracket",
      ownerUserId: "user-1",
      sport: "nba",
      seasonYear: 2026,
      status: "open",
      isTestMode: false,
      visibility: "private",
      maxParticipants: 100,
      maxEntriesPerParticipant: 5,
      scoringStyle: "series_winner",
      lockRule: "first_tipoff",
      inviteCode: "ABCDEFGH",
      inviteUrl: "/brackets/leagues/challenge-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    participants: [{ userId: "user-1", displayName: "Test User", entryCount: 1 }],
    activeEntry: {
      id: "entry-1",
      name: "Bracket 1",
      userId: "user-1",
      pickCount: 0,
      isComplete: false,
      createdAt: new Date().toISOString(),
    },
    entries: [
      {
        id: "entry-1",
        name: "Bracket 1",
        userId: "user-1",
        pickCount: 0,
        isComplete: false,
        createdAt: new Date().toISOString(),
      },
    ],
    series: [],
    picks: [],
    rounds: ["round_1", "conference_semifinals", "conference_finals", "finals"],
    ...overrides,
  }
}

describe("PlayoffBracketShell dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSearchParamsMock.mockImplementation(() => new URLSearchParams())
    getPlayoffBracketViewClientMock.mockResolvedValue(buildView())
  })

  it("shows leaderboard tab context copy when opened with tab=leaderboard", () => {
    useSearchParamsMock.mockImplementation(() => new URLSearchParams("tab=leaderboard"))

    render(<PlayoffBracketShell initialView={buildView()} />)

    expect(screen.getByText(/You are viewing standings for every bracket entry in this pool/i)).toBeInTheDocument()
  })

  it("renders NBA dashboard title and does not show NCAA label", () => {
    render(<PlayoffBracketShell initialView={buildView()} />)

    expect(screen.getByRole("heading", { name: "NBA Playoff Bracket" })).toBeInTheDocument()
    expect(screen.queryByText("NCAA Bracket")).not.toBeInTheDocument()
  })

  it("scrolls leaderboard anchor into view when tab=leaderboard is present", async () => {
    useSearchParamsMock.mockImplementationOnce(() => new URLSearchParams("tab=leaderboard"))
    const scrollSpy = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof HTMLElement.prototype.scrollIntoView

    render(<PlayoffBracketShell initialView={buildView()} />)

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled())
  })

  it("uses tighter flex order when leaderboardFirst is requested", () => {
    render(<PlayoffBracketShell initialView={buildView()} leaderboardFirst />)

    expect(screen.getByTestId("playoff-dashboard-leaderboard").className).toContain("order-20")
  })

  it("keeps leaderboard after middle sections when not promoted", () => {
    render(<PlayoffBracketShell initialView={buildView()} />)

    expect(screen.getByTestId("playoff-dashboard-leaderboard").className).toContain("order-40")
  })

  it("renders NHL dashboard title", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          challenge: {
            ...buildView().challenge,
            sport: "nhl",
            name: "NHL Playoff Bracket",
          },
        })}
      />
    )

    expect(screen.getByRole("heading", { name: "NHL Playoff Bracket" })).toBeInTheDocument()
  })

  it("renders Soccer dashboard title and does not show NCAA label", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          challenge: {
            ...buildView().challenge,
            sport: "soccer" as any,
            name: "Soccer Playoff Bracket",
          },
        })}
      />
    )

    expect(screen.getByRole("heading", { name: "Soccer Playoff Bracket" })).toBeInTheDocument()
    expect(screen.queryByText("NCAA Bracket")).not.toBeInTheDocument()
  })

  it("renders participants, my brackets, leaderboard, and first-entry CTA", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          activeEntry: null,
          entries: [],
          participants: [{ userId: "user-1", displayName: "Test User", entryCount: 0 }],
        })}
      />
    )

    expect(screen.getByRole("heading", { name: "Participants" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "My Brackets / Entries" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Pool Leaderboard" })).toBeInTheDocument()
    expect(screen.getByTestId("playoff-dashboard-leaderboard")).toBeInTheDocument()
    expect(screen.getByTestId("playoff-fill-bracket-cta")).toHaveTextContent("Create Your First Bracket")
  })

  it("creates another bracket entry and redirects to canonical pool entry route", async () => {
    createPlayoffBracketEntryClientMock.mockResolvedValue({
      challengeId: "challenge-1",
      entryId: "entry-2",
      redirectUrl: "/brackets/leagues/challenge-1/entries/entry-2",
    })

    render(<PlayoffBracketShell initialView={buildView()} />)

    fireEvent.click(screen.getByRole("button", { name: "Create Another Bracket" }))

    await waitFor(() => {
      expect(createPlayoffBracketEntryClientMock).toHaveBeenCalled()
      expect(pushMock).toHaveBeenCalledWith("/brackets/leagues/challenge-1/entries/entry-2")
    })
  })

  it("shows only the viewer's entries in My Brackets while keeping leaderboard entries", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          entries: [
            {
              id: "entry-1",
              name: "My Bracket",
              userId: "user-1",
              pickCount: 4,
              isComplete: false,
              createdAt: new Date().toISOString(),
            },
            {
              id: "entry-2",
              name: "Other User Bracket",
              userId: "user-2",
              pickCount: 6,
              isComplete: true,
              createdAt: new Date().toISOString(),
            },
          ],
        })}
      />
    )

    expect(screen.getByText("My Bracket")).toBeInTheDocument()
    expect(screen.getByText("#1 Other User Bracket")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Other User Bracket/i })).not.toBeInTheDocument()
  })

  it("blocks 6th entry creation", async () => {
    const fiveEntries = Array.from({ length: 5 }).map((_, index) => ({
      id: `entry-${index + 1}`,
      name: `Bracket ${index + 1}`,
      userId: "user-1",
      pickCount: 0,
      isComplete: false,
      createdAt: new Date().toISOString(),
    }))

    render(
      <PlayoffBracketShell
        initialView={buildView({
          entries: fiveEntries,
          participants: [{ userId: "user-1", displayName: "Test User", entryCount: 5 }],
        })}
      />
    )

    expect(screen.queryByRole("button", { name: "Create Another Bracket" })).not.toBeInTheDocument()
    expect(screen.getByText("Entry limit reached. Bracket 6 is blocked.")).toBeInTheDocument()
  })
})
