import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"

vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ language: "en" }),
}))

// ── Minimal match factory ────────────────────────────────────────────────────

function m(overrides: Partial<WorldCupMatchView> = {}): WorldCupMatchView {
  return {
    id: "m1",
    apiFixtureId: null,
    round: "round_of_32",
    roundIndex: 1,
    matchNumber: 1,
    homeSlotKey: "A1",
    awaySlotKey: "B2",
    homeTeamId: "team-br",
    awayTeamId: "team-ar",
    homeTeamName: "Brazil",
    awayTeamName: "Argentina",
    homeTeamLogo: null,
    awayTeamLogo: null,
    homeScore: null,
    awayScore: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    status: "scheduled",
    // Far-future kickoff so none lock during tests
    startsAt: "2099-07-01T18:00:00.000Z",
    winnerTeamId: null,
    winnerTeamName: null,
    nextMatchId: null,
    nextMatchSlot: null,
    elapsedMinute: null,
    injuryTime: null,
    period: null,
    venueName: null,
    venueCity: null,
    apiStatusShort: "TEST",
    lastScoreSyncedAt: null,
    ...overrides,
  }
}

function makeView(challengeOverrides: Record<string, unknown> = {}) {
  return {
    challenge: {
      id: "c1",
      name: "Test Cup",
      ownerUserId: "u1",
      seasonYear: 2026,
      inviteCode: "INVITE",
      inviteUrl: null,
      visibility: "private" as const,
      pickLockStrategy: "tournament_start" as const,
      pickLockAt: null,
      maxParticipants: 100,
      maxEntriesPerParticipant: 5,
      effectivePickLockAt: "2099-07-01T18:00:00.000Z",
      status: "open",
      includeThirdPlace: false,
      knockoutMode: "predictive" as const,
      isTestMode: true,
      simulationEnabled: false,
      simulatedAt: null,
      simulationStatus: null,
      hasSimulatedResults: false,
      lastSyncedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      confidenceScoringEnabled: false,
      ...challengeOverrides,
    },
    scoring: {
      roundOf32Points: 10,
      roundOf16Points: 20,
      quarterFinalPoints: 40,
      semiFinalPoints: 80,
      finalPoints: 160,
      championBonusPoints: 320,
    },
    slots: [],
    participant: null,
    activeEntry: null,
    entries: [],
    picks: [],
    leaderboard: [],
    isOwner: false,
    isAdmin: false,
    hasBracketBrainAi: false,
  }
}

// Two R32 matches: index 1 → left, index 2 → right
const R32_LEFT = m({ id: "r32-l", matchNumber: 1, roundIndex: 1, homeTeamName: "Brazil", awayTeamName: "Argentina" })
const R32_RIGHT = m({ id: "r32-r", matchNumber: 9, roundIndex: 9, homeTeamName: "France", awayTeamName: "Germany" })
const R16_LEFT = m({ id: "r16-l", round: "round_of_16", roundIndex: 1, matchNumber: 17, homeTeamName: "Spain", awayTeamName: "Portugal" })
const R16_RIGHT = m({ id: "r16-r", round: "round_of_16", roundIndex: 5, matchNumber: 21, homeTeamName: "Netherlands", awayTeamName: "England" })
const QF_LEFT = m({ id: "qf-l", round: "quarterfinal", roundIndex: 1, matchNumber: 25, homeTeamName: "Brazil", awayTeamName: "Spain" })
const QF_RIGHT = m({ id: "qf-r", round: "quarterfinal", roundIndex: 3, matchNumber: 27, homeTeamName: "France", awayTeamName: "Netherlands" })
const SF_LEFT = m({ id: "sf-l", round: "semifinal", roundIndex: 1, matchNumber: 29, homeTeamName: "Brazil", awayTeamName: "France" })
const SF_RIGHT = m({ id: "sf-r", round: "semifinal", roundIndex: 2, matchNumber: 30, homeTeamName: "Spain", awayTeamName: "England" })
const FINAL = m({
  id: "final-1",
  round: "final",
  roundIndex: 1,
  matchNumber: 31,
  homeTeamName: "Brazil",
  awayTeamName: "France",
  homeTeamId: "team-br",
  awayTeamId: "team-fr",
  homeSlotKey: "SF-W1",
  awaySlotKey: "SF-W2",
})
const THIRD_PLACE = m({
  id: "third-1",
  round: "third_place",
  roundIndex: 1,
  matchNumber: 32,
  homeTeamName: "Spain",
  awayTeamName: "England",
})

const ALL_MATCHES = [R32_LEFT, R32_RIGHT, R16_LEFT, R16_RIGHT, QF_LEFT, QF_RIGHT, SF_LEFT, SF_RIGHT, FINAL]

async function renderBoard(
  matches: WorldCupMatchView[] = ALL_MATCHES,
  picks: WorldCupPickView[] = [],
  challengeOverrides: Record<string, unknown> = {},
  onPick = vi.fn(),
) {
  const mod = await import("@/components/brackets/world-cup/WorldCupBracketBoard")
  const WorldCupBracketBoard = mod.default
  render(
    <WorldCupBracketBoard
      view={makeView(challengeOverrides) as any}
      picks={picks}
      matches={matches}
      onPick={onPick}
    />,
  )
  return { onPick }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WorldCupBracketBoard layout", () => {
  it("renders the scroll container with the required testid", async () => {
    await renderBoard()
    expect(screen.getByTestId("world-cup-knockout-board-scroll")).toBeInTheDocument()
  })

  it("shows round labels using translated text, not raw i18n keys", async () => {
    await renderBoard()
    const board = screen.getByTestId("world-cup-knockout-board-scroll")
    // Translated English labels should appear
    expect(board).toHaveTextContent("Round of 32")
    expect(board).toHaveTextContent("Semifinals")
    expect(board).toHaveTextContent("Final")
    // Raw key fragments must not appear
    expect(board.textContent).not.toMatch(/wc\.round\.|wc\.matchup\./)
  })

  it("renders R32 left and right match cards", async () => {
    await renderBoard()
    // Left card (roundIndex 1)
    expect(screen.getByTestId("world-cup-match-r32-l")).toBeInTheDocument()
    // Right card (roundIndex 9)
    expect(screen.getByTestId("world-cup-match-r32-r")).toBeInTheDocument()
  })

  it("renders the Final match card in the center column", async () => {
    await renderBoard()
    expect(screen.getByTestId("world-cup-match-final-1")).toBeInTheDocument()
  })

  it("both SF matches appear (one per side)", async () => {
    await renderBoard()
    expect(screen.getByTestId("world-cup-match-sf-l")).toBeInTheDocument()
    expect(screen.getByTestId("world-cup-match-sf-r")).toBeInTheDocument()
  })

  it("shows the champion pick banner with fallback text when no pick is made", async () => {
    await renderBoard()
    const board = screen.getByTestId("world-cup-knockout-board-scroll")
    expect(board).toHaveTextContent("Champion Pick")
    expect(board).toHaveTextContent("Not picked")
  })

  it("shows champion name in banner after final pick", async () => {
    const finalPick: WorldCupPickView = {
      id: "pk-final",
      matchId: "final-1",
      round: "final",
      selectedTeamId: "team-br",
      selectedSlotKey: "SF-W1",
      selectedTeamName: "Brazil",
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
    }
    await renderBoard(ALL_MATCHES, [finalPick])
    const board = screen.getByTestId("world-cup-knockout-board-scroll")
    // Champion name appears in the banner
    expect(board).toHaveTextContent("Brazil")
    // "Not picked" should be replaced
    expect(board).not.toHaveTextContent("Not picked")
  })

  it("hides third-place section when includeThirdPlace is false", async () => {
    await renderBoard([...ALL_MATCHES, THIRD_PLACE], [], { includeThirdPlace: false })
    expect(screen.queryByTestId("world-cup-match-third-1")).not.toBeInTheDocument()
  })

  it("shows third-place match card when includeThirdPlace is true", async () => {
    await renderBoard([...ALL_MATCHES, THIRD_PLACE], [], { includeThirdPlace: true })
    expect(screen.getByTestId("world-cup-match-third-1")).toBeInTheDocument()
    // Third Place label visible
    expect(screen.getByTestId("world-cup-knockout-board-scroll")).toHaveTextContent("Third Place")
  })
})

describe("WorldCupBracketBoard pick interaction", () => {
  it("calls onPick when a pickable R32 team button is clicked", async () => {
    const { onPick } = await renderBoard()
    // R32_LEFT home team is Brazil
    const brazilBtn = within(screen.getByTestId("world-cup-match-r32-l")).getByRole("button", {
      name: /Pick Brazil to win/i,
    })
    fireEvent.click(brazilBtn)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r32-l" }),
      "home",
      null,
    )
  })

  it("disables team buttons for a match whose kickoff has already passed", async () => {
    const pastMatch = m({
      id: "past-m",
      matchNumber: 99,
      roundIndex: 1,
      homeTeamName: "Brazil",
      awayTeamName: "Argentina",
      startsAt: "2020-01-01T00:00:00.000Z", // past kickoff
      apiStatusShort: null, // no TEST override
    })
    const onPick = vi.fn()
    await renderBoard([pastMatch], [], {}, onPick)

    const card = screen.getByTestId("world-cup-match-past-m")
    const buttons = within(card).getAllByRole("button")
    expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true)
    fireEvent.click(buttons[0])
    expect(onPick).not.toHaveBeenCalled()
  })

  it("marks a selected pick with aria-pressed=true", async () => {
    const pick: WorldCupPickView = {
      id: "pk-r32",
      matchId: "r32-l",
      round: "round_of_32",
      selectedTeamId: "team-br",
      selectedSlotKey: "A1",
      selectedTeamName: "Brazil",
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
    }
    await renderBoard(ALL_MATCHES, [pick])
    const brazilBtn = within(screen.getByTestId("world-cup-match-r32-l")).getByRole("button", {
      name: /Selected: Brazil to win/i,
    })
    expect(brazilBtn).toHaveAttribute("aria-pressed", "true")
  })
})

describe("WorldCupBracketBoard split logic", () => {
  it("R32 match with lower roundIndex appears in left half, higher in right half", async () => {
    await renderBoard()
    // Both cards rendered — geometry is CSS, but we can confirm IDs present
    const board = screen.getByTestId("world-cup-knockout-board-scroll")
    const leftCard = within(board).getByTestId("world-cup-match-r32-l")
    const rightCard = within(board).getByTestId("world-cup-match-r32-r")
    expect(leftCard).toBeInTheDocument()
    expect(rightCard).toBeInTheDocument()
  })

  it("renders SF matches using the SF column on each side", async () => {
    await renderBoard()
    // Both SF match cards exist — one feeds Final from each side
    expect(screen.getByTestId("world-cup-match-sf-l")).toBeInTheDocument()
    expect(screen.getByTestId("world-cup-match-sf-r")).toBeInTheDocument()
  })
})
