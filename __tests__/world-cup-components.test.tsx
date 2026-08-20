import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"

const clientApiMocks = vi.hoisted(() => ({
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  adminLoadTestFixtures: vi.fn(),
  adminResetSimulation: vi.fn(),
  adminSimulateMatch: vi.fn(),
  adminSimulateRound: vi.fn(),
  adminSimulateTournament: vi.fn(),
  adminSyncTeams: vi.fn(),
  adminSyncFixtures: vi.fn(),
  adminSyncLive: vi.fn(),
  clearPicks: vi.fn(),
  createEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getIntegrityReport: vi.fn(),
  renameEntry: vi.fn(),
  savePick: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}))

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}))

vi.mock("@/lib/world-cup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/world-cup")>()
  return {
    ...actual,
    getWorldCupChallengeView: vi.fn(async () => null),
  }
})

vi.mock("@/lib/world-cup/adminPage", () => ({
  hasWorldCupAdminPageSession: vi.fn(() => false),
}))

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt?: string; src: string }) => <img alt={alt ?? ""} src={src} />,
}))

vi.mock("@/components/brackets/world-cup/WorldCupMatchupIntelligencePanel", () => ({
  default: () => <div data-testid="wc-intel-stub" />,
}))

vi.mock("@/lib/world-cup/worldCupClientApi", () => ({
  adminLoadWorldCupTestFixtures: clientApiMocks.adminLoadTestFixtures,
  adminResetWorldCupSimulation: clientApiMocks.adminResetSimulation,
  adminSimulateWorldCupMatch: clientApiMocks.adminSimulateMatch,
  adminSimulateWorldCupRound: clientApiMocks.adminSimulateRound,
  adminSimulateWorldCupTournament: clientApiMocks.adminSimulateTournament,
  adminSyncWorldCupFixtures: clientApiMocks.adminSyncFixtures,
  adminSyncWorldCupLive: clientApiMocks.adminSyncLive,
  adminSyncWorldCupTeams: clientApiMocks.adminSyncTeams,
  clearWorldCupBracketEntryPicks: clientApiMocks.clearPicks,
  createWorldCupBracketEntry: clientApiMocks.createEntry,
  deleteWorldCupBracketEntry: clientApiMocks.deleteEntry,
  getWorldCupIntegrityReport: clientApiMocks.getIntegrityReport,
  getWorldCupBracketEntry: clientApiMocks.getEntry,
  getEntryStatus: (entry: { isLocked?: boolean; isComplete?: boolean; correctPicks?: number; totalScore?: number }) =>
    entry.isLocked ? "locked" : entry.isComplete ? "complete" : (entry.correctPicks ?? 0) > 0 || (entry.totalScore ?? 0) > 0 ? "in_progress" : "not_started",
  listWorldCupBracketEntries: clientApiMocks.listEntries,
  renameWorldCupBracketEntry: clientApiMocks.renameEntry,
  saveWorldCupBracketEntryPick: clientApiMocks.savePick,
}))

function mockSettingsPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    challenge: {
      id: "ch1",
      name: "Test Cup",
      visibility: "private",
      inviteCode: "WCUP123",
      maxParticipants: 100,
      maxEntriesPerParticipant: 5,
      includeThirdPlace: true,
    },
    scoring: {
      roundOf32Points: 10,
      roundOf16Points: 20,
      quarterFinalPoints: 40,
      semiFinalPoints: 80,
      finalPoints: 160,
      championBonusPoints: 320,
      thirdPlacePoints: 4,
    },
    leagueSettings: {
      scoringStyle: "standard",
      tiebreakerFinalScore: false,
      allowLateJoin: false,
      showPublicPicks: "after_lock",
      bracketBrainEnabled: true,
      inviteGateConfigured: false,
    },
    commissioner: {
      enableSystemEvents: true,
      enableUpsetAlerts: true,
      enableLeaderboardAlerts: true,
      enableChampionBustAlerts: true,
      enableLockReminders: true,
      enableAiSummaries: false,
    },
    hasAfPro: false,
    isAdmin: false,
    earlyPublicPicksAllowed: false,
    ...overrides,
  }
}

describe("World Cup commissioner UI modules", () => {
  it("loads commissioner brain panel module", async () => {
    const m = await import("@/components/brackets/world-cup/WorldCupCommissionerBrainPanel")
    expect(m.default).toBeDefined()
  })
})

describe("WorldCup pool route recovery", () => {
  it("shows a friendly recovery UI when a World Cup pool id is not found", async () => {
    const Page = (await import("@/app/brackets/world-cup/[bracketId]/page")).default
    render(
      await Page({
        params: { bracketId: "legacy-bracket-league-id" },
        searchParams: {},
      })
    )

    expect(screen.getByText("World Cup pool not found")).toBeInTheDocument()
    expect(screen.getByText(/old bracket system or deleted/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Back to World Cup Pools/i })).toHaveAttribute("href", "/brackets/world-cup")
    expect(screen.getByRole("link", { name: /Create New World Cup Pool/i })).toHaveAttribute("href", "/brackets/world-cup/create")
  })
})

describe("WorldCupBracketSettingsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSettingsPayload(),
      })
    )
  })

  it("renders defaults and scoring preview after load", async () => {
    const WorldCupBracketSettingsPanel = (await import("@/components/brackets/world-cup/WorldCupBracketSettingsPanel"))
      .default
    render(<WorldCupBracketSettingsPanel challengeId="ch1" />)

    await waitFor(() => {
      expect(screen.queryByTestId("world-cup-settings-loading")).not.toBeInTheDocument()
    })

    expect(screen.getByTestId("world-cup-settings-panel")).toBeInTheDocument()
    const preview = screen.getByTestId("world-cup-settings-scoring-preview")
    expect(preview.textContent).toMatch(/Round of 32/)
    expect(preview.textContent).toMatch(/Champion bonus/)
  })

  it("does not show Bracket Brain toggle for non-Pro", async () => {
    const WorldCupBracketSettingsPanel = (await import("@/components/brackets/world-cup/WorldCupBracketSettingsPanel"))
      .default
    render(<WorldCupBracketSettingsPanel challengeId="ch1" />)

    await waitFor(() => {
      expect(screen.queryByTestId("world-cup-settings-loading")).not.toBeInTheDocument()
    })

    expect(screen.queryByTestId("world-cup-settings-bracket-brain")).toBeNull()
  })

  it("shows basic alert toggles without AF Pro", async () => {
    const WorldCupBracketSettingsPanel = (await import("@/components/brackets/world-cup/WorldCupBracketSettingsPanel"))
      .default
    render(<WorldCupBracketSettingsPanel challengeId="ch1" />)

    await waitFor(() => {
      expect(screen.queryByTestId("world-cup-settings-loading")).not.toBeInTheDocument()
    })

    expect(screen.getByText(/^Upset alerts$/i)).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: /^Lock reminders$/i })).toBeInTheDocument()
  })

  it("shows client validation for max users above cap", async () => {
    const WorldCupBracketSettingsPanel = (await import("@/components/brackets/world-cup/WorldCupBracketSettingsPanel"))
      .default
    render(<WorldCupBracketSettingsPanel challengeId="ch1" />)

    await waitFor(() => {
      expect(screen.queryByTestId("world-cup-settings-loading")).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId("world-cup-settings-max-users"), { target: { value: "120" } })
    expect(screen.getByText(/Max users must be between 1 and 100/)).toBeInTheDocument()
  })

  it("shows Bracket Brain toggle for Pro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSettingsPayload({ hasAfPro: true }),
      })
    )
    const WorldCupBracketSettingsPanel = (await import("@/components/brackets/world-cup/WorldCupBracketSettingsPanel"))
      .default
    render(<WorldCupBracketSettingsPanel challengeId="ch1" />)

    await waitFor(() => {
      expect(screen.getByTestId("world-cup-settings-bracket-brain")).toBeInTheDocument()
    })
  })
})

describe("World Cup mobile polish — matchup card & guided picker", () => {
  const sampleMatch = {
    id: "m1",
    apiFixtureId: 1,
    round: "round_of_16" as const,
    roundIndex: 0,
    matchNumber: 1,
    homeSlotKey: "H1",
    awaySlotKey: "A1",
    homeTeamId: "t1",
    awayTeamId: "t2",
    homeTeamName: "Brazil",
    awayTeamName: "France",
    homeTeamLogo: null,
    awayTeamLogo: null,
    homeScore: null,
    awayScore: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    status: "scheduled" as const,
    startsAt: "2026-07-01T12:00:00.000Z",
    winnerTeamId: null,
    winnerTeamName: null,
    nextMatchId: null,
    nextMatchSlot: null,
    elapsedMinute: null,
    injuryTime: null,
    period: null,
    venueName: null,
    venueCity: null,
    apiStatusShort: null,
    lastScoreSyncedAt: null,
  }

  it("matchup card team buttons expose accessible pick labels", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    render(
      <WorldCupMatchupCard
        match={sampleMatch}
        onPick={() => {}}
      />
    )
    expect(screen.getByRole("button", { name: /Pick Brazil to win/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Pick France to win/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Pick Brazil to win/i })).toHaveAttribute("aria-pressed", "false")
  })

  it("matchup card hides a broken flag image behind the emoji fallback", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    render(
      <WorldCupMatchupCard
        match={{ ...sampleMatch, homeTeamLogo: "https://flagcdn.com/w80/br.png" }}
        onPick={() => {}}
      />
    )

    fireEvent.error(screen.getByAltText("Brazil flag"))

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /Brazil flag/i })).toHaveTextContent("🇧🇷")
    })
  })

  it("guided picker renders close control and team pick labels", async () => {
    const WorldCupGuidedMatchupPicker = (await import("@/components/brackets/world-cup/WorldCupGuidedMatchupPicker")).default
    const onSavePick = vi.fn().mockResolvedValue([])
    render(
      <WorldCupGuidedMatchupPicker
        challengeId="ch1"
        entryId="e1"
        entryName="Bracket 1"
        matches={[sampleMatch]}
        picks={[]}
        isOpen
        isLocked={false}
        includeThirdPlace={false}
        onClose={() => {}}
        onSavePick={onSavePick}
      />
    )
    expect(screen.getByTestId("world-cup-guided-close")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Pick Brazil to win/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Pick France to win/i })).toBeInTheDocument()
  })

  it("renders a valid flag URL with accessible alt text", async () => {
    const WorldCupTeamFlag = (await import("@/components/brackets/world-cup/WorldCupTeamFlag")).default
    render(<WorldCupTeamFlag flagUrl="https://flagcdn.com/w80/br.png" teamName="Brazil" />)

    const flag = screen.getByAltText("Brazil flag")
    expect(flag).toBeInTheDocument()
    expect(flag).toHaveAttribute("src", "https://flagcdn.com/w80/br.png")
  })

  it("falls back from a broken flag URL to an emoji flag", async () => {
    const WorldCupTeamFlag = (await import("@/components/brackets/world-cup/WorldCupTeamFlag")).default
    render(<WorldCupTeamFlag flagUrl="https://flagcdn.com/w80/br.png" teamName="Brazil" />)

    fireEvent.error(screen.getByAltText("Brazil flag"))

    await waitFor(() => expect(screen.queryByAltText("Brazil flag")).not.toBeInTheDocument())
    expect(screen.getByRole("img", { name: /Brazil flag/i })).toHaveTextContent("🇧🇷")
  })

  it("falls back to a country code badge when no flag URL is available", async () => {
    const WorldCupTeamFlag = (await import("@/components/brackets/world-cup/WorldCupTeamFlag")).default
    render(<WorldCupTeamFlag teamName="Brazil" countryCode="BRA" />)

    expect(screen.getByLabelText("Brazil country code BRA")).toHaveTextContent("BRA")
  })

  it("falls back to a globe when no flag data is available", async () => {
    const WorldCupTeamFlag = (await import("@/components/brackets/world-cup/WorldCupTeamFlag")).default
    render(<WorldCupTeamFlag teamName="Mystery Team" />)

    expect(screen.getByTestId("world-cup-team-flag-globe")).toHaveAccessibleName("Mystery Team flag unavailable")
  })

  it("guided picker team cards use the shared broken-image fallback", async () => {
    const WorldCupGuidedMatchupPicker = (await import("@/components/brackets/world-cup/WorldCupGuidedMatchupPicker")).default
    render(
      <WorldCupGuidedMatchupPicker
        challengeId="ch1"
        entryId="e1"
        entryName="Bracket 1"
        matches={[{ ...sampleMatch, homeTeamLogo: "https://flagcdn.com/w80/br.png" }]}
        picks={[]}
        isOpen
        isLocked={false}
        includeThirdPlace={false}
        onClose={() => {}}
        onSavePick={vi.fn().mockResolvedValue([])}
      />
    )

    const dialog = screen.getByRole("dialog", { name: /Guided Matchup Picker/i })
    fireEvent.error(within(dialog).getByAltText("Brazil flag"))

    await waitFor(() => {
      expect(within(dialog).getByRole("img", { name: /Brazil flag/i })).toHaveTextContent("🇧🇷")
    })
  })

  it("guided picker does not show not-ready when semifinal has projected Brazil vs USA", async () => {
    const WorldCupGuidedMatchupPicker = (await import("@/components/brackets/world-cup/WorldCupGuidedMatchupPicker")).default
    const sfMatch = {
      ...sampleMatch,
      id: "m29",
      round: "semifinal" as const,
      matchNumber: 29,
      homeTeamId: "team-bra",
      awayTeamId: "team-usa",
      homeTeamName: "Brazil",
      awayTeamName: "USA",
      homeSlotKey: "W-M27",
      awaySlotKey: "W-M28",
    }
    render(
      <WorldCupGuidedMatchupPicker
        challengeId="ch1"
        entryId="e1"
        entryName="Bracket 1"
        matches={[sfMatch]}
        picks={[]}
        isOpen
        initialMatchId="m29"
        isLocked={false}
        includeThirdPlace={false}
        onClose={() => {}}
        onSavePick={vi.fn().mockResolvedValue([])}
      />
    )

    expect(screen.queryByText(/This matchup is not ready for picks yet/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Pick Brazil to win/i })).not.toHaveAttribute("disabled")
    expect(screen.getByRole("button", { name: /Pick USA to win/i })).not.toHaveAttribute("disabled")
  })

  it("guided picker shows not-ready when feeder teams are still unresolved placeholders", async () => {
    const WorldCupGuidedMatchupPicker = (await import("@/components/brackets/world-cup/WorldCupGuidedMatchupPicker")).default
    const sfMatch = {
      ...sampleMatch,
      id: "m29",
      round: "semifinal" as const,
      matchNumber: 29,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamName: "Winner Match 27",
      awayTeamName: "Winner Match 28",
      homeSlotKey: "W-M27",
      awaySlotKey: "W-M28",
    }
    render(
      <WorldCupGuidedMatchupPicker
        challengeId="ch1"
        entryId="e1"
        entryName="Bracket 1"
        matches={[sfMatch]}
        picks={[]}
        isOpen
        initialMatchId="m29"
        isLocked={false}
        includeThirdPlace={false}
        onClose={() => {}}
        onSavePick={vi.fn().mockResolvedValue([])}
      />
    )

    expect(screen.getByText(/Fixtures Not Ready/i)).toBeInTheDocument()
    expect(screen.getByText(/M29:missing_home_team/)).toBeInTheDocument()
  })
})

function makeShellEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    challengeId: "c1",
    participantId: "participant-1",
    userId: "user-1",
    name: "Bracket 1",
    championTeamId: null,
    championTeamName: null,
    totalScore: 0,
    maxPossibleScore: 0,
    correctPicks: 0,
    incorrectPicks: 0,
    rank: null,
    roundBreakdown: {},
    isComplete: false,
    isLocked: false,
    submittedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function makeShellMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    apiFixtureId: null,
    round: "round_of_32" as const,
    roundIndex: 1,
    matchNumber: 1,
    homeSlotKey: "A1",
    awaySlotKey: "B2",
    homeTeamId: "demo_team_brazil",
    awayTeamId: "demo_team_argentina",
    homeTeamName: "Brazil",
    awayTeamName: "Argentina",
    homeTeamLogo: "https://flagcdn.com/w80/br.png",
    awayTeamLogo: "https://flagcdn.com/w80/ar.png",
    homeScore: null,
    awayScore: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    status: "scheduled" as const,
    startsAt: "2099-07-01T18:00:00.000Z",
    winnerTeamId: null,
    winnerTeamName: null,
    nextMatchId: null,
    nextMatchSlot: null,
    elapsedMinute: null,
    injuryTime: null,
    period: null,
    venueName: "MetLife Stadium",
    venueCity: "East Rutherford",
    apiStatusShort: "TEST",
    lastScoreSyncedAt: null,
    ...overrides,
  }
}

function makeShellSeededMatches() {
  return [
    makeShellMatch({
      id: "m1",
      matchNumber: 1,
      homeTeamId: "demo_team_brazil",
      awayTeamId: "demo_team_argentina",
      homeTeamName: "Brazil",
      awayTeamName: "Argentina",
      homeTeamLogo: "https://flagcdn.com/w80/br.png",
      awayTeamLogo: "https://flagcdn.com/w80/ar.png",
      homeSlotKey: "A1",
      awaySlotKey: "B2",
      nextMatchId: "m17",
      nextMatchSlot: "home",
    }),
    makeShellMatch({
      id: "m2",
      matchNumber: 2,
      homeTeamId: "demo_team_france",
      awayTeamId: "demo_team_germany",
      homeTeamName: "France",
      awayTeamName: "Germany",
      homeTeamLogo: "https://flagcdn.com/w80/fr.png",
      awayTeamLogo: "https://flagcdn.com/w80/de.png",
      homeSlotKey: "C1",
      awaySlotKey: "D2",
      nextMatchId: "m17",
      nextMatchSlot: "away",
    }),
    makeShellMatch({
      id: "m17",
      round: "round_of_16" as const,
      roundIndex: 1,
      matchNumber: 17,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamName: "Winner Match 1",
      awayTeamName: "Winner Match 2",
      homeTeamLogo: null,
      awayTeamLogo: null,
      homeSlotKey: "W-M1",
      awaySlotKey: "W-M2",
      nextMatchId: null,
      nextMatchSlot: null,
    }),
  ]
}

function makeShellView(overrides: Record<string, unknown> = {}) {
  const entry = makeShellEntry()
  return {
    challenge: {
      id: "c1",
      name: "Cup",
      ownerUserId: "user-1",
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
      isTestMode: true,
      simulationEnabled: false,
      simulatedAt: null,
      simulationStatus: null,
      hasSimulatedResults: false,
      lastSyncedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    scoring: {
      roundOf32Points: 10,
      roundOf16Points: 20,
      quarterFinalPoints: 40,
      semiFinalPoints: 80,
      finalPoints: 160,
      championBonusPoints: 320,
      thirdPlacePoints: 4,
    },
    slots: [],
    matches: [makeShellMatch()],
    participant: {
      id: "participant-1",
      userId: "user-1",
      displayName: "Owner",
      joinedAt: "2026-01-01T00:00:00.000Z",
      totalScore: 0,
      maxPossibleScore: 0,
      championPickTeamId: null,
      championPickName: null,
      correctPicks: 0,
      rank: null,
    },
    activeEntry: { id: entry.id, name: entry.name },
    entries: [{ id: entry.id, name: entry.name, createdAt: entry.createdAt, totalScore: 0, rank: null, isComplete: false }],
    picks: [],
    leaderboard: [],
    isOwner: true,
    isAdmin: false,
    hasBracketBrainAi: true,
    ...overrides,
  }
}

describe("WorldCupBracketShell fixture readiness", () => {
  beforeEach(() => {
    clientApiMocks.listEntries.mockReset()
    clientApiMocks.getEntry.mockReset()
    clientApiMocks.adminLoadTestFixtures.mockReset()
    clientApiMocks.clearPicks.mockReset()
    clientApiMocks.savePick.mockReset()
    clientApiMocks.listEntries.mockResolvedValue([makeShellEntry()])
    clientApiMocks.getEntry.mockResolvedValue({ ...makeShellEntry(), picks: [] })
    clientApiMocks.adminLoadTestFixtures.mockResolvedValue({
      ok: true,
      result: {
        success: true,
        teamsCreated: 32,
        teamsUpdated: 0,
        matchesUpdated: 16,
        pickableMatchesAfter: 16,
        totalMatchesAfter: 31,
        unresolvedMatchesAfter: 15,
        warnings: [],
      },
    })
    vi.stubGlobal("fetch", vi.fn())
  })

  it("shows Seed Test Fixtures CTA for commissioner/admin when fixtures are missing", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          matches: [],
          hasBracketBrainAi: true,
        }) as any}
      />
    )

    await waitFor(() => expect(clientApiMocks.listEntries).toHaveBeenCalled())
    expect(screen.getAllByRole("button", { name: /Seed Test Fixtures/i }).length).toBeGreaterThan(0)
  })

  it("shows seeded matchups, enables guided picker, and renders Bracket Brain panel", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} />)

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Start Making Picks/i })[0]).toBeEnabled())
    expect(screen.getByAltText("Brazil flag")).toBeInTheDocument()
    expect(screen.getAllByText("Brazil").length).toBeGreaterThan(0)
    expect(screen.queryByText("Fixtures Not Ready")).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: /Start Making Picks/i })[0])

    expect(await screen.findByTestId("world-cup-guided-close")).toBeInTheDocument()
    expect(screen.getByTestId("wc-intel-stub")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /Pick Brazil to win/i }).length).toBeGreaterThan(0)
  })

  it("keeps seeded matchups visible and advances guided picker after saving the first pick", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    const seededMatches = makeShellSeededMatches()
    const initialView = makeShellView({ matches: seededMatches })
    const savedPick = {
      id: "pick-m1",
      matchId: "m1",
      round: "round_of_32",
      selectedTeamId: "demo_team_brazil",
      selectedSlotKey: "A1",
      selectedTeamName: "Brazil",
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
    }

    clientApiMocks.savePick.mockResolvedValue({
      success: true,
      entry: makeShellEntry(),
      pick: savedPick,
      picks: [savedPick],
      isComplete: false,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          challenge: {
            id: "c1",
            name: "Cup",
          },
          entries: [{ id: "entry-1", name: "Bracket 1", createdAt: "2026-01-01T00:00:00.000Z", totalScore: 0, rank: null, isComplete: false }],
          picks: [savedPick],
          matches: [],
        }),
      })
    )

    render(<WorldCupBracketShell initialView={initialView as any} />)

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Start Making Picks/i })[0]).toBeEnabled())
    expect(screen.getByTestId("world-cup-match-m1")).toBeInTheDocument()
    expect(screen.getByTestId("world-cup-match-m2")).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: /Start Making Picks/i })[0])
    const dialog = await screen.findByRole("dialog", { name: /Guided Matchup Picker/i })
    fireEvent.click(within(dialog).getByRole("button", { name: /Pick Brazil to win/i }))

    await waitFor(() => expect(clientApiMocks.savePick).toHaveBeenCalledWith(
      "c1",
      "entry-1",
      expect.objectContaining({
        activeEntryId: "entry-1",
        matchId: "m1",
        selectedTeamId: "demo_team_brazil",
      })
    ))

    await waitFor(() => {
      expect(within(screen.getByTestId("world-cup-match-m1")).getByRole("button", { name: /Selected: Brazil to win/i })).toHaveAttribute("aria-pressed", "true")
    })
    expect(screen.getByTestId("world-cup-match-m2")).toBeInTheDocument()
    expect(within(screen.getByTestId("world-cup-match-m17")).getByText("Brazil")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId("world-cup-guided-footer-context")).toHaveTextContent(/Match 2/)
    })
    expect(within(screen.getByRole("dialog", { name: /Guided Matchup Picker/i })).getByRole("button", { name: /Pick France to win/i })).toBeInTheDocument()
  })

  it("opens projected Round of 16 matchups without simulated final state after Round of 32 picks", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    const seededMatches = makeShellSeededMatches().map((match) =>
      match.id === "m17"
        ? {
            ...match,
            status: "final",
            apiStatusShort: "SIM",
            homeScore: 2,
            awayScore: 0,
            winnerTeamName: "Best 3rd Place Team 1",
          }
        : match
    )
    const savedPicks = [
      {
        id: "pick-m1",
        matchId: "m1",
        round: "round_of_32",
        selectedTeamId: "demo_team_brazil",
        selectedSlotKey: "A1",
        selectedTeamName: "Brazil",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      },
      {
        id: "pick-m2",
        matchId: "m2",
        round: "round_of_32",
        selectedTeamId: "demo_team_germany",
        selectedSlotKey: "D2",
        selectedTeamName: "Germany",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      },
    ]

    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          matches: seededMatches,
          picks: savedPicks,
        }) as any}
      />
    )

    await waitFor(() => expect(screen.getByTestId("world-cup-match-m17")).toBeInTheDocument())
    const projectedRoundOf16 = screen.getByTestId("world-cup-match-m17")

    expect(within(projectedRoundOf16).getByText("Brazil")).toBeInTheDocument()
    expect(within(projectedRoundOf16).getByText("Germany")).toBeInTheDocument()
    expect(within(projectedRoundOf16).queryByText(/^Final$/)).toBeNull()
    expect(within(projectedRoundOf16).queryByText(/^Simulated$/)).toBeNull()
    expect(within(projectedRoundOf16).queryByText(/^FT$/)).toBeNull()
    expect(within(projectedRoundOf16).queryByTestId("wc-match-official-winner-m17")).toBeNull()

    fireEvent.click(within(projectedRoundOf16).getByRole("button", { name: /Open guided picker for match 17/i }))

    const dialog = await screen.findByRole("dialog", { name: /Guided Matchup Picker/i })
    expect(within(dialog).getByRole("button", { name: /Pick Brazil to win/i })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: /Pick Germany to win/i })).toBeEnabled()
  })

  it("saves a projected Round of 16 pick, keeps it highlighted, and advances it to the quarterfinal", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    const roundOf32Picks = [
      {
        id: "pick-m1",
        matchId: "m1",
        matchNumber: 1,
        round: "round_of_32",
        selectedTeamId: "demo_team_brazil",
        selectedSlotKey: "A1",
        selectedTeamName: "Brazil",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      },
      {
        id: "pick-m2",
        matchId: "m2",
        matchNumber: 2,
        round: "round_of_32",
        selectedTeamId: "demo_team_germany",
        selectedSlotKey: "D2",
        selectedTeamName: "Germany",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      },
    ]
    const savedRoundOf16Pick = {
      id: "pick-m17",
      matchId: "m17",
      matchNumber: 17,
      round: "round_of_16",
      selectedTeamId: "demo_team_brazil",
      selectedSlotKey: "A1",
      selectedTeamName: "Brazil",
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
    }
    const seededMatches = [
      ...makeShellSeededMatches().map((match) =>
        match.id === "m17"
          ? {
              ...match,
              nextMatchId: "m25",
              nextMatchSlot: "home",
              status: "final",
              apiStatusShort: "SIM",
              winnerTeamName: "Winner Match 1",
            }
          : match
      ),
      makeShellMatch({
        id: "m25",
        round: "quarterfinal" as const,
        roundIndex: 1,
        matchNumber: 25,
        homeSlotKey: "W-M17",
        awaySlotKey: "W-M18",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 17",
        awayTeamName: "Winner Match 18",
        homeTeamLogo: null,
        awayTeamLogo: null,
        status: "final",
        apiStatusShort: "SIM",
        homeScore: 1,
        awayScore: 0,
        winnerTeamName: "Winner Match 17",
      }),
    ]
    const returnedPicks = [...roundOf32Picks, savedRoundOf16Pick]

    clientApiMocks.clearPicks.mockResolvedValue([])
    clientApiMocks.savePick.mockResolvedValue({
      success: true,
      entry: makeShellEntry({ isComplete: false }),
      pick: savedRoundOf16Pick,
      picks: returnedPicks,
      isComplete: false,
      view: makeShellView({ matches: seededMatches, picks: returnedPicks }),
    })

    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          matches: seededMatches,
          picks: roundOf32Picks,
        }) as any}
      />
    )

    const projectedRoundOf16 = await screen.findByTestId("world-cup-match-m17")
    fireEvent.click(within(projectedRoundOf16).getByRole("button", { name: /Open guided picker for match 17/i }))
    const dialog = await screen.findByRole("dialog", { name: /Guided Matchup Picker/i })
    fireEvent.click(within(dialog).getByRole("button", { name: /Pick Brazil to win/i }))

    await waitFor(() => expect(clientApiMocks.savePick).toHaveBeenCalledWith(
      "c1",
      "entry-1",
      expect.objectContaining({
        activeEntryId: "entry-1",
        matchId: "m17",
        round: "round_of_16",
        matchNumber: 17,
        selectedTeamId: "demo_team_brazil",
        selectedTeamName: "Brazil",
        selectedSlotKey: "W-M1",
        selectedSide: "home",
        sourceSlotKey: "W-M1",
        nextMatchId: "m25",
        nextMatchSlot: "home",
      })
    ))
    expect(clientApiMocks.clearPicks).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(within(screen.getByTestId("world-cup-match-m17")).getByRole("button", { name: /Selected: Brazil to win/i })).toHaveAttribute("aria-pressed", "true")
    })
    expect(within(screen.getByTestId("world-cup-match-m25")).getByText("Brazil")).toBeInTheDocument()
  })

  it("saves projected semifinal and final picks without simulated final UI", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    const matches = [
      makeShellMatch({
        id: "m25",
        round: "quarterfinal" as const,
        roundIndex: 1,
        matchNumber: 25,
        homeTeamId: "demo_team_brazil",
        awayTeamId: "demo_team_argentina",
        homeTeamName: "Brazil",
        awayTeamName: "Argentina",
        homeSlotKey: "W-M17",
        awaySlotKey: "W-M18",
        nextMatchId: "m29",
        nextMatchSlot: "home",
      }),
      makeShellMatch({
        id: "m26",
        round: "quarterfinal" as const,
        roundIndex: 2,
        matchNumber: 26,
        homeTeamId: "demo_team_usa",
        awayTeamId: "demo_team_mexico",
        homeTeamName: "USA",
        awayTeamName: "Mexico",
        homeSlotKey: "W-M19",
        awaySlotKey: "W-M20",
        nextMatchId: "m29",
        nextMatchSlot: "away",
      }),
      makeShellMatch({
        id: "m27",
        round: "quarterfinal" as const,
        roundIndex: 3,
        matchNumber: 27,
        homeTeamId: "demo_team_croatia",
        awayTeamId: "demo_team_germany",
        homeTeamName: "Croatia",
        awayTeamName: "Germany",
        homeSlotKey: "W-M21",
        awaySlotKey: "W-M22",
        nextMatchId: "m30",
        nextMatchSlot: "home",
      }),
      makeShellMatch({
        id: "m28",
        round: "quarterfinal" as const,
        roundIndex: 4,
        matchNumber: 28,
        homeTeamId: "demo_team_australia",
        awayTeamId: "demo_team_france",
        homeTeamName: "Australia",
        awayTeamName: "France",
        homeSlotKey: "W-M23",
        awaySlotKey: "W-M24",
        nextMatchId: "m30",
        nextMatchSlot: "away",
      }),
      makeShellMatch({
        id: "m29",
        round: "semifinal" as const,
        roundIndex: 1,
        matchNumber: 29,
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 25",
        awayTeamName: "Winner Match 26",
        homeSlotKey: "W-M25",
        awaySlotKey: "W-M26",
        nextMatchId: "m31",
        nextMatchSlot: "home",
        status: "final",
        apiStatusShort: "SIM",
        startsAt: "2020-01-01T00:00:00.000Z",
        homeScore: 3,
        awayScore: 1,
        winnerTeamName: "Best 3rd Place Team 1",
      }),
      makeShellMatch({
        id: "m30",
        round: "semifinal" as const,
        roundIndex: 2,
        matchNumber: 30,
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Match 27",
        awayTeamName: "Winner Match 28",
        homeSlotKey: "W-M27",
        awaySlotKey: "W-M28",
        nextMatchId: "m31",
        nextMatchSlot: "away",
        status: "final",
        apiStatusShort: "SIM",
        startsAt: "2020-01-01T00:00:00.000Z",
      }),
      makeShellMatch({
        id: "m31",
        round: "final" as const,
        roundIndex: 1,
        matchNumber: 31,
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "Winner Semifinal 1",
        awayTeamName: "Winner Semifinal 2",
        homeSlotKey: "W-M29",
        awaySlotKey: "W-M30",
        status: "final",
        apiStatusShort: "SIM",
        startsAt: "2020-01-01T00:00:00.000Z",
        homeScore: 3,
        awayScore: 1,
        winnerTeamName: "Best 3rd Place Team 1",
      }),
    ]
    const basePicks = [
      { id: "pick-m25", matchId: "m25", matchNumber: 25, round: "quarterfinal", selectedTeamId: "demo_team_brazil", selectedSlotKey: "W-M17", selectedTeamName: "Brazil", pointsAwarded: 0, isCorrect: null, lockedAt: null },
      { id: "pick-m26", matchId: "m26", matchNumber: 26, round: "quarterfinal", selectedTeamId: "demo_team_usa", selectedSlotKey: "W-M19", selectedTeamName: "USA", pointsAwarded: 0, isCorrect: null, lockedAt: null },
      { id: "pick-m27", matchId: "m27", matchNumber: 27, round: "quarterfinal", selectedTeamId: "demo_team_croatia", selectedSlotKey: "W-M21", selectedTeamName: "Croatia", pointsAwarded: 0, isCorrect: null, lockedAt: null },
      { id: "pick-m28", matchId: "m28", matchNumber: 28, round: "quarterfinal", selectedTeamId: "demo_team_australia", selectedSlotKey: "W-M23", selectedTeamName: "Australia", pointsAwarded: 0, isCorrect: null, lockedAt: null },
      { id: "pick-m30", matchId: "m30", matchNumber: 30, round: "semifinal", selectedTeamId: "demo_team_croatia", selectedSlotKey: "W-M21", selectedTeamName: "Croatia", pointsAwarded: 0, isCorrect: null, lockedAt: null },
    ]
    const semifinalPick = { id: "pick-m29", matchId: "m29", matchNumber: 29, round: "semifinal", selectedTeamId: "demo_team_brazil", selectedSlotKey: "W-M17", selectedTeamName: "Brazil", pointsAwarded: 0, isCorrect: null, lockedAt: null }
    const finalPick = { id: "pick-m31", matchId: "m31", matchNumber: 31, round: "final", selectedTeamId: "demo_team_brazil", selectedSlotKey: "W-M17", selectedTeamName: "Brazil", pointsAwarded: 0, isCorrect: null, lockedAt: null }
    const picksAfterSemifinal = [...basePicks, semifinalPick]
    const picksAfterFinal = [...picksAfterSemifinal, finalPick]
    const makeView = (picks: typeof basePicks) => {
      const view = makeShellView({ matches, picks }) as any
      view.challenge.pickLockStrategy = "per_match"
      view.challenge.pickLockAt = null
      view.challenge.effectivePickLockAt = null
      return view
    }

    clientApiMocks.clearPicks.mockResolvedValue([])
    clientApiMocks.savePick
      .mockResolvedValueOnce({
        success: true,
        entry: makeShellEntry({ isComplete: false }),
        pick: semifinalPick,
        picks: picksAfterSemifinal,
        isComplete: false,
        view: makeView(picksAfterSemifinal),
      })
      .mockResolvedValueOnce({
        success: true,
        entry: makeShellEntry({ isComplete: true, championTeamId: "demo_team_brazil", championTeamName: "Brazil" }),
        pick: finalPick,
        picks: picksAfterFinal,
        isComplete: true,
        view: makeView(picksAfterFinal),
      })

    render(<WorldCupBracketShell initialView={makeView(basePicks)} />)

    const semifinal = await screen.findByTestId("world-cup-match-m29")
    expect(within(semifinal).getByText("Brazil")).toBeInTheDocument()
    expect(within(semifinal).getByText("USA")).toBeInTheDocument()
    expect(within(semifinal).queryByText(/^Final$/)).toBeNull()
    expect(within(semifinal).queryByText(/^Simulated$/)).toBeNull()
    expect(screen.queryByText(/Bracket Locked/i)).toBeNull()
    fireEvent.click(within(semifinal).getByRole("button", { name: /Open guided picker for match 29/i }))

    const dialog = await screen.findByRole("dialog", { name: /Guided Matchup Picker/i })
    expect(within(dialog).getByRole("button", { name: /Pick Brazil to win/i })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole("button", { name: /Pick Brazil to win/i }))

    await waitFor(() => expect(clientApiMocks.savePick).toHaveBeenCalledWith(
      "c1",
      "entry-1",
      expect.objectContaining({
        matchId: "m29",
        round: "semifinal",
        matchNumber: 29,
        selectedTeamId: "demo_team_brazil",
        nextMatchId: "m31",
      })
    ))
    await waitFor(() => {
      expect(within(screen.getByTestId("world-cup-match-m29")).getByRole("button", { name: /Selected: Brazil to win/i })).toHaveAttribute("aria-pressed", "true")
    })

    const final = screen.getByTestId("world-cup-match-m31")
    expect(within(final).getByText("Brazil")).toBeInTheDocument()
    expect(within(final).getByText("Croatia")).toBeInTheDocument()
    expect(within(final).queryByText(/^Final$/)).toBeNull()
    expect(within(final).queryByText(/^Simulated$/)).toBeNull()
    expect(within(final).queryByText(/^FT$/)).toBeNull()
    expect(within(final).queryByTestId("wc-match-official-winner-m31")).toBeNull()

    await waitFor(() => {
      expect(screen.getByTestId("world-cup-guided-footer-context")).toHaveTextContent(/Match 31/)
    })
    expect(within(screen.getByRole("dialog", { name: /Guided Matchup Picker/i })).getByRole("button", { name: /Pick Brazil to win/i })).toBeEnabled()
    fireEvent.click(within(screen.getByRole("dialog", { name: /Guided Matchup Picker/i })).getByRole("button", { name: /Pick Brazil to win/i }))

    await waitFor(() => expect(clientApiMocks.savePick).toHaveBeenLastCalledWith(
      "c1",
      "entry-1",
      expect.objectContaining({
        matchId: "m31",
        round: "final",
        matchNumber: 31,
        selectedTeamId: "demo_team_brazil",
      })
    ))
    await waitFor(() => {
      expect(within(screen.getByTestId("world-cup-match-m31")).getByRole("button", { name: /Selected: Brazil to win/i })).toHaveAttribute("aria-pressed", "true")
    })
    expect(screen.getAllByText("Brazil").length).toBeGreaterThan(0)
  })

  it("keeps semifinal/final picks after reload and shows complete pick count", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    const matches = [
      makeShellMatch({
        id: "m29",
        round: "semifinal" as const,
        roundIndex: 1,
        matchNumber: 29,
        homeTeamId: "demo_team_brazil",
        awayTeamId: "demo_team_usa",
        homeTeamName: "Brazil",
        awayTeamName: "USA",
        homeSlotKey: "W-M25",
        awaySlotKey: "W-M26",
        nextMatchId: "m31",
        nextMatchSlot: "home",
      }),
      makeShellMatch({
        id: "m30",
        round: "semifinal" as const,
        roundIndex: 2,
        matchNumber: 30,
        homeTeamId: "demo_team_croatia",
        awayTeamId: "demo_team_australia",
        homeTeamName: "Croatia",
        awayTeamName: "Australia",
        homeSlotKey: "W-M27",
        awaySlotKey: "W-M28",
        nextMatchId: "m31",
        nextMatchSlot: "away",
      }),
      makeShellMatch({
        id: "m31",
        round: "final" as const,
        roundIndex: 1,
        matchNumber: 31,
        homeTeamId: "demo_team_brazil",
        awayTeamId: "demo_team_croatia",
        homeTeamName: "Brazil",
        awayTeamName: "Croatia",
        homeSlotKey: "W-M29",
        awaySlotKey: "W-M30",
      }),
    ]
    const picks = [
      {
        id: "pick-m29",
        matchId: "m29",
        matchNumber: 29,
        round: "semifinal",
        selectedTeamId: "demo_team_brazil",
        selectedSlotKey: "W-M25",
        selectedTeamName: "Brazil",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      },
      {
        id: "pick-m30",
        matchId: "m30",
        matchNumber: 30,
        round: "semifinal",
        selectedTeamId: "demo_team_croatia",
        selectedSlotKey: "W-M27",
        selectedTeamName: "Croatia",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      },
      {
        id: "pick-m31",
        matchId: "m31",
        matchNumber: 31,
        round: "final",
        selectedTeamId: "demo_team_brazil",
        selectedSlotKey: "W-M29",
        selectedTeamName: "Brazil",
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      },
    ]

    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          matches,
          picks,
        }) as any}
      />
    )

    await waitFor(() => expect(screen.getByTestId("world-cup-match-m29")).toBeInTheDocument())
    expect(within(screen.getByTestId("world-cup-match-m29")).getByRole("button", { name: /Selected: Brazil to win/i })).toHaveAttribute("aria-pressed", "true")
    expect(within(screen.getByTestId("world-cup-match-m30")).getByRole("button", { name: /Selected: Croatia to win/i })).toHaveAttribute("aria-pressed", "true")
    expect(within(screen.getByTestId("world-cup-match-m31")).getByRole("button", { name: /Selected: Brazil to win/i })).toHaveAttribute("aria-pressed", "true")

    expect(screen.getByText(/3 of 3 picks/i)).toBeInTheDocument()
  })

  it("keeps the selected entry active after save refresh returns a different activeEntry", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    const entry1 = makeShellEntry({ id: "entry-1", name: "Bracket 1" })
    const entry2 = makeShellEntry({ id: "entry-2", name: "Bracket 2" })
    const savedPick = {
      id: "pick-entry-2-m1",
      matchId: "m1",
      round: "round_of_32",
      selectedTeamId: "demo_team_brazil",
      selectedSlotKey: "A1",
      selectedTeamName: "Brazil",
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
    }

    clientApiMocks.listEntries.mockResolvedValue([entry1, entry2])
    clientApiMocks.getEntry.mockResolvedValue({ ...entry2, picks: [] })
    clientApiMocks.savePick.mockResolvedValue({
      success: true,
      entry: entry2,
      pick: savedPick,
      picks: [savedPick],
      isComplete: false,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...makeShellView({
            matches: [],
            activeEntry: { id: "entry-1", name: "Bracket 1" },
            entries: [
              { id: "entry-1", name: "Bracket 1", createdAt: entry1.createdAt, totalScore: 0, rank: null, isComplete: false },
              { id: "entry-2", name: "Bracket 2", createdAt: entry2.createdAt, totalScore: 0, rank: null, isComplete: false },
            ],
          }),
          picks: [],
        }),
      })
    )

    render(
      <WorldCupBracketShell
        initialEntryId="entry-2"
        initialView={makeShellView({
          matches: makeShellSeededMatches(),
          activeEntry: { id: "entry-2", name: "Bracket 2" },
          entries: [
            { id: "entry-1", name: "Bracket 1", createdAt: entry1.createdAt, totalScore: 0, rank: null, isComplete: false },
            { id: "entry-2", name: "Bracket 2", createdAt: entry2.createdAt, totalScore: 0, rank: null, isComplete: false },
          ],
        }) as any}
      />
    )

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Start Making Picks/i })[0]).toBeEnabled())
    fireEvent.click(screen.getAllByRole("button", { name: /Start Making Picks/i })[0])
    const dialog = await screen.findByRole("dialog", { name: /Guided Matchup Picker/i })
    expect(within(dialog).getByText("Bracket 2")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: /Pick Brazil to win/i }))

    await waitFor(() => expect(clientApiMocks.savePick).toHaveBeenCalledWith(
      "c1",
      "entry-2",
      expect.objectContaining({
        activeEntryId: "entry-2",
        matchId: "m1",
      })
    ))
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: /Guided Matchup Picker/i })).getByText("Bracket 2")).toBeInTheDocument())
    expect(within(screen.getByTestId("world-cup-match-m1")).getByRole("button", { name: /Selected: Brazil to win/i })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("WorldCupLeaderboard mobile score row", () => {
  it("renders mobile score strip with totals", async () => {
    const WorldCupLeaderboard = (await import("@/components/brackets/world-cup/WorldCupLeaderboard")).default
    const view = {
      challenge: {
        id: "c1",
        name: "Cup",
        ownerUserId: "o1",
        seasonYear: 2026,
        inviteCode: "X",
        inviteUrl: null,
        visibility: "public" as const,
        pickLockStrategy: "tournament_start" as const,
        pickLockAt: null,
        maxParticipants: 100,
        maxEntriesPerParticipant: 5,
        effectivePickLockAt: null,
        status: "open",
        includeThirdPlace: false,
        isTestMode: false,
        simulationEnabled: false,
        simulatedAt: null,
        simulationStatus: null,
        hasSimulatedResults: false,
        lastSyncedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      scoring: {
        roundOf32Points: 10,
        roundOf16Points: 20,
        quarterFinalPoints: 40,
        semiFinalPoints: 80,
        finalPoints: 160,
        championBonusPoints: 320,
        thirdPlacePoints: 4,
      },
      slots: [],
      matches: [],
      participant: null,
      activeEntry: null,
      entries: [],
      picks: [],
      leaderboard: [
        {
          rank: 1,
          entryId: "ent1",
          entryName: "My bracket",
          participantId: "p1",
          userId: "u1",
          username: "u",
          avatarUrl: null,
          displayName: "Alex",
          totalScore: 42,
          maxPossibleScore: 400,
          correctPicks: 3,
          incorrectPicks: 1,
          championPickName: "Brazil",
          championTeamId: "t1",
          championStillAlive: true,
          roundBreakdown: {},
          joinedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      isOwner: false,
      isAdmin: false,
      hasBracketBrainAi: false,
    }
    render(<WorldCupLeaderboard view={view as any} />)
    expect(screen.getByTestId("wc-lb-mobile-score-row")).toBeInTheDocument()
    expect(screen.getByTestId("wc-lb-total-mobile-ent1")).toHaveTextContent("42")
    expect(screen.getByTestId("wc-lb-champion-status-ent1")).toHaveTextContent("Alive")
  })
})
