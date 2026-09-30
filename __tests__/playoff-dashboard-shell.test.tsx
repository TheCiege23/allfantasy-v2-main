import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PlayoffBracketShell from "@/components/brackets/playoffs/PlayoffBracketShell"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"

const pushMock = vi.hoisted(() => vi.fn())
const createPlayoffBracketEntryClientMock = vi.hoisted(() => vi.fn())
const getPlayoffBracketViewClientMock = vi.hoisted(() => vi.fn())
const savePlayoffBracketPickClientMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const toastWarningMock = vi.hoisted(() => vi.fn())
const toastInfoMock = vi.hoisted(() => vi.fn())
const useSessionMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
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
      warning: toastWarningMock,
      info: toastInfoMock,
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
    useSessionMock.mockReturnValue({ data: null })
    getPlayoffBracketViewClientMock.mockResolvedValue(buildView())
  })

  it("renders NBA dashboard title and does not show NCAA label", () => {
    render(<PlayoffBracketShell initialView={buildView()} />)

    expect(screen.getByRole("heading", { name: "NBA Playoff Bracket" })).toBeInTheDocument()
    expect(screen.queryByText("NCAA Bracket")).not.toBeInTheDocument()
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

  it("uses scored leaderboard copy when saved picks have resolved results even with zero points", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          entries: [
            {
              id: "entry-1",
              name: "Wrong Bracket",
              userId: "user-1",
              pickCount: 1,
              isComplete: true,
              totalScore: 0,
              correctPicks: 0,
              resolvedPicks: 1,
              createdAt: new Date().toISOString(),
            },
          ],
        })}
      />
    )

    expect(screen.getByText("Scored leaderboard from completed series results.")).toBeInTheDocument()
    expect(screen.getByText(/0 pts · 0\/1 correct · 1 picks/)).toBeInTheDocument()
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
    expect(screen.getByTestId("playoff-dashboard-leaderboard")).toBeInTheDocument()
    expect(screen.getByText("Pick-count leaderboard until series results sync.")).toBeInTheDocument()
    expect(screen.getByTestId("playoff-fill-bracket-cta")).toHaveTextContent("Create Your First Bracket")
  })

  it("ranks leaderboard by synced score when results exist", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          entries: [
            {
              id: "entry-1",
              name: "Wrong Bracket",
              userId: "user-1",
              pickCount: 15,
              isComplete: true,
              totalScore: 0,
              correctPicks: 0,
              createdAt: new Date().toISOString(),
            },
            {
              id: "entry-2",
              name: "Correct Bracket",
              userId: "user-2",
              pickCount: 10,
              isComplete: false,
              totalScore: 1,
              correctPicks: 1,
              createdAt: new Date().toISOString(),
            },
          ],
        })}
      />
    )

    expect(screen.getByText("Scored leaderboard from completed series results.")).toBeInTheDocument()
    expect(screen.getByText("#1 Correct Bracket")).toBeInTheDocument()
    expect(screen.getByText(/1 pts/)).toBeInTheDocument()
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

  it("opens an existing entry from the Complete Bracket CTA", () => {
    render(<PlayoffBracketShell initialView={buildView()} />)

    fireEvent.click(screen.getByTestId("playoff-fill-bracket-cta"))

    expect(pushMock).toHaveBeenCalledWith("/brackets/leagues/challenge-1/entries/entry-1")
    expect(createPlayoffBracketEntryClientMock).not.toHaveBeenCalled()
  })

  it("shows template warning until series sync runs and calls sync route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        warnings: ["No playoff series matched provider games."],
        attemptedProviders: ["rolling_insights_schedule_season", "rolling_insights", "espn_live"],
        source: "espn_live",
        sport: "nba",
        challengeSeasonYear: 2026,
        selectedProviderSeason: 2025,
        providerSeasonAttempts: [
          { provider: "rolling_insights_schedule_season", seasonYear: 2026, rowsReturned: 0, postseasonRows: 0 },
          { provider: "rolling_insights_schedule_season", seasonYear: 2025, rowsReturned: 1379, postseasonRows: 74 },
        ],
        seasonYear: 2026,
        postseasonGames: 0,
        gamesSeen: 1,
        gamesMatched: 0,
        seriesReturned: 0,
        seriesMatched: 0,
        seriesUpdated: 0,
        winnersUpdated: 0,
        unmatchedExamples: [{ homeTeam: "Knicks", awayTeam: "Pacers", round: 1 }],
        diagnostics: {
          seasonYear: 2026,
          challengeSeasonYear: 2026,
          selectedProviderSeason: 2025,
          providerSeasonAttempts: [
            { provider: "rolling_insights_schedule_season", seasonYear: 2026, rowsReturned: 0, postseasonRows: 0 },
            { provider: "rolling_insights_schedule_season", seasonYear: 2025, rowsReturned: 1379, postseasonRows: 74 },
          ],
          seasonSelectionExplanation: "Rolling Insights uses season start year; 2025 was selected for the 2025-26 season.",
          sport: "nba",
          selectedProvider: "espn_live",
          providerAttempts: [{ provider: "espn_live", gamesReturned: 1, postseasonGames: 0 }],
          existingSeriesExamples: [{ round: 1, homeTeam: "E1", awayTeam: "E8" }],
          providerGameExamples: [{ round: 1, homeTeam: "Knicks", awayTeam: "Pacers" }],
          providerSeriesExamples: [{ round: 1, homeTeam: "Knicks", awayTeam: "Pacers" }],
        },
      }),
    } as Response)
    getPlayoffBracketViewClientMock.mockResolvedValue(buildView())
    render(
      <PlayoffBracketShell
        initialView={buildView({
          challenge: { ...buildView().challenge, isTestMode: true },
          series: [
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
              nextSeriesNumber: 13,
              nextSeriesSlot: "home",
              sourceSeriesHome: 1,
              sourceSeriesAway: 2,
            },
          ],
        })}
      />
    )

    expect(screen.getByTestId("playoff-template-warning")).toHaveTextContent("Template teams shown until playoff series sync runs.")
    fireEvent.click(screen.getByTestId("playoff-sync-series-button"))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/brackets/playoffs/challenge-1/admin/sync-series?mode=official_bracket", expect.objectContaining({ method: "POST" }))
      expect(toastWarningMock).toHaveBeenCalledWith("No playoff series matched provider games.")
    })
    expect(screen.getByTestId("playoff-sync-diagnostics")).toHaveTextContent("rolling_insights_schedule_season")
    expect(screen.getByTestId("playoff-sync-diagnostics")).toHaveTextContent("existingSeriesExamples")
    expect(screen.getByTestId("playoff-sync-diagnostics")).toHaveTextContent("Rolling Insights uses season start year")

    fetchMock.mockRestore()
  })

  it("shows sync success and play-in info when series update with ignored play-in games", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        warnings: ["26 Play-In games ignored because this pool does not include Play-In picks."],
        attemptedProviders: ["rolling_insights_schedule_season"],
        source: "rolling_insights_schedule_season",
        sport: "nba",
        challengeSeasonYear: 2026,
        selectedProviderSeason: 2025,
        postseasonGames: 74,
        gamesSeen: 74,
        gamesMatched: 48,
        seriesReturned: 12,
        seriesMatched: 8,
        seriesUpdated: 8,
        winnersUpdated: 0,
        unmatchedExamples: [],
        diagnostics: {
          seasonYear: 2026,
          challengeSeasonYear: 2026,
          selectedProviderSeason: 2025,
          providerSeasonAttempts: [],
          sport: "nba",
          selectedProvider: "rolling_insights_schedule_season",
          providerAttempts: [],
          existingSeriesExamples: [],
          providerGameExamples: [],
          providerSeriesExamples: [],
          ignoredPlayInGames: 26,
          updatedSeriesExamples: [
            {
              round: 1,
              oldHomeTeam: "Celtics",
              oldAwayTeam: "76ers",
              newHomeTeam: "Boston Celtics",
              newAwayTeam: "Philadelphia 76ers",
              eventName: "East 1st Round:",
              status: "scheduled",
            },
          ],
        },
      }),
    } as Response)
    render(
      <PlayoffBracketShell
        initialView={buildView({
          challenge: { ...buildView().challenge, isTestMode: true },
          series: [
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
              nextSeriesNumber: 13,
              nextSeriesSlot: "home",
              sourceSeriesHome: 1,
              sourceSeriesAway: 2,
            },
          ],
        })}
      />
    )

    fireEvent.click(screen.getByTestId("playoff-sync-series-button"))

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Official bracket data synced. User picks were not changed.")
      expect(toastInfoMock).toHaveBeenCalledWith("Play-In games were ignored for this bracket.")
      expect(toastWarningMock).not.toHaveBeenCalled()
    })
    expect(screen.getByTestId("playoff-sync-diagnostics")).toHaveTextContent("updatedSeriesExamples")
    expect(screen.getByTestId("playoff-sync-status-message")).toHaveTextContent("Official bracket data synced. User picks were not changed.")

    fetchMock.mockRestore()
  })

  it("does not show sync action to a non-owner", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          viewerUserId: "user-2",
          challenge: { ...buildView().challenge, ownerUserId: "user-1", isTestMode: true },
          series: [
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
              nextSeriesNumber: 13,
              nextSeriesSlot: "home",
              sourceSeriesHome: 1,
              sourceSeriesAway: 2,
            },
          ],
        })}
      />
    )

    expect(screen.getByTestId("playoff-template-warning")).toBeInTheDocument()
    expect(screen.queryByTestId("playoff-commissioner-sync-tools")).not.toBeInTheDocument()
    expect(screen.queryByTestId("playoff-sync-series-button")).not.toBeInTheDocument()
    expect(screen.queryByTestId("playoff-sync-schedule-only-button")).not.toBeInTheDocument()
    expect(screen.queryByTestId("playoff-sync-results-only-button")).not.toBeInTheDocument()
  })

  it("shows playoff commissioner sync controls to the all-access account", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          email: "Cjabar.henson@gmail.com",
          username: "TheCiege26",
          name: "TheCiege26",
        },
      },
    })

    render(
      <PlayoffBracketShell
        initialView={buildView({
          viewerUserId: "user-2",
          challenge: { ...buildView().challenge, ownerUserId: "user-1", isTestMode: true },
          series: [
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
              nextSeriesNumber: 13,
              nextSeriesSlot: "home",
              sourceSeriesHome: 1,
              sourceSeriesAway: 2,
            },
          ],
        })}
      />
    )

    expect(screen.getByTestId("playoff-commissioner-sync-tools")).toHaveTextContent("Commissioner Sync Tools")
    expect(screen.getByTestId("playoff-sync-series-button")).toBeInTheDocument()
    expect(screen.getByTestId("playoff-sync-schedule-only-button")).toBeInTheDocument()
    expect(screen.getByTestId("playoff-sync-results-only-button")).toBeInTheDocument()
    expect(screen.getByTestId("playoff-sync-autofill-results-button")).toBeInTheDocument()
    expect(screen.getByText("Commissioner Tools")).toBeInTheDocument()
    expect(screen.getByTestId("playoff-sync-tools-visibility-debug")).toHaveTextContent("syncToolsVisible=true")
    expect(screen.getByTestId("playoff-sync-tools-visibility-debug")).toHaveTextContent("isAdmin=true")
  })

  it("shows playoff commissioner sync controls when server lock diagnostics grant admin access", () => {
    render(
      <PlayoffBracketShell
        initialView={buildView({
          viewerUserId: "user-2",
          challenge: { ...buildView().challenge, ownerUserId: "user-1", isTestMode: true },
          lockDiagnostics: {
            lockRule: "none",
            allowTestLatePicks: true,
            viewerCanLatePick: true,
            isPoolOwner: false,
            isTestMode: true,
            hasPoolAdminAccess: true,
          },
        })}
      />
    )

    expect(screen.getByTestId("playoff-commissioner-sync-tools")).toHaveTextContent("Commissioner Sync Tools")
    expect(screen.getByTestId("playoff-sync-results-only-button")).toBeInTheDocument()
    expect(screen.getByTestId("playoff-sync-tools-visibility-debug")).toHaveTextContent("isOwner=false")
    expect(screen.getByTestId("playoff-sync-tools-visibility-debug")).toHaveTextContent("hasPoolAdminAccess=true")
  })

  it("exposes separate official, schedule-only, and results-only sync modes for owners", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        mode: "teams_schedule_only",
        warnings: [],
        seriesUpdated: 1,
        picksAutoFilled: 0,
        diagnostics: {},
      }),
    } as Response)

    render(
      <PlayoffBracketShell
        initialView={buildView({
          challenge: { ...buildView().challenge, isTestMode: true },
          series: [
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
              nextSeriesNumber: 13,
              nextSeriesSlot: "home",
              sourceSeriesHome: 1,
              sourceSeriesAway: 2,
            },
          ],
        })}
      />
    )

    fireEvent.click(screen.getByTestId("playoff-sync-schedule-only-button"))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/brackets/playoffs/challenge-1/admin/sync-series?mode=teams_schedule_only", expect.objectContaining({ method: "POST" }))
      expect(toastSuccessMock).toHaveBeenCalledWith("Teams and schedule updated. User picks were not changed.")
      expect(screen.getByTestId("playoff-sync-results-only-button")).toBeEnabled()
    })

    fireEvent.click(screen.getByTestId("playoff-sync-results-only-button"))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/brackets/playoffs/challenge-1/admin/sync-series?mode=results_only", expect.objectContaining({ method: "POST" }))
      expect(toastSuccessMock).toHaveBeenCalledWith("Results synced. Reopen the entry or use Show Pick Results to verify Correct/Wrong picks.")
      expect(screen.getByTestId("playoff-sync-series-button")).toBeEnabled()
    })
    expect(screen.getByTestId("playoff-sync-status-message")).toHaveTextContent("Results synced. Reopen the entry or use Show Pick Results to verify Correct/Wrong picks.")

    fireEvent.click(screen.getByTestId("playoff-sync-series-button"))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/brackets/playoffs/challenge-1/admin/sync-series?mode=official_bracket", expect.objectContaining({ method: "POST" }))
      expect(toastSuccessMock).toHaveBeenCalledWith("Official bracket data synced. User picks were not changed.")
    })
    expect(screen.queryByTestId("playoff-sync-autofill-results-button")).not.toBeInTheDocument()

    fetchMock.mockRestore()
  })

  it("shows a safe inline error when commissioner sync fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Provider unavailable" }),
    } as Response)

    render(<PlayoffBracketShell initialView={buildView()} />)

    fireEvent.click(screen.getByTestId("playoff-sync-results-only-button"))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Provider unavailable")
      expect(screen.getByTestId("playoff-sync-status-message")).toHaveTextContent("Provider unavailable")
    })

    fetchMock.mockRestore()
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
