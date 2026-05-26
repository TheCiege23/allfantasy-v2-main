import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const clientApiMocks = vi.hoisted(() => ({
  fetchGroupStageView: vi.fn(),
  saveGroupRanking: vi.fn(),
  saveThirdPlaceAdvancers: vi.fn(),
}))

vi.mock("@/lib/world-cup/worldCupClientApi", () => ({
  fetchWorldCupGroupStageView: clientApiMocks.fetchGroupStageView,
  saveWorldCupGroupRankingClient: clientApiMocks.saveGroupRanking,
  saveWorldCupThirdPlaceAdvancersClient: clientApiMocks.saveThirdPlaceAdvancers,
}))

function makeGroupStageView(overrides: Record<string, unknown> = {}) {
  const group = {
    id: "group-a",
    groupKey: "A",
    displayName: "Group A",
    sortOrder: 1,
    teams: [
      { id: "gt-1", teamId: "team-a", name: "Argentina", country: "Argentina", fifaCode: "ARG", flagUrl: null, logoUrl: null, seedOrder: 1, actualRank: null, points: null, goalDifference: null, goalsFor: null },
      { id: "gt-2", teamId: "team-b", name: "Brazil", country: "Brazil", fifaCode: "BRA", flagUrl: null, logoUrl: null, seedOrder: 2, actualRank: null, points: null, goalDifference: null, goalsFor: null },
      { id: "gt-3", teamId: "team-c", name: "Canada", country: "Canada", fifaCode: "CAN", flagUrl: null, logoUrl: null, seedOrder: 3, actualRank: null, points: null, goalDifference: null, goalsFor: null },
      { id: "gt-4", teamId: "team-d", name: "Denmark", country: "Denmark", fifaCode: "DEN", flagUrl: null, logoUrl: null, seedOrder: 4, actualRank: null, points: null, goalDifference: null, goalsFor: null },
    ],
  }
  return {
    challengeId: "c1",
    entryId: "entry-1",
    groups: [group],
    groupRankingPicks: [
      { id: "grp-1", groupId: "group-a", teamId: "team-a", predictedRank: 1, actualRank: null, isCorrect: null, pointsAwarded: 0 },
      { id: "grp-2", groupId: "group-a", teamId: "team-b", predictedRank: 2, actualRank: null, isCorrect: null, pointsAwarded: 0 },
      { id: "grp-3", groupId: "group-a", teamId: "team-c", predictedRank: 3, actualRank: null, isCorrect: null, pointsAwarded: 0 },
      { id: "grp-4", groupId: "group-a", teamId: "team-d", predictedRank: 4, actualRank: null, isCorrect: null, pointsAwarded: 0 },
    ],
    thirdPlaceAdvancerPicks: [],
    completion: {
      groupsRankedCount: 1,
      allGroupsRanked: false,
      thirdPlaceSelectedCount: 0,
      thirdPlaceComplete: false,
      groupStageComplete: false,
    },
    lock: { isLocked: false, lockReason: null },
    warnings: [],
    ...overrides,
  }
}

describe("WorldCupGroupStagePicks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientApiMocks.fetchGroupStageView.mockResolvedValue(makeGroupStageView())
    clientApiMocks.saveGroupRanking.mockResolvedValue(makeGroupStageView({
      groupRankingPicks: [
        { id: "grp-1", groupId: "group-a", teamId: "team-b", predictedRank: 1, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-2", groupId: "group-a", teamId: "team-a", predictedRank: 2, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-3", groupId: "group-a", teamId: "team-c", predictedRank: 3, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-4", groupId: "group-a", teamId: "team-d", predictedRank: 4, actualRank: null, isCorrect: null, pointsAwarded: 0 },
      ],
    }))
  })

  it("marks a reordered group dirty and requires Save Group before Review counts it", async () => {
    const onCompletionChanged = vi.fn()
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" onCompletionChanged={onCompletionChanged} />)

    const group = await screen.findByTestId("world-cup-group-A")
    // Fix 4: "Save as-is" button is now enabled even when no local changes exist
    expect(within(group).getByRole("button", { name: /Saved/i })).toBeEnabled()

    fireEvent.click(within(group).getAllByRole("button", { name: /Move Up/i })[1])

    expect(within(group).getByText(/Unsaved order change/i)).toBeInTheDocument()
    const saveButton = within(group).getByRole("button", { name: /Save Group/i })
    expect(saveButton).toBeEnabled()
    expect(onCompletionChanged).not.toHaveBeenCalled()

    fireEvent.click(saveButton)

    await waitFor(() => expect(clientApiMocks.saveGroupRanking).toHaveBeenCalledWith(
      "c1",
      "entry-1",
      "group-a",
      ["team-b", "team-a", "team-c", "team-d"],
    ))
    await waitFor(() => expect(onCompletionChanged).toHaveBeenCalledTimes(1))
  })

  it("shows locked AI CTA near Save Group for free users without opening detailed insights", async () => {
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" aiInsightsUnlocked={false} />)

    const group = await screen.findByTestId("world-cup-group-A")
    expect(within(group).getByText("AI Insights")).toBeInTheDocument()
    expect(within(group).getByText("Locked")).toBeInTheDocument()
    expect(within(group).getByText(/No AI is called while this is locked/i)).toBeInTheDocument()
    expect(within(group).queryByText(/Safest group winner/i)).toBeNull()
    expect(within(group).getByText("AI Insights").compareDocumentPosition(within(group).getByRole("button", { name: /Saved/i }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("opens deterministic group AI insights for AI/Pro users without betting copy", async () => {
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" aiInsightsUnlocked />)

    const group = await screen.findByTestId("world-cup-group-A")
    fireEvent.click(within(group).getByText("AI Insights"))

    // Seeded chalk: user picked seedOrder 1→1, 2→2, 3→3, 4→4 → produces "Safest group winner" and "pure chalk" lines.
    expect(within(group).getByText(/Safest group winner/i)).toBeInTheDocument()
    // Argentina appears as a team card too — use the specific insight line test id instead.
    expect(within(group).getByTestId("world-cup-group-ai-insight-line-0").textContent).toMatch(/Argentina/i)
    expect(within(group).getByText(/Strategy: pure chalk/i)).toBeInTheDocument()
    expect(within(group).getByText(/Prediction and scoring complexity only/i)).toBeInTheDocument()
    expect(group.textContent?.toLowerCase()).not.toContain("dfs advice")
    expect(group.textContent?.toLowerCase()).not.toContain("wagering advice")
    expect(group.textContent?.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("ignores rapid duplicate group save clicks while the first request is in flight", async () => {
    let resolveSave: (value: ReturnType<typeof makeGroupStageView>) => void = () => {}
    clientApiMocks.saveGroupRanking.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const group = await screen.findByTestId("world-cup-group-A")
    fireEvent.click(within(group).getAllByRole("button", { name: /Move Up/i })[1])
    const saveButton = within(group).getByRole("button", { name: /Save Group/i })

    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    expect(clientApiMocks.saveGroupRanking).toHaveBeenCalledTimes(1)
    resolveSave(makeGroupStageView())
    // Fix 4: "Saved" button stays enabled after save completes (save-as-is is allowed)
    await waitFor(() => expect(within(group).getByRole("button", { name: /Saved/i })).toBeEnabled())
  })

  it("no-op group save is enabled but does not call the API when order matches server", async () => {
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const group = await screen.findByTestId("world-cup-group-A")
    // Fix 4: save-as-is is now allowed — button stays enabled
    const saveBtn = within(group).getByRole("button", { name: /Saved/i })
    expect(saveBtn).toBeEnabled()
    // Clicking when order already matches server must NOT call the API
    fireEvent.click(saveBtn)
    expect(clientApiMocks.saveGroupRanking).not.toHaveBeenCalled()
  })

  it("renders group ranking result borders from saved pick scoring", async () => {
    clientApiMocks.fetchGroupStageView.mockResolvedValue(makeGroupStageView({
      groups: [{
        id: "group-a",
        groupKey: "A",
        displayName: "Group A",
        sortOrder: 1,
        teams: [
          { id: "gt-1", teamId: "team-a", name: "Argentina", country: "Argentina", fifaCode: "ARG", flagUrl: null, logoUrl: null, seedOrder: 1, actualRank: 1, points: 9, goalDifference: 4, goalsFor: 6 },
          { id: "gt-2", teamId: "team-b", name: "Brazil", country: "Brazil", fifaCode: "BRA", flagUrl: null, logoUrl: null, seedOrder: 2, actualRank: 3, points: 4, goalDifference: 0, goalsFor: 3 },
          { id: "gt-3", teamId: "team-c", name: "Canada", country: "Canada", fifaCode: "CAN", flagUrl: null, logoUrl: null, seedOrder: 3, actualRank: null, points: null, goalDifference: null, goalsFor: null },
          { id: "gt-4", teamId: "team-d", name: "Denmark", country: "Denmark", fifaCode: "DEN", flagUrl: null, logoUrl: null, seedOrder: 4, actualRank: 4, points: 0, goalDifference: -5, goalsFor: 1 },
        ],
      }],
      groupRankingPicks: [
        { id: "grp-1", groupId: "group-a", teamId: "team-a", predictedRank: 1, actualRank: 1, isCorrect: true, pointsAwarded: 5 },
        { id: "grp-2", groupId: "group-a", teamId: "team-b", predictedRank: 2, actualRank: 3, isCorrect: false, pointsAwarded: 0 },
        { id: "grp-3", groupId: "group-a", teamId: "team-c", predictedRank: 3, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-4", groupId: "group-a", teamId: "team-d", predictedRank: 4, actualRank: 4, isCorrect: true, pointsAwarded: 5 },
      ],
    }))

    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    expect(await screen.findByTestId("world-cup-group-pick-result-A-team-a")).toHaveAttribute("data-result-state", "correct")
    expect(screen.getByTestId("world-cup-group-pick-result-A-team-a")).toHaveTextContent("Correct +5")
    expect(screen.getByTestId("world-cup-group-pick-result-A-team-b")).toHaveAttribute("data-result-state", "wrong")
    expect(screen.getByTestId("world-cup-group-pick-result-A-team-b")).toHaveTextContent("Wrong +0")
    expect(screen.getByTestId("world-cup-group-pick-result-A-team-c")).toHaveAttribute("data-result-state", "pending")
    expect(screen.getByTestId("world-cup-group-pick-result-A-team-c")).toHaveTextContent("Pending")
  })

  it("renders third-place advancer result borders from saved pick scoring", async () => {
    clientApiMocks.fetchGroupStageView.mockResolvedValue(makeGroupStageView({
      completion: {
        groupsRankedCount: 12,
        allGroupsRanked: true,
        thirdPlaceSelectedCount: 2,
        thirdPlaceComplete: false,
        groupStageComplete: false,
      },
      thirdPlaceAdvancerPicks: [
        { id: "tp-1", groupId: "group-a", teamId: "team-c", isSelected: true, actualAdvanced: true, isCorrect: true, pointsAwarded: 5 },
        { id: "tp-2", groupId: "group-a", teamId: "team-d", isSelected: true, actualAdvanced: false, isCorrect: false, pointsAwarded: 0 },
      ],
    }))

    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const thirdPlace = await screen.findByTestId("world-cup-third-place-result-A")
    expect(thirdPlace).toHaveAttribute("data-result-state", "correct")
    expect(thirdPlace).toHaveAttribute("data-selected", "true")
    expect(thirdPlace).toHaveTextContent("Selected to advance")
    expect(thirdPlace).toHaveTextContent("Correct +5")
  })

  it("derives third-place candidates from each group's rank-3 team", async () => {
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const thirdPlace = await screen.findByTestId("world-cup-third-place-result-A")
    expect(within(thirdPlace).getByText("Canada")).toBeInTheDocument()
    expect(within(thirdPlace).queryByText("Argentina")).not.toBeInTheDocument()
    expect(within(thirdPlace).queryByText("Brazil")).not.toBeInTheDocument()
    expect(within(thirdPlace).queryByText("Denmark")).not.toBeInTheDocument()
    // Third-place cards are now <button aria-pressed> elements (label→button conversion for mobile double-tap fix).
    // The card itself IS the interactive control — verify it has the correct accessible name.
    expect(thirdPlace.tagName.toLowerCase()).toBe("button")
    expect(thirdPlace).toHaveAccessibleName(/Select Canada as a third-place advancer/i)
  })

  it("makes selected third-place advancer cards obvious on mobile/dark UI", async () => {
    clientApiMocks.fetchGroupStageView.mockResolvedValue(makeGroupStageView({
      completion: {
        groupsRankedCount: 12,
        allGroupsRanked: true,
        thirdPlaceSelectedCount: 1,
        thirdPlaceComplete: false,
        groupStageComplete: false,
      },
      thirdPlaceAdvancerPicks: [
        { id: "tp-1", groupId: "group-a", teamId: "team-c", isSelected: true, actualAdvanced: null, isCorrect: null, pointsAwarded: 0 },
      ],
    }))

    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const selectedCard = await screen.findByTestId("world-cup-third-place-result-A")
    expect(selectedCard).toHaveAttribute("data-selected", "true")
    expect(selectedCard.className).toContain("bg-cyan-300/[0.18]")
    expect(selectedCard.className).toContain("border-cyan-200")
    expect(within(selectedCard).getByText("Selected to advance")).toBeInTheDocument()
    // After label→button conversion, "checked" state is expressed via aria-pressed.
    expect(selectedCard).toHaveAttribute("aria-pressed", "true")
  })

  it("ignores rapid duplicate third-place saves while the first request is in flight", async () => {
    const completeView = makeGroupStageView({
      completion: {
        groupsRankedCount: 12,
        allGroupsRanked: true,
        thirdPlaceSelectedCount: 0,
        thirdPlaceComplete: false,
        groupStageComplete: false,
      },
      groups: Array.from({ length: 12 }, (_, index) => ({
        id: `group-${index}`,
        groupKey: String.fromCharCode(65 + index),
        displayName: `Group ${String.fromCharCode(65 + index)}`,
        sortOrder: index + 1,
        teams: [
          { id: `gt-${index}-1`, teamId: `team-${index}-1`, name: `Team ${index} 1`, country: "Country", fifaCode: null, flagUrl: null, logoUrl: null, seedOrder: 1, actualRank: null, points: null, goalDifference: null, goalsFor: null },
          { id: `gt-${index}-2`, teamId: `team-${index}-2`, name: `Team ${index} 2`, country: "Country", fifaCode: null, flagUrl: null, logoUrl: null, seedOrder: 2, actualRank: null, points: null, goalDifference: null, goalsFor: null },
          { id: `gt-${index}-3`, teamId: `team-${index}-3`, name: `Team ${index} 3`, country: "Country", fifaCode: null, flagUrl: null, logoUrl: null, seedOrder: 3, actualRank: null, points: null, goalDifference: null, goalsFor: null },
          { id: `gt-${index}-4`, teamId: `team-${index}-4`, name: `Team ${index} 4`, country: "Country", fifaCode: null, flagUrl: null, logoUrl: null, seedOrder: 4, actualRank: null, points: null, goalDifference: null, goalsFor: null },
        ],
      })),
      groupRankingPicks: Array.from({ length: 12 }).flatMap((_, index) => [1, 2, 3, 4].map((rank) => ({
        id: `grp-${index}-${rank}`,
        groupId: `group-${index}`,
        teamId: `team-${index}-${rank}`,
        predictedRank: rank,
        actualRank: null,
        isCorrect: null,
        pointsAwarded: 0,
      }))),
    })
    clientApiMocks.fetchGroupStageView.mockResolvedValue(completeView)
    let resolveSave: (value: ReturnType<typeof makeGroupStageView>) => void = () => {}
    clientApiMocks.saveThirdPlaceAdvancers.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const selectedCards = await screen.findAllByText("Tap to select")
    selectedCards.slice(0, 8).forEach((el) => {
      // Text lives inside a <button>; closest("button") reaches the clickable card.
      fireEvent.click(el.closest("button") as HTMLElement)
    })
    const saveButton = screen.getByRole("button", { name: /^Save Third-Place$/i })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    expect(clientApiMocks.saveThirdPlaceAdvancers).toHaveBeenCalledTimes(1)
    resolveSave(completeView)
    await waitFor(() => expect(screen.getByText(/Third-place picks saved/i)).toBeInTheDocument())
  })

  it("shows third-place Ask Chimmy CTA with mobile-friendly full width save controls", async () => {
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" aiInsightsUnlocked={false} />)

    await screen.findByTestId("world-cup-third-place-ai-insight")
    expect(screen.getByText("Ask Chimmy")).toBeInTheDocument()
    expect(screen.getByText(/AI\/Pro unlocks third-place selection insights/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Save Third-Place Advancers/i }).className).toContain("w-full")
  })

  it("Issue 3 — saving one group does not clobber local order of a concurrently edited group", async () => {
    // Two groups: A already ranked, B has live local edits when A's save resolves
    const twoGroupView = makeGroupStageView({
      groups: [
        makeGroupStageView().groups[0],
        {
          id: "group-b",
          groupKey: "B",
          displayName: "Group B",
          sortOrder: 2,
          teams: [
            { id: "gt-5", teamId: "team-e", name: "England", country: "England", fifaCode: "ENG", flagUrl: null, logoUrl: null, seedOrder: 1, actualRank: null, points: null, goalDifference: null, goalsFor: null },
            { id: "gt-6", teamId: "team-f", name: "France", country: "France", fifaCode: "FRA", flagUrl: null, logoUrl: null, seedOrder: 2, actualRank: null, points: null, goalDifference: null, goalsFor: null },
            { id: "gt-7", teamId: "team-g", name: "Germany", country: "Germany", fifaCode: "GER", flagUrl: null, logoUrl: null, seedOrder: 3, actualRank: null, points: null, goalDifference: null, goalsFor: null },
            { id: "gt-8", teamId: "team-h", name: "Honduras", country: "Honduras", fifaCode: "HON", flagUrl: null, logoUrl: null, seedOrder: 4, actualRank: null, points: null, goalDifference: null, goalsFor: null },
          ],
        },
      ],
      groupRankingPicks: [
        { id: "grp-1", groupId: "group-a", teamId: "team-a", predictedRank: 1, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-2", groupId: "group-a", teamId: "team-b", predictedRank: 2, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-3", groupId: "group-a", teamId: "team-c", predictedRank: 3, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-4", groupId: "group-a", teamId: "team-d", predictedRank: 4, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-5", groupId: "group-b", teamId: "team-e", predictedRank: 1, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-6", groupId: "group-b", teamId: "team-f", predictedRank: 2, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-7", groupId: "group-b", teamId: "team-g", predictedRank: 3, actualRank: null, isCorrect: null, pointsAwarded: 0 },
        { id: "grp-8", groupId: "group-b", teamId: "team-h", predictedRank: 4, actualRank: null, isCorrect: null, pointsAwarded: 0 },
      ],
    })
    let resolveGroupASave!: (v: ReturnType<typeof makeGroupStageView>) => void
    clientApiMocks.fetchGroupStageView.mockResolvedValue(twoGroupView)
    clientApiMocks.saveGroupRanking.mockReturnValue(new Promise((resolve) => {
      resolveGroupASave = resolve
    }))

    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const groupA = await screen.findByTestId("world-cup-group-A")
    const groupB = await screen.findByTestId("world-cup-group-B")

    // Reorder group A and start saving
    fireEvent.click(within(groupA).getAllByRole("button", { name: /Move Up/i })[1])
    fireEvent.click(within(groupA).getByRole("button", { name: /Save Group/i }))

    // While group A is saving, reorder group B
    fireEvent.click(within(groupB).getAllByRole("button", { name: /Move Up/i })[1])
    // Group B is now dirty — France moved to #1 in local state

    // Resolve group A save
    resolveGroupASave(twoGroupView)
    await waitFor(() => expect(within(groupA).getByRole("button", { name: /Saved/i })).toBeEnabled())

    // Group B's reordered state must still be visible (not clobbered)
    const groupBRows = within(groupB).getAllByTestId(/world-cup-group-pick-result-B/)
    expect(groupBRows[0]).toHaveTextContent("France")
    expect(groupBRows[1]).toHaveTextContent("England")
  })

  it("Issue 5 — shows Continue to Knockout Picks button when allGroupsRanked and prop provided", async () => {
    const completeView = makeGroupStageView({
      completion: {
        groupsRankedCount: 12,
        allGroupsRanked: true,
        thirdPlaceSelectedCount: 0,
        thirdPlaceComplete: false,
        groupStageComplete: false,
      },
    })
    clientApiMocks.fetchGroupStageView.mockResolvedValue(completeView)
    const onNavigate = vi.fn()

    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" onNavigateToKnockouts={onNavigate} />)

    const btn = await screen.findByTestId("world-cup-group-stage-continue-to-knockouts")
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it("Issue 5 — Continue to Knockout Picks button is hidden when allGroupsRanked is false", async () => {
    const onNavigate = vi.fn()
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" onNavigateToKnockouts={onNavigate} />)

    await screen.findByTestId("world-cup-group-A")
    expect(screen.queryByTestId("world-cup-group-stage-continue-to-knockouts")).not.toBeInTheDocument()
  })

  it("Issue 5 — Continue button absent when onNavigateToKnockouts prop not provided", async () => {
    const completeView = makeGroupStageView({
      completion: { groupsRankedCount: 12, allGroupsRanked: true, thirdPlaceSelectedCount: 0, thirdPlaceComplete: false, groupStageComplete: false },
    })
    clientApiMocks.fetchGroupStageView.mockResolvedValue(completeView)

    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    await screen.findByTestId("world-cup-group-A")
    expect(screen.queryByTestId("world-cup-group-stage-continue-to-knockouts")).not.toBeInTheDocument()
  })

  it("Issue 6 — team rows render a flag element for each team", async () => {
    const WorldCupGroupStagePicks = (await import("@/components/brackets/world-cup/WorldCupGroupStagePicks")).default
    render(<WorldCupGroupStagePicks challengeId="c1" entryId="entry-1" />)

    const group = await screen.findByTestId("world-cup-group-A")
    // WorldCupTeamFlag renders a span with aria-label like "Argentina country code ARG"
    const flagElements = within(group).queryAllByLabelText(/country code/i)
    expect(flagElements.length).toBeGreaterThanOrEqual(4)
  })
})
