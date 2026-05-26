import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"

const clientApiMocks = vi.hoisted(() => ({
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  fetchCompletionReview: vi.fn(),
  finalizeEntry: vi.fn(),
  fetchGroupStageView: vi.fn(),
  saveGroupRanking: vi.fn(),
  saveThirdPlaceAdvancers: vi.fn(),
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

const routerMocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
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

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}))

vi.mock("@/components/brackets/world-cup/WorldCupMatchupIntelligencePanel", () => ({
  default: () => <div data-testid="wc-intel-stub" />,
}))

vi.mock("@/components/brackets/world-cup/WorldCupGroupStagePicks", () => ({
  default: ({
    entryId,
    aiInsightsUnlocked,
    onCompletionChanged,
    onDirtyChange,
  }: {
    entryId: string
    aiInsightsUnlocked?: boolean
    onCompletionChanged?: () => void
    onDirtyChange?: (dirty: boolean) => void
  }) => (
    <div data-testid="world-cup-group-stage-picks">
      Group stage {entryId}
      <span data-testid="group-stage-ai-prop">{aiInsightsUnlocked ? "ai-unlocked" : "ai-locked"}</span>
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        Mark Group Dirty Stub
      </button>
      <button type="button" onClick={() => onCompletionChanged?.()}>
        Save Group Stub
      </button>
    </div>
  ),
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
  fetchWorldCupEntryCompletionReview: clientApiMocks.fetchCompletionReview,
  fetchWorldCupGroupStageView: clientApiMocks.fetchGroupStageView,
  finalizeWorldCupEntryClient: clientApiMocks.finalizeEntry,
  getWorldCupIntegrityReport: clientApiMocks.getIntegrityReport,
  getWorldCupBracketEntry: clientApiMocks.getEntry,
  getEntryStatus: (entry: { isLocked?: boolean; isComplete?: boolean; correctPicks?: number; totalScore?: number }) =>
    entry.isLocked ? "locked" : entry.isComplete ? "complete" : (entry.correctPicks ?? 0) > 0 || (entry.totalScore ?? 0) > 0 ? "in_progress" : "not_started",
  listWorldCupBracketEntries: clientApiMocks.listEntries,
  renameWorldCupBracketEntry: clientApiMocks.renameEntry,
  saveWorldCupGroupRankingClient: clientApiMocks.saveGroupRanking,
  saveWorldCupBracketEntryPick: clientApiMocks.savePick,
  saveWorldCupThirdPlaceAdvancersClient: clientApiMocks.saveThirdPlaceAdvancers,
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
      knockoutMode: "predictive",
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

  it("lets AI commissioners generate, preview, and post a finalized-only recap", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return {
          ok: true,
          json: async () => ({
            snapshot: {
              incompleteBracketCount: 0,
              completedBracketCount: 2,
              totalEntries: 2,
              totalMissingPicks: 0,
              maxEntriesPerParticipant: 1,
              lockCountdownMs: null,
              effectiveLockAt: null,
              isLocked: false,
              mostPopularChampion: { teamName: "Argentina", count: 1 },
              mostUniqueLean: null,
              usersMaxedEntries: 0,
              biggestUpsetLean: null,
              usersWithIncompleteBrackets: [],
              entriesMissingPicks: [],
            },
            settings: {
              enableSystemEvents: true,
              enableAiSummaries: true,
              enableUpsetAlerts: true,
              enableLeaderboardAlerts: true,
              enableChampionBustAlerts: true,
              enableLockReminders: true,
            },
            hasBracketBrainAi: true,
            bracketBrainEnabled: true,
          }),
        } as Response
      }
      const body = JSON.parse(String(init.body))
      if (body.action === "preview_recap") {
        return {
          ok: true,
          json: async () => ({
            lines: [
              "Chimmy pool recap: Office Cup",
              "Current leader: Finalized Entry with 20 points.",
              "Finalized entries included: 1.",
              "Prediction and scoring complexity only.",
            ],
            posted: false,
          }),
        } as Response
      }
      if (body.action === "hype") {
        return {
          ok: true,
          json: async () => ({
            lines: ["Hype line one", "Hype line two"],
            posted: true,
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ lines: body.lines, posted: true }),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupCommissionerBrainPanel = (await import("@/components/brackets/world-cup/WorldCupCommissionerBrainPanel")).default
    render(<WorldCupCommissionerBrainPanel challengeId="c1" />)

    const panel = await screen.findByTestId("world-cup-ai-recap-panel")
    fireEvent.change(within(panel).getByLabelText(/Tone/i), { target: { value: "serious" } })
    fireEvent.click(within(panel).getByRole("button", { name: /Generate AI Recap/i }))

    const preview = await screen.findByTestId("world-cup-ai-recap-preview")
    expect(preview).toHaveTextContent("Finalized entries included: 1")
    expect(preview.textContent?.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager/)

    fireEvent.click(within(panel).getByRole("button", { name: /Post to Pool Chat/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/brackets/world-cup/c1/commissioner-brain",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("post_recap"),
      })
    ))

    fireEvent.click(screen.getByRole("button", { name: /Generate Hype/i }))
    const brainResult = await screen.findByTestId("world-cup-brain-action-result")
    expect(brainResult).toHaveTextContent("Posted to pool chat")
    expect(brainResult).toHaveTextContent("Hype line one")
    expect(brainResult).toHaveTextContent("Hype line two")
  })

  it("shows locked recap CTA for non-AI commissioners and does not generate", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        snapshot: {
          incompleteBracketCount: 0,
          completedBracketCount: 0,
          totalEntries: 0,
          totalMissingPicks: 0,
          maxEntriesPerParticipant: 1,
          lockCountdownMs: null,
          effectiveLockAt: null,
          isLocked: false,
          mostPopularChampion: null,
          mostUniqueLean: null,
          usersMaxedEntries: 0,
          biggestUpsetLean: null,
          usersWithIncompleteBrackets: [],
          entriesMissingPicks: [],
        },
        settings: {
          enableSystemEvents: true,
          enableAiSummaries: false,
          enableUpsetAlerts: true,
          enableLeaderboardAlerts: true,
          enableChampionBustAlerts: true,
          enableLockReminders: true,
        },
        hasBracketBrainAi: false,
        bracketBrainEnabled: true,
      }),
    } as Response))
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupCommissionerBrainPanel = (await import("@/components/brackets/world-cup/WorldCupCommissionerBrainPanel")).default
    render(<WorldCupCommissionerBrainPanel challengeId="c1" />)

    const panel = await screen.findByTestId("world-cup-ai-recap-panel")
    expect(within(panel).getByText("Locked")).toBeInTheDocument()
    expect(within(panel).getByText(/Locked users cannot generate or post AI recaps/i)).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: /Generate AI Recap/i })).toBeDisabled()
    const callsBeforeClick = fetchMock.mock.calls.length
    fireEvent.click(within(panel).getByRole("button", { name: /Generate AI Recap/i }))
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeClick)
  })

  it("exits commissioner brain loading when the API returns an error", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Commissioner snapshot unavailable" }),
    } as Response))
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupCommissionerBrainPanel = (await import("@/components/brackets/world-cup/WorldCupCommissionerBrainPanel")).default
    render(<WorldCupCommissionerBrainPanel challengeId="c1" />)

    expect(await screen.findByText("Commissioner tools could not load.")).toBeInTheDocument()
    expect(screen.getByText("Commissioner snapshot unavailable")).toBeInTheDocument()
    expect(screen.queryByText("Loading commissioner tools…")).not.toBeInTheDocument()
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
    expect(screen.getByTestId("world-cup-settings-knockout-mode")).toHaveValue("predictive")
  })

  it("lets commissioners select reseeded knockout mode in settings", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSettingsPayload(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          settings: mockSettingsPayload({
            leagueSettings: {
              scoringStyle: "standard",
              tiebreakerFinalScore: false,
              allowLateJoin: false,
              showPublicPicks: "after_lock",
              knockoutMode: "reseeded",
              bracketBrainEnabled: true,
              inviteGateConfigured: false,
            },
          }),
          hasAfPro: false,
          isAdmin: false,
          earlyPublicPicksAllowed: false,
        }),
      })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketSettingsPanel = (await import("@/components/brackets/world-cup/WorldCupBracketSettingsPanel"))
      .default
    render(<WorldCupBracketSettingsPanel challengeId="ch1" />)

    await waitFor(() => {
      expect(screen.queryByTestId("world-cup-settings-loading")).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId("world-cup-settings-knockout-mode"), { target: { value: "reseeded" } })
    fireEvent.click(screen.getByTestId("world-cup-settings-save"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({ knockoutMode: "reseeded" })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockSettingsPayload({
        leagueSettings: {
          scoringStyle: "standard",
          tiebreakerFinalScore: false,
          allowLateJoin: false,
          showPublicPicks: "after_lock",
          knockoutMode: "reseeded",
          bracketBrainEnabled: true,
          inviteGateConfigured: false,
        },
      }),
    })
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/dfs|betting|wager/)
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

  it("matchup card uses AF cyan result border for correct saved picks", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    render(
      <WorldCupMatchupCard
        match={{
          ...sampleMatch,
          status: "final",
          winnerTeamId: "t1",
          winnerTeamName: "Brazil",
          homeScore: 2,
          awayScore: 1,
        }}
        pick={{
          id: "pick-1",
          matchId: "m1",
          round: "round_of_32",
          selectedTeamId: "t1",
          selectedSlotKey: "H1",
          selectedTeamName: "Brazil",
          pointsAwarded: 10,
          isCorrect: true,
          lockedAt: null,
        }}
      />
    )

    expect(screen.getByTestId("world-cup-match-m1")).toHaveClass("border-cyan-300/80")
    expect(screen.getByTestId("wc-match-pick-visual")).toHaveAttribute("data-state", "correct")
  })

  it("uses real team names in unlocked AI matchup insights", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    render(
      <WorldCupMatchupCard
        match={sampleMatch}
        locked={false}
        aiInsightsUnlocked
        onPick={() => {}}
      />
    )

    fireEvent.click(screen.getByText("AI Insights"))
    expect(screen.getByText(/Safer pick:/i).parentElement).toHaveTextContent("Brazil based on current bracket slot order.")
    expect(screen.getByText(/Upside pick:/i).parentElement).toHaveTextContent("France if you need a differentiated path.")
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
      knockoutMode: "predictive" as const,
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

function makeShellGroupStageView(overrides: Record<string, unknown> = {}) {
  return {
    challengeId: "c1",
    entryId: "entry-1",
    groups: [{
      id: "group-a",
      groupKey: "A",
      displayName: "Group A",
      sortOrder: 1,
      teams: [
        { id: "gt-1", teamId: "team-a", name: "Argentina", country: "Argentina", fifaCode: "ARG", flagUrl: null, logoUrl: null, seedOrder: 1, actualRank: 1, points: 9, goalDifference: 4, goalsFor: 7 },
        { id: "gt-2", teamId: "team-b", name: "Brazil", country: "Brazil", fifaCode: "BRA", flagUrl: null, logoUrl: null, seedOrder: 2, actualRank: 3, points: 4, goalDifference: 0, goalsFor: 4 },
        { id: "gt-3", teamId: "team-c", name: "Canada", country: "Canada", fifaCode: "CAN", flagUrl: null, logoUrl: null, seedOrder: 3, actualRank: null, points: null, goalDifference: null, goalsFor: null },
        { id: "gt-4", teamId: "team-d", name: "Denmark", country: "Denmark", fifaCode: "DEN", flagUrl: null, logoUrl: null, seedOrder: 4, actualRank: 4, points: 1, goalDifference: -4, goalsFor: 2 },
      ],
    }],
    groupRankingPicks: [
      { id: "grp-1", groupId: "group-a", teamId: "team-a", predictedRank: 1, actualRank: 1, isCorrect: true, pointsAwarded: 5 },
      { id: "grp-2", groupId: "group-a", teamId: "team-b", predictedRank: 2, actualRank: 3, isCorrect: false, pointsAwarded: 0 },
      { id: "grp-3", groupId: "group-a", teamId: "team-c", predictedRank: 3, actualRank: null, isCorrect: null, pointsAwarded: 0 },
      { id: "grp-4", groupId: "group-a", teamId: "team-d", predictedRank: 4, actualRank: 4, isCorrect: true, pointsAwarded: 5 },
    ],
    thirdPlaceAdvancerPicks: [
      { id: "tp-1", groupId: "group-a", teamId: "team-c", isSelected: true, actualAdvanced: null, isCorrect: null, pointsAwarded: 0 },
    ],
    completion: {
      groupsRankedCount: 1,
      allGroupsRanked: false,
      thirdPlaceSelectedCount: 1,
      thirdPlaceComplete: false,
      groupStageComplete: false,
    },
    lock: { isLocked: false, lockReason: null },
    warnings: [],
    ...overrides,
  }
}

function makeReadinessResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    checkedAt: "2026-05-17T00:00:00.000Z",
    readiness: {
      provider: {
        name: "apifootball",
        configured: true,
        apiKeyPresent: true,
        leagueId: "1",
        leagueIdConfigured: true,
        cronSecretPresent: true,
        missingEnvVars: [],
      },
      challenge: {
        bracketTeamsSeeded: 48,
      },
      origins: {
        productionSafe: true,
        values: {
          nextAuthUrl: "https://www.allfantasy.ai",
          nextPublicAppUrl: "https://www.allfantasy.ai",
          appUrl: "https://www.allfantasy.ai",
          publicSiteUrl: "https://www.allfantasy.ai",
        },
      },
      data: {
        groupsComplete: true,
        assignedTeams: 48,
        incompleteGroups: [],
        fixtureCount: 72,
        groupStageFixtureCount: 72,
        knockoutFixtureCount: 0,
        knockoutFixturesAvailable: false,
        venueKnownCount: 0,
        venueTbdCount: 72,
        kickoffKnownCount: 72,
        kickoffMissingCount: 0,
        standingsRowCount: 48,
        standingsSynced: true,
        standingsState: "pre_tournament",
        thirdPlaceRankingPresent: true,
        liveSyncRouteAvailable: true,
        bestThirdMappingConfigured: false,
        groupStageReady: true,
        knockoutsReady: false,
        productionStatus: "partial_ready",
        warnings: [
          "knockout_fixtures_pending: provider has not supplied Round of 32 or later fixtures yet.",
          "best_third_mapping_gated: keep WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED=false until FIFA mapping is official.",
        ],
      },
      ...overrides,
    },
  }
}

describe("WorldCupBracketShell fixture readiness", () => {
  beforeEach(() => {
    routerMocks.back.mockReset()
    routerMocks.push.mockReset()
    routerMocks.refresh.mockReset()
    routerMocks.replace.mockReset()
    clientApiMocks.listEntries.mockReset()
    clientApiMocks.getEntry.mockReset()
    clientApiMocks.fetchCompletionReview.mockReset()
    clientApiMocks.finalizeEntry.mockReset()
    clientApiMocks.fetchGroupStageView.mockReset()
    clientApiMocks.saveGroupRanking.mockReset()
    clientApiMocks.saveThirdPlaceAdvancers.mockReset()
    clientApiMocks.adminLoadTestFixtures.mockReset()
    clientApiMocks.clearPicks.mockReset()
    clientApiMocks.savePick.mockReset()
    vi.unstubAllGlobals()
    clientApiMocks.listEntries.mockResolvedValue([makeShellEntry()])
    clientApiMocks.getEntry.mockResolvedValue({ ...makeShellEntry(), picks: [] })
    clientApiMocks.fetchCompletionReview.mockResolvedValue({
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: false,
      knockoutComplete: false,
      fullEntryComplete: false,
      groupsRankedCount: 0,
      missingGroups: ["A"],
      thirdPlaceSelectedCount: 0,
      missingKnockoutPicks: 1,
      requiredKnockoutPicks: 1,
      completedKnockoutPicks: 0,
      isLocked: false,
      isComplete: false,
      submittedAt: null,
    })
    clientApiMocks.fetchGroupStageView.mockResolvedValue(makeShellGroupStageView())
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
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes("/api/brackets/world-cup/admin/readiness")) {
        return {
          ok: true,
          json: async () => makeReadinessResponse(),
        }
      }
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({
            preferences: {
              poolMuted: false,
              inAppEnabled: true,
              smsEnabled: false,
              usernameMentionsEnabled: true,
              allMentionsEnabled: true,
              commissionerAnnouncementsEnabled: true,
              deadlineRemindersEnabled: true,
              bracketFinalizedEnabled: true,
              resultsUpdatedEnabled: true,
              leaderboardUpdatedEnabled: true,
              generalChatEnabled: false,
              chimmyRepliesEnabled: true,
            },
            phoneVerificationRequiredForSms: true,
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({}),
      }
    }))
  })

  it("renders Group Stage when initialized from the group-stage tab", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="group-stage" initialEntryId="entry-1" />)

    expect(await screen.findByTestId("world-cup-group-stage-picks")).toHaveTextContent("entry-1")
  })

  it("keeps predictive knockout generated from group predictions", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="picks" initialEntryId="entry-1" />)

    expect(await screen.findByText("Your knockout bracket is generated from your predicted group results.")).toBeInTheDocument()
    expect(screen.queryByTestId("world-cup-reseeded-knockout-locked")).not.toBeInTheDocument()
  })

  it("falls back from a stale entry query without breaking the knockouts tab", async () => {
    window.history.pushState({}, "", "/brackets/world-cup/c1?tab=knockouts&entry=stale-entry")
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="picks" initialEntryId="stale-entry" />)

    expect(await screen.findByText("Your knockout bracket is generated from your predicted group results.")).toBeInTheDocument()
    await waitFor(() => expect(routerMocks.replace).toHaveBeenCalledWith("/brackets/world-cup/c1?tab=knockouts&entry=entry-1"))
    expect(clientApiMocks.getEntry).not.toHaveBeenCalledWith("c1", "stale-entry")
  })

  it("blocks reseeded knockout picks before official fixtures are available", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          challenge: { ...makeShellView().challenge, knockoutMode: "reseeded" },
        }) as any}
        defaultTab="picks"
        initialEntryId="entry-1"
      />
    )

    expect(await screen.findByText("Knockout picks open after official Round of 32 fixtures are available.")).toBeInTheDocument()
    expect(screen.getByTestId("world-cup-reseeded-knockout-locked")).toHaveTextContent(
      /Official knockout fixtures are not available yet/i
    )
    expect(screen.getAllByRole("button", { name: /Knockout Locked/i }).every((button) => button.hasAttribute("disabled"))).toBe(true)
    expect(screen.queryByText(/Load Test Knockout Teams/i)).not.toBeInTheDocument()
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/dfs|betting|wager/)
  })

  it("opens reseeded knockout picks when official fixtures are available", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          challenge: { ...makeShellView().challenge, knockoutMode: "reseeded" },
          matches: [makeShellMatch({ apiFixtureId: 9001, apiStatusShort: "NS" })],
        }) as any}
        defaultTab="picks"
        initialEntryId="entry-1"
      />
    )

    expect(await screen.findByText("Knockout picks open after official Round of 32 fixtures are available.")).toBeInTheDocument()
    expect(screen.queryByTestId("world-cup-reseeded-knockout-locked")).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /Start Making Picks/i }).some((button) => !button.hasAttribute("disabled"))).toBe(true)
  })

  it("renders Review when initialized from the review tab", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" initialEntryId="entry-1" />)

    await waitFor(() => expect(clientApiMocks.fetchCompletionReview).toHaveBeenCalledWith("c1", "entry-1"))
    expect(screen.getByText(/Review Your Road to Glory/i)).toBeInTheDocument()
    expect(screen.getByText(/Check every group, knockout path, and finalist/i)).toBeInTheDocument()
    expect(screen.getByText(/Changing Group Stage picks may unfinalize your entry/i)).toBeInTheDocument()
  })

  it("groups all 6 AI cards in a single Bracket AI Report section with Pro tier chip and no upgrade banner for Pro users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView() as any}
        defaultTab="review"
        initialEntryId="entry-1"
      />
    )

    const report = await screen.findByTestId("world-cup-review-ai-report")
    expect(report).toBeInTheDocument()
    expect(within(report).getByText(/Your Bracket AI Report/i)).toBeInTheDocument()
    expect(within(report).getByText(/Six AI signals computed from your own picks/i)).toBeInTheDocument()
    // Pro tier chip.
    expect(within(report).getByTestId("world-cup-review-ai-report-tier").textContent).toMatch(/AF Pro active/i)
    // No consolidated upgrade banner for Pro users.
    expect(within(report).queryByTestId("world-cup-review-ai-report-upgrade-banner")).toBeNull()
    // All 6 AI cards are inside the same report section.
    expect(within(report).getByTestId("world-cup-bracket-grade")).toBeInTheDocument()
    expect(within(report).getByTestId("world-cup-review-ai-confidence")).toBeInTheDocument()
    expect(within(report).getByTestId("world-cup-path-to-win")).toBeInTheDocument()
    expect(within(report).getByTestId("world-cup-explain-bracket")).toBeInTheDocument()
    expect(within(report).getByTestId("world-cup-bracket-uniqueness")).toBeInTheDocument()
    expect(within(report).getByTestId("world-cup-ai-share-card")).toBeInTheDocument()
  })

  it("suppresses per-card tier chips inside the consolidated Bracket AI Report (canonical chip lives at section header only)", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView() as any}
        defaultTab="review"
        initialEntryId="entry-1"
      />
    )

    const report = await screen.findByTestId("world-cup-review-ai-report")

    // Canonical section-level chip is present exactly once.
    expect(within(report).getByTestId("world-cup-review-ai-report-tier")).toBeInTheDocument()

    // Per-card chips should NOT render inside the report when hideTierChip is true.
    // (Outside the report — e.g. the Leaderboard tab's Path To Win — they still render.)
    expect(within(report).queryByTestId("world-cup-explain-bracket-tier")).toBeNull()
    expect(within(report).queryByTestId("world-cup-bracket-uniqueness-tier")).toBeNull()
    expect(within(report).queryByTestId("world-cup-ai-share-card-tier")).toBeNull()

    // Inline-card chip text should not duplicate inside the report.
    // The Bracket Grade card's "AF Pro detail" / "Basic" pill should be gone.
    expect(within(report).queryByText(/^AF Pro detail$/i)).toBeNull()
    expect(within(report).queryByText(/^Basic$/i)).toBeNull()
    // Path to Win's "AF Pro active" / "AF Pro locked" pill should be gone.
    expect(within(report).queryByText(/^AF Pro locked$/i)).toBeNull()
    // The Path-to-Win-only "AF Pro active" string should not appear as a chip inside the report
    // (the section-level chip uses the same copy but is matched via testid above).
    const piped = within(report).queryAllByText(/^AF Pro active$/i)
    // Exactly one occurrence — the section-level chip.
    expect(piped.length).toBeLessThanOrEqual(1)
    // Confidence Check's "Open"/"Locked" pill should be gone inside the report.
    expect(within(report).queryByText(/^Open$/i)).toBeNull()
  })

  it("shows ONE consolidated AF Pro upgrade banner for free users instead of repeating five locked CTAs", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({ hasBracketBrainAi: false }) as any}
        defaultTab="review"
        initialEntryId="entry-1"
      />
    )

    const report = await screen.findByTestId("world-cup-review-ai-report")
    expect(within(report).getByTestId("world-cup-review-ai-report-tier").textContent).toMatch(/AF Pro preview/i)
    const banner = within(report).getByTestId("world-cup-review-ai-report-upgrade-banner")
    expect(banner.textContent).toMatch(/AF Pro unlocks/i)
    expect(banner.textContent).toMatch(/Champion Confidence/i)
    expect(banner.textContent).toMatch(/Path to Win/i)
    expect(banner.textContent).toMatch(/Uniqueness/i)
    expect(banner.textContent).toMatch(/Share card/i)
  })

  it("lock countdown label is hydration-safe (gated by mounted flag, rendered after effect)", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    // Render the Picks tab where the countdown badge lives. Future lock time so the helper
    // would produce a real countdown string — but only after hydration.
    const farFutureLockAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const view = makeShellView()
    ;(view.challenge as any).effectivePickLockAt = farFutureLockAt
    ;(view.challenge as any).pickLockAt = farFutureLockAt
    render(
      <WorldCupBracketShell
        initialView={view as any}
        defaultTab="picks"
        initialEntryId="entry-1"
      />
    )

    // After mount + effects flush, the countdown badge should appear with a stable
    // "until picks lock" string. The hasMounted gate ensures the initial SSR-equivalent
    // render did NOT emit this badge text.
    const badge = await screen.findByTestId("world-cup-lock-countdown")
    expect(badge.textContent).toMatch(/until picks lock/i)
  })

  it("AI Confidence Check renders deterministic lines for AI/Pro users on Review", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" initialEntryId="entry-1" />)

    const card = await screen.findByTestId("world-cup-review-ai-confidence")
    expect(card).toBeInTheDocument()
    // Pro/AI-unlocked path: all four deterministic labels present.
    expect(within(card).getByText(/Missing picks:/i)).toBeInTheDocument()
    expect(within(card).getByText(/High-risk picks:/i)).toBeInTheDocument()
    expect(within(card).getByText(/Bracket shape:/i)).toBeInTheDocument()
    expect(within(card).getByText(/Finalize confidence:/i)).toBeInTheDocument()
    // Disclaimer remains visible to confirm scope of the helper.
    expect(within(card).getByText(/Deterministic prediction and scoring complexity only/i)).toBeInTheDocument()
    // No wagering/betting copy.
    expect(card.textContent?.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("AI Confidence Check hides Pro details for free users (locked CTA only)", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({ hasBracketBrainAi: false }) as any}
        defaultTab="review"
        initialEntryId="entry-1"
      />
    )

    const card = await screen.findByTestId("world-cup-review-ai-confidence")
    expect(card).toBeInTheDocument()
    // Per-card chip is suppressed inside the report; canonical chip lives at the section header.
    expect(within(card).queryByText(/^Locked$/)).toBeNull()
    const report = screen.getByTestId("world-cup-review-ai-report")
    expect(within(report).getByTestId("world-cup-review-ai-report-tier").textContent).toMatch(/AF Pro preview/i)
    // Pro-only deterministic labels are NOT visible (only rendered when unlocked)
    expect(within(card).queryByText(/Missing picks:/i)).toBeNull()
    expect(within(card).queryByText(/High-risk picks:/i)).toBeNull()
    expect(within(card).queryByText(/Bracket shape:/i)).toBeNull()
  })

  it("AI Confidence Check surfaces missing-pick guidance for incomplete brackets", async () => {
    clientApiMocks.fetchCompletionReview.mockResolvedValueOnce({
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: false,
      knockoutComplete: false,
      fullEntryComplete: false,
      groupsRankedCount: 5,
      missingGroups: ["A", "B"],
      thirdPlaceSelectedCount: 2,
      missingKnockoutPicks: 4,
      requiredKnockoutPicks: 16,
      completedKnockoutPicks: 12,
      isLocked: false,
      isComplete: false,
      submittedAt: null,
    })

    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" initialEntryId="entry-1" />)

    const card = await screen.findByTestId("world-cup-review-ai-confidence")
    // Missing picks line should call out remaining knockout, groups, and third-place gaps.
    const missingLine = within(card).getByText(/Missing picks:/i).closest("p")?.textContent ?? ""
    expect(missingLine).toMatch(/4 knockout/i)
    expect(missingLine).toMatch(/7 groups/i)  // 12 - 5 = 7
    expect(missingLine).toMatch(/6 third-place/i)  // 8 - 2 = 6
    // Finalize confidence reflects incomplete state.
    expect(within(card).getByText(/Finish missing requirements before finalizing/i)).toBeInTheDocument()
  })

  it("auto-selects an entry and fetches Review when initialized from the review tab without an entry query", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    await waitFor(() => expect(clientApiMocks.fetchCompletionReview).toHaveBeenCalledWith("c1", "entry-1"))
    await waitFor(() => expect(clientApiMocks.fetchGroupStageView).toHaveBeenCalledWith("c1", "entry-1"))
    expect(screen.getByTestId("world-cup-review-panel")).toBeInTheDocument()
  })

  it("Review shows saved Group Stage and third-place picks separately from official results", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    const savedPicks = await screen.findByTestId("world-cup-review-saved-picks")
    expect(within(savedPicks).getByTestId("world-cup-review-group-A")).toHaveTextContent("#1 Argentina")
    expect(within(savedPicks).getByTestId("world-cup-review-group-A")).toHaveTextContent("Correct +5")
    expect(within(savedPicks).getByTestId("world-cup-review-group-A")).toHaveTextContent("#2 Brazil")
    expect(within(savedPicks).getByTestId("world-cup-review-group-A")).toHaveTextContent("Wrong +0")
    expect(savedPicks).toHaveTextContent("Canada")
    expect(savedPicks).toHaveTextContent("Pending")
  })

  it("Review shows saved knockout picks with automatic result states after finalize", async () => {
    const finalizedCompletion = {
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: true,
      knockoutComplete: true,
      fullEntryComplete: true,
      groupsRankedCount: 12,
      missingGroups: [],
      thirdPlaceSelectedCount: 8,
      missingKnockoutPicks: 0,
      requiredKnockoutPicks: 16,
      completedKnockoutPicks: 16,
      isLocked: false,
      isComplete: true,
      submittedAt: "2026-05-16T12:00:00.000Z",
    }
    const finalMatch = makeShellMatch({
      id: "m1",
      matchNumber: 1,
      status: "final",
      homeScore: 2,
      awayScore: 1,
      winnerTeamId: "demo_team_brazil",
      winnerTeamName: "Brazil",
      apiStatusShort: "SIM",
    })
    const correctPick = {
      id: "pick-m1",
      matchId: "m1",
      matchNumber: 1,
      round: "round_of_32",
      selectedTeamId: "demo_team_brazil",
      selectedSlotKey: "A1",
      selectedTeamName: "Brazil",
      pointsAwarded: 10,
      isCorrect: true,
      lockedAt: "2026-06-11T21:00:00.000Z",
    }
    clientApiMocks.fetchCompletionReview.mockResolvedValueOnce(finalizedCompletion)
    clientApiMocks.getEntry.mockResolvedValue({ ...makeShellEntry({ isComplete: true, submittedAt: finalizedCompletion.submittedAt }), picks: [correctPick] })

    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          activeEntry: { id: "entry-1", name: "Bracket 1" },
          entries: [{ id: "entry-1", name: "Bracket 1", createdAt: "2026-01-01T00:00:00.000Z", totalScore: 10, rank: 1, isComplete: true }],
          matches: [finalMatch],
          picks: [correctPick],
        }) as any}
        defaultTab="review"
      />
    )

    const knockoutPick = await screen.findByTestId("world-cup-review-knockout-pick-m1")
    expect(knockoutPick).toHaveAttribute("data-result-state", "correct")
    expect(knockoutPick).toHaveTextContent("Match 1 · Brazil")
    expect(knockoutPick).toHaveTextContent("Correct +10")
    expect(screen.getByText(/Your bracket is locked in/i)).toBeInTheDocument()
    expect(screen.getAllByText(/You can still edit until pool lock/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: /Show Results/i })).not.toBeInTheDocument()
  })

  it("shows Finalize when the server review says the entry is complete", async () => {
    clientApiMocks.fetchCompletionReview.mockResolvedValueOnce({
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: true,
      knockoutComplete: true,
      fullEntryComplete: true,
      groupsRankedCount: 12,
      missingGroups: [],
      thirdPlaceSelectedCount: 8,
      missingKnockoutPicks: 0,
      requiredKnockoutPicks: 16,
      completedKnockoutPicks: 16,
      isLocked: false,
      isComplete: false,
      submittedAt: null,
    })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    expect(await screen.findByText(/Complete draft/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Finalize Entry/i })).toBeEnabled()
  })

  it("shows missing requirements when the server review says the entry is incomplete", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    expect(await screen.findByText("Missing requirements")).toBeInTheDocument()
    expect(screen.getByText(/Missing group rankings: A/i)).toBeInTheDocument()
    expect(screen.getByText(/Third-place advancers selected: 0\/8/i)).toBeInTheDocument()
    expect(screen.getByText(/Missing knockout picks: 1/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Finalize Entry/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Complete all missing requirements to unlock Finalize/i)).toBeInTheDocument()
  })

  it("hides admin and simulation shortcuts from normal users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} />)

    await waitFor(() => expect(clientApiMocks.listEntries).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: /Admin\/Test/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/World Cup Simulation Panel/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Commissioner/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId("world-cup-readiness-panel")).not.toBeInTheDocument()
  })

  it("renders admin simulation controls with dry run defaults and checklist results", async () => {
    clientApiMocks.adminSimulateRound.mockResolvedValueOnce({
      ok: true,
      result: {
        challengeId: "c1",
        round: "quarterfinal",
        dryRun: true,
        strategy: "higher_seed",
        simulatedMatches: 2,
        skippedMatches: 1,
        skippedMatchIds: ["m29"],
      },
    })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          isAdmin: true,
          matches: makeShellSeededMatches(),
          challenge: { ...makeShellView().challenge, simulationEnabled: true },
        }) as any}
        defaultTab="picks"
      />
    )

    expect(await screen.findByText("World Cup Simulation Panel")).toBeInTheDocument()
    const dryRun = screen.getAllByRole("checkbox", { name: /^Dry run$/i })[0]
    expect(dryRun).toBeChecked()
    expect(screen.queryByTestId("world-cup-simulation-live-warning")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Simulation strategy"), { target: { value: "higher_seed" } })
    fireEvent.change(screen.getByLabelText("Simulation round"), { target: { value: "quarterfinal" } })
    fireEvent.click(screen.getByRole("button", { name: /^Simulate Round$/i }))

    await waitFor(() => {
      expect(clientApiMocks.adminSimulateRound).toHaveBeenCalledWith("c1", {
        round: "quarterfinal",
        strategy: "higher_seed",
        dryRun: true,
      })
    })
    expect(screen.getByRole("button", { name: /^Simulate Round$/i })).toBeInTheDocument()
    expect(screen.getByText(/"simulatedMatches": 2/i)).toBeInTheDocument()
    expect(screen.getByText(/Did request return 200\?/i)).toBeInTheDocument()
    expect(screen.getByText(/Did any matches get skipped\?/i)).toBeInTheDocument()
  })

  it("requires a match id before simulating one match", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          isAdmin: true,
          matches: makeShellSeededMatches(),
          challenge: { ...makeShellView().challenge, simulationEnabled: true },
        }) as any}
        defaultTab="picks"
      />
    )

    expect(await screen.findByText("World Cup Simulation Panel")).toBeInTheDocument()
    const input = screen.getByLabelText("Match ID required for simulate match")
    const button = screen.getByRole("button", { name: /^Simulate Match$/i })
    expect(screen.getByText("Select or enter a Match ID before simulating.")).toBeInTheDocument()
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: "m1" } })
    expect(button).toBeEnabled()
  })

  it("keeps free World Cup play visible while showing locked premium copy", async () => {
    clientApiMocks.listEntries.mockResolvedValueOnce([])
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(
      <WorldCupBracketShell
        initialView={makeShellView({
          isOwner: false,
          isAdmin: false,
          hasBracketBrainAi: false,
          activeEntry: null,
          entries: [],
          challenge: {
            ...makeShellView().challenge,
            maxEntriesPerParticipant: 1,
          },
        }) as any}
        defaultTab="home"
      />
    )

    await waitFor(() => expect(clientApiMocks.listEntries).toHaveBeenCalled())
    expect(screen.getAllByRole("button", { name: /Create My Bracket/i }).some((button) => !button.hasAttribute("disabled"))).toBe(true)
    expect(screen.getByText(/Free play stays open/i)).toBeInTheDocument()
    expect(screen.getByText(/Join, create your first bracket, make Group Stage and Knockout picks, review, finalize, and view the leaderboard for free/i)).toBeInTheDocument()
    expect(screen.getByText(/Free users can create one bracket entry in this pool/i)).toBeInTheDocument()
    expect(screen.getByText(/AF Commissioner Tools/i)).toBeInTheDocument()
    expect(screen.getByText(/Export Leaderboard/i)).toBeInTheDocument()
    expect(screen.getByText(/AI Bracket Builder/i)).toBeInTheDocument()
    expect(screen.getByText(/AI Matchup Preview/i)).toBeInTheDocument()
    expect(screen.getByText(/AI What-If Scenarios/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Requires AF Commissioner/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Requires AI\/Pro/i).length).toBeGreaterThan(0)
    const community = screen.getByTestId("world-cup-community-foundation")
    expect(community).toHaveTextContent("Pool Chat")
    expect(within(community).getByText(/Talk strategy, call your shots, and keep the pool alive/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Message the pool or ask Chimmy/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Send$/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^GIF$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Poll$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Image$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Voice$/i })).toBeInTheDocument()
    expect(screen.getByText(/^Notification Settings$/i)).toBeInTheDocument()
    expect(screen.getByText(/In-app notifications are on by default/i)).toBeInTheDocument()
    expect(screen.getByText(/SMS alerts require a verified phone number and opt-in/i)).toBeInTheDocument()
    expect(screen.getByText(/Pool muted/i)).toBeInTheDocument()
    expect(screen.getByText(/Requires verified phone/i)).toBeInTheDocument()
    expect(screen.getByText(/Pool owners and commissioners cannot override/i)).toBeInTheDocument()
    expect(screen.getByText(/Free users can follow pool updates here/i)).toBeInTheDocument()
    expect(screen.queryByText(/System Reminders/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Moderation$/i)).not.toBeInTheDocument()
  })

  it("keeps mobile pick help manual and does not expose active AI builder controls", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} />)

    expect(await screen.findByText(/Guided Pick Help/i)).toBeInTheDocument()
    expect(screen.getByText(/Use the sticky Start Making Picks button on mobile/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Safe$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Balanced$/i })).not.toBeInTheDocument()
  })

  it("loads and sends World Cup pool chat messages from the community panel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({
            preferences: {
              poolMuted: false,
              inAppEnabled: true,
              smsEnabled: false,
              usernameMentionsEnabled: true,
              allMentionsEnabled: true,
              commissionerAnnouncementsEnabled: true,
              deadlineRemindersEnabled: true,
              bracketFinalizedEnabled: true,
              resultsUpdatedEnabled: true,
              leaderboardUpdatedEnabled: true,
              generalChatEnabled: false,
              chimmyRepliesEnabled: true,
            },
          }),
        } as Response
      }
      if (url.includes("/chat") && init?.method === "POST" && !url.includes("action=upload_image")) {
        const payload = JSON.parse(String(init.body ?? "{}"))
        return {
          ok: true,
          json: async () => ({
            ok: true,
            message: {
              id: "chat-2",
              userId: "user-1",
              authorName: "Owner",
              authorAvatarUrl: null,
              body: payload.body ?? "Let us go",
              messageType: "text",
              visibility: "public",
              targetUserId: null,
              mentions: [],
              createdAt: "2026-06-01T12:05:00.000Z",
              isOwnMessage: true,
              isPrivate: false,
            },
          }),
        } as Response
      }
      if (url.includes("/chat")) {
        return {
          ok: true,
          json: async () => ({
            messages: [{
              id: "chat-1",
              userId: "user-2",
              authorName: "Friend",
              authorAvatarUrl: null,
              body: "Opening message",
              messageType: "text",
              visibility: "public",
              targetUserId: null,
              mentions: [],
              createdAt: "2026-06-01T12:00:00.000Z",
              isOwnMessage: false,
              isPrivate: false,
            }],
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => makeReadinessResponse(),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} defaultTab="home" />)

    expect(await screen.findByText("Opening message")).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Message the pool or ask Chimmy/i), {
      target: { value: "Let us go" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/brackets/world-cup/c1/chat"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ body: "Let us go" }),
        })
      )
    })
  })

  it("updates World Cup pool notification preferences for the current user", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/chat") && init?.method === "POST" && String(init.body ?? "").includes("update_notification_preferences")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            preferences: { poolMuted: true, inAppEnabled: true, smsEnabled: false },
          }),
        } as Response
      }
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({
            preferences: {
              poolMuted: false,
              inAppEnabled: true,
              smsEnabled: false,
              usernameMentionsEnabled: true,
              allMentionsEnabled: true,
              commissionerAnnouncementsEnabled: true,
              deadlineRemindersEnabled: true,
              bracketFinalizedEnabled: true,
              resultsUpdatedEnabled: true,
              leaderboardUpdatedEnabled: true,
              generalChatEnabled: false,
              chimmyRepliesEnabled: true,
            },
          }),
        } as Response
      }
      if (url.includes("/chat")) {
        return {
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response
      }
      return {
        ok: true,
        json: async () => makeReadinessResponse(),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} defaultTab="home" />)

    const muteSwitch = await screen.findByRole("switch", { name: /Pool muted/i })
    fireEvent.click(muteSwitch)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/brackets/world-cup/c1/chat"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "update_notification_preferences", poolMuted: true }),
        })
      )
    })
  })

  it("supports World Cup composer emoji and rich media foundations", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} defaultTab="home" />)

    const input = await screen.findByPlaceholderText(/Message the pool or ask Chimmy/i)
    fireEvent.click(screen.getByRole("button", { name: /Insert 🔥/i }))
    expect(input).toHaveValue("🔥")

    fireEvent.click(screen.getByRole("button", { name: /^GIF$/i }))
    expect(screen.getByText(/^GIF Search$/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search Klipy GIFs/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /^Poll$/i }))
    expect(screen.getByRole("button", { name: /^Create Poll$/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Poll question/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /^Image$/i }))
    expect(screen.getByText(/^Image Upload$/i)).toBeInTheDocument()
    expect(screen.getByText(/Upload a pool chat image through the World Cup Cloudinary route/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /^Voice$/i }))
    expect(screen.getByText(/Voice notes are coming soon/i)).toBeInTheDocument()
  })

  it("supports safe World Cup chat formatting controls and preview", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({ preferences: {} }),
        } as Response
      }
      if (url.includes("/chat")) {
        return {
          ok: true,
          json: async () => ({
            messages: [{
              id: "chat-rich-1",
              userId: "user-2",
              authorName: "Friend",
              authorAvatarUrl: null,
              body: "**Bold** _Italic_ __Under__ ~~Strike~~ [color=af-blue]Blue[/color] [font=mono]Mono[/font] <script>alert(1)</script>",
              messageType: "text",
              visibility: "public",
              targetUserId: null,
              mentions: [],
              createdAt: "2026-06-01T12:00:00.000Z",
              isOwnMessage: false,
              isPrivate: false,
            }],
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => makeReadinessResponse(),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} defaultTab="home" />)

    expect(await screen.findByText("Bold", { selector: "span" })).toHaveClass("font-black")
    expect(screen.getByText("Italic", { selector: "span" })).toHaveClass("italic")
    expect(screen.getByText("Under", { selector: "span" })).toHaveClass("underline")
    expect(screen.getByText("Strike", { selector: "span" })).toHaveClass("line-through")
    expect(screen.getByText("Blue", { selector: "span" })).toHaveClass("text-white/85")
    expect(screen.getByText("Mono", { selector: "span" })).toHaveClass("font-mono")
    expect(document.querySelector("script")).toBeNull()

    const input = screen.getByPlaceholderText(/Message the pool or ask Chimmy/i)
    fireEvent.click(screen.getByRole("button", { name: /^Bold$/i }))
    expect(input).toHaveValue("**text**")
    expect(screen.getByText(/Formatting Preview/i)).toBeInTheDocument()

    fireEvent.change(input, { target: { value: "" } })
    fireEvent.change(screen.getByRole("combobox", { name: /Chat color/i }), { target: { value: "af-blue" } })
    expect(input).toHaveValue("[color=af-blue]text[/color]")

    fireEvent.change(input, { target: { value: "" } })
    fireEvent.change(screen.getByRole("combobox", { name: /Chat font/i }), { target: { value: "mono" } })
    expect(input).toHaveValue("[font=mono]text[/font]")
  })

  it("searches, selects, and sends World Cup GIF metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({ preferences: {} }),
        } as Response
      }
      if (url.includes("/chat") && url.includes("action=gifs")) {
        return {
          ok: true,
          json: async () => ({
            gifs: [{
              id: "gif-1",
              title: "Goal",
              previewUrl: "https://media.klipy.com/gifs/goal.webp",
              gifUrl: "https://media.klipy.com/gifs/goal.gif",
              width: 320,
              height: 180,
              provider: "klipy",
            }],
            total: 1,
          }),
        } as Response
      }
      if (url.includes("/chat") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body ?? "{}"))
        return {
          ok: true,
          json: async () => ({
            ok: true,
            message: {
              id: "chat-gif-1",
              userId: "user-1",
              authorName: "Owner",
              authorAvatarUrl: null,
              body: payload.body,
              gif: payload.gif,
              messageType: "gif",
              visibility: "public",
              targetUserId: null,
              mentions: [],
              createdAt: "2026-06-01T12:05:00.000Z",
              isOwnMessage: true,
              isPrivate: false,
            },
          }),
        } as Response
      }
      if (url.includes("/chat")) {
        return {
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response
      }
      return {
        ok: true,
        json: async () => makeReadinessResponse(),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} defaultTab="home" />)

    fireEvent.click(await screen.findByRole("button", { name: /^GIF$/i }))
    fireEvent.change(screen.getByPlaceholderText(/Search Klipy GIFs/i), { target: { value: "goal" } })
    fireEvent.click(screen.getByRole("button", { name: /Search GIFs/i }))

    expect(await screen.findByText("Goal")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Goal/i }))
    expect(screen.getByText(/Selected GIF/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Message the pool or ask Chimmy/i)).toHaveValue("GIF")
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/brackets/world-cup/c1/chat"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"provider":"klipy"'),
        })
      )
    })
  })

  it("uploads, previews, and sends World Cup chat image metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({ preferences: {} }),
        } as Response
      }
      if (url.includes("/chat") && url.includes("action=upload_image")) {
        return {
          ok: true,
          json: async () => ({
            image: {
              assetId: "asset-1",
              publicId: "allfantasy/world-cup/c1/chat/image",
              secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/image.png",
              width: 320,
              height: 200,
              format: "png",
              bytes: 1234,
              provider: "cloudinary",
            },
          }),
        } as Response
      }
      if (url.includes("/chat") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body ?? "{}"))
        return {
          ok: true,
          json: async () => ({
            ok: true,
            message: {
              id: "chat-image-1",
              userId: "user-1",
              authorName: "Owner",
              authorAvatarUrl: null,
              body: payload.body,
              image: payload.image,
              messageType: "image",
              visibility: "public",
              targetUserId: null,
              mentions: [],
              createdAt: "2026-06-01T12:05:00.000Z",
              isOwnMessage: true,
              isPrivate: false,
            },
          }),
        } as Response
      }
      if (url.includes("/chat")) {
        return {
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response
      }
      return {
        ok: true,
        json: async () => makeReadinessResponse(),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} defaultTab="home" />)

    fireEvent.click(await screen.findByRole("button", { name: /^Image$/i }))
    const fileInput = screen.getByLabelText(/Choose Image/i, { selector: "input" })
    fireEvent.change(fileInput, {
      target: { files: [new File(["ok"], "goal.png", { type: "image/png" })] },
    })

    expect(await screen.findByText(/Selected Image/i)).toBeInTheDocument()
    expect(screen.getByAltText(/Uploaded World Cup chat image/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Message the pool or ask Chimmy/i)).toHaveValue("Image")
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/brackets/world-cup/c1/chat"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"provider":"cloudinary"'),
        })
      )
    })
    expect(await screen.findAllByAltText(/Uploaded World Cup chat image/i)).toHaveLength(1)
  })

  it("creates and votes on World Cup chat polls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({ preferences: {} }),
        } as Response
      }
      if (url.includes("/chat") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body ?? "{}"))
        if (payload.action === "create_poll") {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              message: {
                id: "poll-1",
                userId: "user-1",
                authorName: "Owner",
                authorAvatarUrl: null,
                body: payload.question,
                messageType: "poll",
                poll: {
                  question: payload.question,
                  options: payload.options.map((label: string, index: number) => ({
                    id: `option-${index + 1}`,
                    label,
                    votes: 0,
                    percentage: 0,
                  })),
                  currentUserVote: null,
                  totalVotes: 0,
                  closed: false,
                  closedAt: null,
                  createdByUserId: "user-1",
                  createdAt: "2026-06-01T12:00:00.000Z",
                },
                visibility: "public",
                targetUserId: null,
                mentions: [],
                createdAt: "2026-06-01T12:00:00.000Z",
                isOwnMessage: true,
                isPrivate: false,
              },
            }),
          } as Response
        }
        if (payload.action === "poll_vote") {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              message: {
                id: "poll-1",
                userId: "user-1",
                authorName: "Owner",
                authorAvatarUrl: null,
                body: "Who wins Group A?",
                messageType: "poll",
                poll: {
                  question: "Who wins Group A?",
                  options: [
                    { id: "option-1", label: "Mexico", votes: 1, percentage: 100 },
                    { id: "option-2", label: "Uruguay", votes: 0, percentage: 0 },
                  ],
                  currentUserVote: payload.optionId,
                  totalVotes: 1,
                  closed: false,
                  closedAt: null,
                  createdByUserId: "user-1",
                  createdAt: "2026-06-01T12:00:00.000Z",
                },
                visibility: "public",
                targetUserId: null,
                mentions: [],
                createdAt: "2026-06-01T12:00:00.000Z",
                isOwnMessage: true,
                isPrivate: false,
              },
            }),
          } as Response
        }
      }
      if (url.includes("/chat")) {
        return {
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response
      }
      return {
        ok: true,
        json: async () => makeReadinessResponse(),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false }) as any} defaultTab="home" />)

    fireEvent.click(await screen.findByRole("button", { name: /^Poll$/i }))
    fireEvent.change(screen.getByPlaceholderText(/Poll question/i), { target: { value: "Who wins Group A?" } })
    fireEvent.change(screen.getByPlaceholderText(/Option 1/i), { target: { value: "Mexico" } })
    fireEvent.change(screen.getByPlaceholderText(/Option 2/i), { target: { value: "Uruguay" } })
    fireEvent.click(screen.getByRole("button", { name: /^Create Poll$/i }))

    await waitFor(() => expect(screen.getAllByText("Who wins Group A?").length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole("button", { name: /Mexico/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/brackets/world-cup/c1/chat"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"poll_vote"'),
        })
      )
    })
    expect(await screen.findByText(/1 total vote/i)).toBeInTheDocument()
    expect(screen.getByText(/Your vote is counted/i)).toBeInTheDocument()
    expect(screen.getByText(/1 vote · 100%/i)).toBeInTheDocument()
  })

  it("shows private Chimmy indicator and appends private prompt plus reply", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/chat") && url.includes("notification_preferences")) {
        return {
          ok: true,
          json: async () => ({ preferences: {} }),
        } as Response
      }
      if (url.includes("/chat") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body ?? "{}"))
        return {
          ok: true,
          json: async () => ({
            ok: true,
            message: {
              id: "chimmy-prompt-1",
              userId: "user-1",
              authorName: "Owner",
              authorAvatarUrl: null,
              body: payload.body,
              messageType: "chimmy_private_prompt",
              visibility: "private_to_user",
              targetUserId: "user-1",
              mentions: [{ type: "chimmy" }],
              createdAt: "2026-06-01T12:00:00.000Z",
              isOwnMessage: true,
              isPrivate: true,
            },
            chimmyResponse: {
              id: "chimmy-response-1",
              userId: null,
              authorName: "Chimmy",
              authorAvatarUrl: null,
              body: "I would start by protecting your group winner path.",
              messageType: "chimmy_private_response",
              visibility: "private_to_user",
              targetUserId: "user-1",
              mentions: [],
              createdAt: "2026-06-01T12:00:01.000Z",
              isOwnMessage: false,
              isPrivate: true,
            },
            messages: [
              {
                id: "chimmy-prompt-1",
                userId: "user-1",
                authorName: "Owner",
                authorAvatarUrl: null,
                body: payload.body,
                messageType: "chimmy_private_prompt",
                visibility: "private_to_user",
                targetUserId: "user-1",
                mentions: [{ type: "chimmy" }],
                createdAt: "2026-06-01T12:00:00.000Z",
                isOwnMessage: true,
                isPrivate: true,
              },
              {
                id: "chimmy-response-1",
                userId: null,
                authorName: "Chimmy",
                authorAvatarUrl: null,
                body: "I would start by protecting your group winner path.",
                messageType: "chimmy_private_response",
                visibility: "private_to_user",
                targetUserId: "user-1",
                mentions: [],
                createdAt: "2026-06-01T12:00:01.000Z",
                isOwnMessage: false,
                isPrivate: true,
              },
            ],
          }),
        } as Response
      }
      if (url.includes("/chat")) {
        return {
          ok: true,
          json: async () => ({ messages: [] }),
        } as Response
      }
      return {
        ok: true,
        json: async () => makeReadinessResponse(),
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: true, isAdmin: false, hasBracketBrainAi: true }) as any} defaultTab="home" />)

    const input = await screen.findByPlaceholderText(/Message the pool or ask Chimmy/i)
    fireEvent.change(input, { target: { value: "@chimmy who should I pick?" } })

    expect(screen.getByText(/Only you will see your prompt and Chimmy.s answer in this pool/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }))

    expect(await screen.findByText("I would start by protecting your group winner path.")).toBeInTheDocument()
    expect(screen.getAllByText(/Private Chimmy reply · Only visible to you/i).length).toBeGreaterThanOrEqual(2)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/brackets/world-cup/c1/chat"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("@chimmy who should I pick?"),
        })
      )
    })
  })

  it("joins from the invite-code panel through the invite join action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/brackets/world-cup/invite/INVITE")) {
        return {
          ok: true,
          json: async () => ({
            invite: {
              inviteCode: "INVITE",
              challengeId: "c1",
              name: "Office Pool",
              ownerName: "Owner",
              seasonYear: 2026,
              participantCount: 3,
              status: "open",
              visibility: "private",
              joinPreview: {
                requiresJoinPassword: false,
                joinBlockedReason: null,
                poolLocked: false,
                allowLateJoin: true,
                isFull: false,
                maxParticipants: 100,
              },
            },
            ok: true,
            challengeId: "c1",
            entryId: "entry-1",
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupInviteJoinPanel = (await import("@/components/brackets/world-cup/WorldCupInviteJoinPanel")).default
    render(<WorldCupInviteJoinPanel />)

    fireEvent.change(screen.getByTestId("world-cup-join-code-input"), { target: { value: "INVITE" } })
    fireEvent.click(screen.getByTestId("world-cup-join-lookup"))
    expect(await screen.findByTestId("world-cup-join-preview")).toHaveTextContent("Office Pool")

    fireEvent.click(screen.getByTestId("world-cup-join-submit"))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/brackets/world-cup/invite/INVITE/join",
        expect.objectContaining({ method: "POST" })
      )
      expect(routerMocks.push).toHaveBeenCalledWith(expect.stringContaining("/brackets/world-cup/c1?guided=1"))
    })
  })

  it("routes logged-out invite joins through login and back to the invite link", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!init?.method) {
        return {
          ok: true,
          json: async () => ({
            invite: {
              inviteCode: "INVITE",
              challengeId: "c1",
              name: "Office Pool",
              ownerName: "Owner",
              seasonYear: 2026,
              participantCount: 3,
              status: "open",
              visibility: "private",
              joinPreview: { requiresJoinPassword: false, joinBlockedReason: null },
            },
          }),
        } as Response
      }
      if (url.includes("/api/brackets/world-cup/invite/INVITE/join")) {
        return {
          ok: false,
          json: async () => ({ error: "UNAUTHENTICATED" }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupInviteJoinPanel = (await import("@/components/brackets/world-cup/WorldCupInviteJoinPanel")).default
    render(<WorldCupInviteJoinPanel />)

    fireEvent.change(screen.getByTestId("world-cup-join-code-input"), { target: { value: "INVITE" } })
    fireEvent.click(screen.getByTestId("world-cup-join-lookup"))
    expect(await screen.findByTestId("world-cup-join-preview")).toHaveTextContent("Office Pool")
    fireEvent.click(screen.getByTestId("world-cup-join-submit"))

    await waitFor(() => {
      expect(routerMocks.push).toHaveBeenCalledWith(
        `/login?callbackUrl=${encodeURIComponent("/join/bracket/INVITE")}&returnTo=${encodeURIComponent("/join/bracket/INVITE")}`
      )
    })
  })

  it("keeps logged-out invite recipients on the invite card with auth CTAs", async () => {
    const WorldCupJoinInvite = (await import("@/components/brackets/world-cup/WorldCupJoinInvite")).default
    render(
      <WorldCupJoinInvite
        invite={{
          inviteCode: "INVITE",
          challengeId: "c1",
          name: "Office Pool",
          ownerName: "Owner",
          seasonYear: 2026,
          participantCount: 3,
          status: "open",
          visibility: "private",
          joinPreview: {
            requiresJoinPassword: false,
            joinBlockedReason: null,
            poolLocked: false,
            allowLateJoin: true,
            isFull: false,
            maxParticipants: 100,
          },
        }}
      />
    )

    expect(screen.getByText("Office Pool")).toBeInTheDocument()
    expect(screen.getByText(/Sign in or create an account when you are ready/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Sign in to join/i })).toHaveAttribute(
      "href",
      `/login?callbackUrl=${encodeURIComponent("/join/bracket/INVITE")}&returnTo=${encodeURIComponent("/join/bracket/INVITE")}`
    )
    expect(screen.getByRole("link", { name: /Create account/i })).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("/join/bracket/INVITE"))
    )
    expect(routerMocks.push).not.toHaveBeenCalledWith(expect.stringContaining("/login?callbackUrl="))
  })

  it("shows commissioner affordances unlocked for pool owners and all-access users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: true, isAdmin: false, hasBracketBrainAi: false }) as any} defaultTab="home" />)

    await waitFor(() => expect(clientApiMocks.listEntries).toHaveBeenCalled())
    const panel = screen.getByTestId("world-cup-premium-access-panel")
    expect(within(panel).getByText(/AF Commissioner active/i)).toBeInTheDocument()
    expect(within(panel).getByText(/AI Bracket Builder/i)).toBeInTheDocument()
    expect(within(panel).getAllByText(/Unlocked/i).length).toBeGreaterThan(0)
    expect(within(panel).getAllByText(/Requires AI\/Pro/i).length).toBeGreaterThan(0)
    const community = screen.getByTestId("world-cup-community-foundation")
    expect(within(community).getAllByText(/Commissioner Announcements/i).length).toBeGreaterThan(0)
    expect(within(community).getByText(/Pinned Announcement/i)).toBeInTheDocument()
    expect(within(community).getByText(/System Reminders/i)).toBeInTheDocument()
    expect(within(community).getByText(/Moderation/i)).toBeInTheDocument()
  })

  it("shows AI affordances unlocked for all-access users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: true, hasBracketBrainAi: false }) as any} defaultTab="home" />)

    await waitFor(() => expect(clientApiMocks.listEntries).toHaveBeenCalled())
    const panel = screen.getByTestId("world-cup-premium-access-panel")
    expect(within(panel).getByText(/AF Commissioner active/i)).toBeInTheDocument()
    expect(within(panel).getByText(/AI\/Pro active/i)).toBeInTheDocument()
    expect(within(panel).getAllByText(/Unlocked/i).length).toBeGreaterThanOrEqual(6)
  })

  it("passes locked World Cup AI insight access to group stage for free users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false, hasBracketBrainAi: false }) as any} defaultTab="group-stage" />)

    expect(await screen.findByTestId("group-stage-ai-prop")).toHaveTextContent("ai-locked")
    expect(clientApiMocks.fetchCompletionReview).not.toHaveBeenCalled()
  })

  it("passes unlocked World Cup AI insight access to group stage for AI/Pro users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: false, hasBracketBrainAi: true }) as any} defaultTab="group-stage" />)

    expect(await screen.findByTestId("group-stage-ai-prop")).toHaveTextContent("ai-unlocked")
  })

  it("shows admin and simulation shortcuts for all-access users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: true }) as any} />)

    await waitFor(() => expect(clientApiMocks.listEntries).toHaveBeenCalled())
    expect(screen.getAllByRole("button", { name: /Admin\/Test/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: /Commissioner/i }).length).toBeGreaterThan(0)
    expect(screen.getByText(/World Cup Simulation Panel/i)).toBeInTheDocument()
  })

  it("shows World Cup production readiness details to admins without exposing secrets", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: true }) as any} />)

    const panel = await screen.findByTestId("world-cup-readiness-panel")
    expect(panel).toHaveTextContent("World Cup Production Readiness")
    expect(panel).toHaveTextContent("API-Football")
    expect(panel).toHaveTextContent("League ID")
    expect(panel).toHaveTextContent("1")
    expect(panel).toHaveTextContent("Data provider configured")
    expect(panel).toHaveTextContent("API key configured")
    expect(panel).toHaveTextContent("Cron secret configured")
    expect(panel).toHaveTextContent("Provider teams grouped")
    expect(panel).toHaveTextContent("App bracket teams seeded")
    expect(panel).toHaveTextContent("48/48")
    expect(panel).toHaveTextContent("72/72")
    expect(panel).toHaveTextContent("0 / pending")
    expect(panel).toHaveTextContent("0 known / 72 TBD")
    expect(panel).toHaveTextContent("72 known / 0 missing")
    expect(panel).toHaveTextContent("48/48")
    expect(panel).toHaveTextContent("Pre-tournament")
    expect(panel).toHaveTextContent("Best-third Round of 32 mapping is gated until FIFA confirms the official table.")
    expect(panel).toHaveTextContent("Partial Ready")
    expect(panel).not.toHaveTextContent("secret-value")
  })

  it("clarifies provider fallback league id warnings in readiness", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => makeReadinessResponse({
        provider: {
          name: "apifootball",
          configured: true,
          apiKeyPresent: true,
          leagueId: "1",
          leagueIdConfigured: false,
          cronSecretPresent: true,
          missingEnvVars: ["API_FOOTBALL_WORLD_CUP_LEAGUE_ID"],
        },
        data: {
          groupsComplete: false,
          assignedTeams: 0,
          incompleteGroups: [],
          fixtureCount: 72,
          groupStageFixtureCount: 72,
          knockoutFixtureCount: 0,
          knockoutFixturesAvailable: false,
          venueKnownCount: 0,
          venueTbdCount: 72,
          kickoffKnownCount: 72,
          kickoffMissingCount: 0,
          standingsRowCount: 48,
          standingsSynced: true,
          standingsState: "pre_tournament",
          thirdPlaceRankingPresent: true,
          liveSyncRouteAvailable: true,
          bestThirdMappingConfigured: false,
          groupStageReady: false,
          knockoutsReady: false,
          productionStatus: "not_ready",
          warnings: [],
        },
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isOwner: false, isAdmin: true }) as any} />)

    const panel = await screen.findByTestId("world-cup-readiness-panel")
    expect(panel).toHaveTextContent("Provider teams grouped")
    expect(panel).toHaveTextContent("0/48")
    expect(panel).toHaveTextContent("App bracket teams seeded")
    expect(panel).toHaveTextContent("48/48")
    expect(panel).toHaveTextContent("Using fallback/default league ID because API_FOOTBALL_WORLD_CUP_LEAGUE_ID is not set.")
  })

  it("shows Rules scoring with champion bonus from the active profile", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="rules" />)

    expect(await screen.findByRole("heading", { name: "Pool Rules" })).toBeInTheDocument()
    // Champion bonus label + value are in a polished side-by-side row;
    // verify the row contains both the label and the points total.
    const championRow = screen.getByText("Champion Bonus").closest("li")
    expect(championRow).not.toBeNull()
    expect(championRow).toHaveTextContent(/320/)
    expect(championRow).toHaveTextContent(/pts/i)
  })

  it("disables admin integrity after a missing route response", async () => {
    clientApiMocks.getIntegrityReport.mockRejectedValueOnce(new Error("Route not found"))
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isAdmin: true }) as any} />)

    const button = await screen.findByRole("button", { name: /Run Integrity Check/i })
    fireEvent.click(button)

    expect(await screen.findByText("Integrity checks are temporarily unavailable from this panel.")).toBeInTheDocument()
    expect(button).toBeDisabled()
  })

  it("refreshes the admin readiness panel from the readiness endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => makeReadinessResponse(),
    }))
    vi.stubGlobal("fetch", fetchMock)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ isAdmin: true }) as any} />)

    await screen.findByTestId("world-cup-readiness-panel")
    fireEvent.click(screen.getByRole("button", { name: /Run readiness check/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/brackets/world-cup/admin/readiness?"),
      expect.objectContaining({ cache: "no-store" })
    )
  })

  it("shows submitted state when the entry is already finalized", async () => {
    clientApiMocks.fetchCompletionReview.mockResolvedValueOnce({
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: true,
      knockoutComplete: true,
      fullEntryComplete: true,
      groupsRankedCount: 12,
      missingGroups: [],
      thirdPlaceSelectedCount: 8,
      missingKnockoutPicks: 0,
      requiredKnockoutPicks: 16,
      completedKnockoutPicks: 16,
      isLocked: false,
      isComplete: true,
      submittedAt: "2026-05-16T12:00:00.000Z",
    })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    expect(await screen.findByText(/Your bracket is locked in/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Finalize Entry/i })).not.toBeInTheDocument()
  })

  it("shows Bracket Grade details for AF Pro users on Review", async () => {
    clientApiMocks.fetchCompletionReview.mockResolvedValueOnce({
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: true,
      knockoutComplete: true,
      fullEntryComplete: true,
      groupsRankedCount: 12,
      missingGroups: [],
      thirdPlaceSelectedCount: 8,
      missingKnockoutPicks: 0,
      requiredKnockoutPicks: 1,
      completedKnockoutPicks: 1,
      isLocked: false,
      isComplete: true,
      submittedAt: null,
    })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ hasBracketBrainAi: true }) as any} defaultTab="review" />)

    const grade = await screen.findByTestId("world-cup-bracket-grade")
    expect(grade).toHaveTextContent("Bracket Grade")
    expect(grade).toHaveTextContent("Risk Level")
    expect(grade).toHaveTextContent("Champion Confidence")
  })

  it("shows locked Bracket Grade details for free users on Review", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ hasBracketBrainAi: false }) as any} defaultTab="review" />)

    const grade = await screen.findByTestId("world-cup-bracket-grade")
    // Per-card "Basic" chip is suppressed inside the report; canonical chip lives at the section header.
    const report = screen.getByTestId("world-cup-review-ai-report")
    expect(within(report).getByTestId("world-cup-review-ai-report-tier").textContent).toMatch(/AF Pro preview/i)
    // The inline locked-detail copy remains as the per-card upsell.
    expect(grade).toHaveTextContent("AF Pro unlocks risk")
  })

  it("shows private path-to-win teaser for free users", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ hasBracketBrainAi: false }) as any} defaultTab="leaderboard" />)

    const panel = await screen.findByTestId("world-cup-path-to-win")
    expect(panel).toHaveTextContent("AF Pro can show your path to win after you finalize.")
    expect(panel).toHaveTextContent("Other users' unfinalized picks stay hidden.")
  })

  it("shows leaderboard AI win probability only for AF Pro users", async () => {
    const leaderboard = [{
      rank: 1,
      entryId: "entry-1",
      entryName: "Bracket 1",
      participantId: "participant-1",
      userId: "user-1",
      username: null,
      avatarUrl: null,
      displayName: "Owner",
      totalScore: 0,
      maxPossibleScore: 480,
      correctPicks: 0,
      incorrectPicks: 0,
      championPickName: "Brazil",
      championTeamId: "demo_team_brazil",
      championStillAlive: true,
      roundBreakdown: {},
      joinedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ hasBracketBrainAi: true, leaderboard }) as any} defaultTab="leaderboard" />)

    expect(await screen.findByTestId("wc-lb-ai-health-entry-1")).toHaveTextContent("AI Win")
    expect(screen.queryByTestId("wc-lb-ai-locked-entry-1")).not.toBeInTheDocument()
  })

  it("refreshes Review after a group-stage save callback", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    await waitFor(() => expect(clientApiMocks.fetchCompletionReview).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(clientApiMocks.fetchGroupStageView).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getAllByRole("button", { name: /Group Stage/i })[0])
    fireEvent.click(await screen.findByRole("button", { name: /Save Group Stub/i }))
    fireEvent.click(screen.getAllByRole("button", { name: /Review/i })[0])

    await waitFor(() => expect(clientApiMocks.fetchCompletionReview).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(clientApiMocks.fetchGroupStageView).toHaveBeenCalledTimes(4))
  })

  it("warns before leaving Group Stage with unsaved group changes", async () => {
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal("confirm", confirm)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="group-stage" initialEntryId="entry-1" />)

    fireEvent.click(await screen.findByRole("button", { name: /Mark Group Dirty Stub/i }))
    fireEvent.click(screen.getAllByRole("button", { name: /Review/i })[0])

    expect(confirm).toHaveBeenCalledWith("You have unsaved group changes. Save before leaving, or your changes will be discarded.")
    expect(screen.getByTestId("world-cup-group-stage-picks")).toBeInTheDocument()
    expect(clientApiMocks.fetchCompletionReview).not.toHaveBeenCalled()
  })

  it("does not warn after Group Stage changes are saved", async () => {
    const confirm = vi.fn()
    vi.stubGlobal("confirm", confirm)
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="group-stage" initialEntryId="entry-1" />)

    fireEvent.click(await screen.findByRole("button", { name: /Mark Group Dirty Stub/i }))
    fireEvent.click(screen.getByRole("button", { name: /Save Group Stub/i }))
    fireEvent.click(screen.getAllByRole("button", { name: /Review/i })[0])

    expect(confirm).not.toHaveBeenCalled()
    await waitFor(() => expect(clientApiMocks.fetchCompletionReview).toHaveBeenCalledWith("c1", "entry-1"))
  })

  it("allows re-finalize after a meaningful edit clears submitted state before lock", async () => {
    clientApiMocks.fetchCompletionReview.mockResolvedValueOnce({
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: true,
      knockoutComplete: true,
      fullEntryComplete: true,
      groupsRankedCount: 12,
      missingGroups: [],
      thirdPlaceSelectedCount: 8,
      missingKnockoutPicks: 0,
      requiredKnockoutPicks: 16,
      completedKnockoutPicks: 16,
      isLocked: false,
      isComplete: true,
      submittedAt: null,
      needsRefinalize: true,
    })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    expect(await screen.findByRole("button", { name: /Re-finalize Entry/i })).toBeEnabled()
  })

  it("refreshes Review after a knockout pick save", async () => {
    const confirm = vi.fn()
    vi.stubGlobal("confirm", confirm)
    const seededMatches = makeShellSeededMatches()
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
      entry: makeShellEntry({ submittedAt: null }),
      pick: savedPick,
      picks: [savedPick],
      isComplete: false,
      view: makeShellView({ matches: seededMatches, picks: [savedPick] }),
    })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ matches: seededMatches }) as any} defaultTab="review" />)

    await waitFor(() => expect(clientApiMocks.fetchCompletionReview).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getAllByRole("button", { name: /Knockouts/i })[0])
    fireEvent.click(await screen.findByRole("button", { name: /Pick Brazil to win/i }))
    await waitFor(() => expect(clientApiMocks.savePick).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole("button", { name: /Review/i })[0])

    expect(confirm).not.toHaveBeenCalled()
    await waitFor(() => expect(clientApiMocks.fetchCompletionReview).toHaveBeenCalledTimes(2))
  })

  it("shows next actionable knockout pick guidance and opens guided picker there", async () => {
    const seededMatches = makeShellSeededMatches()
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
    clientApiMocks.getEntry.mockResolvedValue({ ...makeShellEntry(), picks: [savedPick] })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ matches: seededMatches, picks: [savedPick] }) as any} />)

    expect(await screen.findByTestId("world-cup-knockout-pick-guidance")).toHaveTextContent("1/2 currently available picks complete.")
    expect(screen.getByTestId("world-cup-knockout-pick-guidance")).toHaveTextContent("Next pick: Match 2.")

    fireEvent.click(screen.getAllByRole("button", { name: /Continue Guided Picks/i })[0])

    const dialog = await screen.findByRole("dialog", { name: /Guided Matchup Picker/i })
    expect(within(dialog).getByRole("button", { name: /Pick France to win/i })).toBeInTheDocument()
  })

  it("explains unresolved knockout matchups and dynamic available picks", async () => {
    const seededMatches = makeShellSeededMatches()
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView({ matches: seededMatches }) as any} />)

    expect(await screen.findByTestId("world-cup-knockout-pick-guidance")).toHaveTextContent("0/2 currently available picks complete.")
    expect(screen.getByTestId("world-cup-match-disabled-reason-m17")).toHaveTextContent("Pick earlier round winners first.")
    expect(screen.getByTestId("world-cup-knockout-board-scroll")).toBeInTheDocument()
  })

  it("blocks duplicate clicks while a knockout pick is saving", async () => {
    let resolveSave: (value: unknown) => void = () => {}
    clientApiMocks.savePick.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} />)

    const brazilButton = await screen.findByRole("button", { name: /Pick Brazil to win/i })
    fireEvent.click(brazilButton)
    fireEvent.click(brazilButton)

    expect(clientApiMocks.savePick).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole("button", { name: /Pick Argentina to win/i })).toBeDisabled())

    resolveSave({
      success: true,
      entry: makeShellEntry(),
      pick: {
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
      picks: [],
      isComplete: false,
    })
  })

  it("refreshes Review after finalize succeeds", async () => {
    const finalizedCompletion = {
      challengeId: "c1",
      entryId: "entry-1",
      groupStageComplete: true,
      knockoutComplete: true,
      fullEntryComplete: true,
      groupsRankedCount: 12,
      missingGroups: [],
      thirdPlaceSelectedCount: 8,
      missingKnockoutPicks: 0,
      requiredKnockoutPicks: 16,
      completedKnockoutPicks: 16,
      isLocked: false,
      isComplete: true,
      submittedAt: "2026-05-16T12:00:00.000Z",
    }
    clientApiMocks.fetchCompletionReview.mockResolvedValueOnce({
      ...finalizedCompletion,
      isComplete: false,
      submittedAt: null,
    })
    clientApiMocks.finalizeEntry.mockResolvedValue({
      ok: true,
      entry: makeShellEntry({ isComplete: true, submittedAt: finalizedCompletion.submittedAt }),
      completion: finalizedCompletion,
    })
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="review" />)

    fireEvent.click(await screen.findByRole("button", { name: /Finalize Entry/i }))

    await waitFor(() => expect(clientApiMocks.finalizeEntry).toHaveBeenCalledWith("c1", "entry-1"))
    expect(await screen.findByText(/Your bracket is locked in/i)).toBeInTheDocument()
  })

  it("updates the URL with stable query tab values when switching tabs", async () => {
    const WorldCupBracketShell = (await import("@/components/brackets/world-cup/WorldCupBracketShell")).default
    render(<WorldCupBracketShell initialView={makeShellView() as any} defaultTab="group-stage" initialEntryId="entry-1" />)

    fireEvent.click((await screen.findAllByRole("button", { name: /Knockouts/i }))[0])
    expect(routerMocks.push).toHaveBeenLastCalledWith(expect.stringContaining("tab=knockouts"))

    fireEvent.click(screen.getAllByRole("button", { name: /Review/i })[0])
    expect(routerMocks.push).toHaveBeenLastCalledWith(expect.stringContaining("tab=review"))
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

describe("WorldCupInvitePanel invite gating", () => {
  const baseChallenge = {
    id: "c1",
    name: "Test Pool",
    ownerUserId: "owner-1",
    seasonYear: 2026,
    inviteCode: "WCPOOL99",
    inviteUrl: "https://allfantasy.ai/join/bracket/WCPOOL99",
    visibility: "private" as const,
    pickLockStrategy: "tournament_start" as const,
    pickLockAt: null,
    maxParticipants: 20,
    maxEntriesPerParticipant: 3,
    effectivePickLockAt: null,
    status: "open",
    includeThirdPlace: false,
    knockoutMode: "predictive" as const,
    isTestMode: false,
    simulationEnabled: false,
    simulatedAt: null,
    simulationStatus: null,
    hasSimulatedResults: false,
    lastSyncedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const baseView = {
    challenge: baseChallenge,
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
    leaderboard: [],
    isOwner: false,
    isAdmin: false,
    hasBracketBrainAi: false,
  }

  it("commissioner sees invite code and copy controls", async () => {
    const WorldCupInvitePanel = (await import("@/components/brackets/world-cup/WorldCupInvitePanel")).default
    render(<WorldCupInvitePanel view={baseView as any} isCommissioner={true} />)

    expect(screen.getByTestId("wc-invite-commissioner-panel")).toBeInTheDocument()
    expect(screen.getByTestId("wc-invite-code-display")).toHaveTextContent("WCPOOL99")
    expect(screen.getByTestId("wc-invite-copy-code-btn")).toBeInTheDocument()
    expect(screen.getByTestId("wc-invite-copy-link-btn")).toBeInTheDocument()
    expect(screen.queryByTestId("wc-invite-member-banner")).not.toBeInTheDocument()
  })

  it("member sees commissioner-only banner and no invite code or copy buttons", async () => {
    const WorldCupInvitePanel = (await import("@/components/brackets/world-cup/WorldCupInvitePanel")).default
    render(<WorldCupInvitePanel view={baseView as any} isCommissioner={false} />)

    expect(screen.getByTestId("wc-invite-member-banner")).toBeInTheDocument()
    expect(screen.getByText(/Only the pool commissioner can copy and share the invite link/i)).toBeInTheDocument()
    expect(screen.queryByTestId("wc-invite-commissioner-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("wc-invite-code-display")).not.toBeInTheDocument()
    expect(screen.queryByTestId("wc-invite-copy-code-btn")).not.toBeInTheDocument()
    expect(screen.queryByTestId("wc-invite-copy-link-btn")).not.toBeInTheDocument()
    expect(screen.queryByText("WCPOOL99")).not.toBeInTheDocument()
  })

  it("commissioner sees Pool Details metadata regardless of lock state", async () => {
    const WorldCupInvitePanel = (await import("@/components/brackets/world-cup/WorldCupInvitePanel")).default
    const lockedView = {
      ...baseView,
      challenge: { ...baseChallenge, status: "locked" as const },
      isOwner: true,
    }
    render(<WorldCupInvitePanel view={lockedView as any} isCommissioner={true} />)

    expect(screen.getByTestId("wc-invite-commissioner-panel")).toBeInTheDocument()
    expect(screen.getByTestId("wc-invite-code-display")).toHaveTextContent("WCPOOL99")
    expect(screen.getByText(/This pool is locked/i)).toBeInTheDocument()
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
    expect(screen.getByText(/Finalized entries only/i)).toBeInTheDocument()
    expect(screen.getByTestId("world-cup-share-card-leaderboard")).toHaveTextContent("Current pool leaderboard")
    expect(screen.getByTestId("world-cup-share-preview-leaderboard")).toHaveTextContent("#1 My bracket - 42 pts")
    expect(screen.getByTestId("wc-lb-mobile-score-row")).toBeInTheDocument()
    expect(screen.getByTestId("wc-lb-total-mobile-ent1")).toHaveTextContent("42")
    expect(screen.getByTestId("wc-lb-champion-status-ent1")).toHaveTextContent("Alive")
    // Member should NOT see an active Recalculate button; should see passive "Updates automatically" indicator
    expect(screen.queryByTestId("world-cup-leaderboard-recalculate")).not.toBeInTheDocument()
    expect(screen.getByTestId("world-cup-leaderboard-auto-update")).toHaveTextContent(/Updates automatically/i)
  })

  it("shows Recalculate button to commissioner/owner only", async () => {
    const WorldCupLeaderboard = (await import("@/components/brackets/world-cup/WorldCupLeaderboard")).default
    const baseView = {
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
      leaderboard: [],
      isOwner: true,
      isAdmin: false,
      hasBracketBrainAi: false,
    }
    render(<WorldCupLeaderboard view={baseView as any} onRecalculate={() => {}} />)
    expect(screen.getByTestId("world-cup-leaderboard-recalculate")).toBeInTheDocument()
    expect(screen.queryByTestId("world-cup-leaderboard-auto-update")).not.toBeInTheDocument()
  })
})
