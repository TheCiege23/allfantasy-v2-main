import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { WorldCupMatchupIntelligence } from "@/lib/world-cup/types"

const getIntelMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/world-cup/worldCupClientApi", () => ({
  getWorldCupMatchupIntelligence: getIntelMock,
}))

const baseIntel = (): WorldCupMatchupIntelligence => ({
  matchId: "m1",
  recommendedTeamId: "t1",
  recommendedTeamName: "Brazil",
  recommendedSide: "home",
  homeWinProbability: 0.55,
  awayWinProbability: 0.45,
  confidence: "medium",
  upsetRisk: "medium",
  keyFactors: ["Knockout pace"],
  summary: "Deterministic summary text.",
  safePick: "Brazil",
  contrarianPick: "France",
  projectedScore: null,
  generative: false,
  safePickSide: "home",
  upsetPickSide: "away",
  safePickTeamName: "Brazil",
  upsetPickTeamName: "France",
  riskLevel: "medium",
  recentFormSummary: "Form placeholder.",
  rankingSeedComparison: "Seed notes.",
  bracketImpactIfHomeWins: "If Brazil wins…",
  bracketImpactIfAwayWins: "If France wins…",
  whyThisPickMakesSense: "Why text.",
  howRiskyIsThisPick: "Risk text.",
  whatThisMeansForYourBracket: "Bracket text.",
  narrativesGenerative: false,
})

describe("WorldCupMatchupIntelligencePanel AF Pro gating", () => {
  beforeEach(() => {
    getIntelMock.mockReset()
    getIntelMock.mockResolvedValue(baseIntel())
  })

  it("shows locked card and disables AI-only buttons when user does not have Bracket Brain AI", async () => {
    const WorldCupMatchupIntelligencePanel = (await import(
      "@/components/brackets/world-cup/WorldCupMatchupIntelligencePanel"
    )).default

    render(
      <WorldCupMatchupIntelligencePanel
        challengeId="c1"
        entryId="e1"
        matchId="m1"
        homeName="Brazil"
        awayName="France"
        disabled={false}
        hasBracketBrainAi={false}
        stagedSide={null}
        onStageSide={() => {}}
        onUseThisPick={() => {}}
      />
    )

    expect(await screen.findByTestId("wc-bracket-brain-locked-card")).toBeInTheDocument()
    expect(screen.getByTestId("wc-ai-ask-button")).toBeDisabled()
    expect(screen.getByTestId("wc-ai-explain-button")).toBeDisabled()
    expect(screen.getByText(/Basic stats \(non-AI\)/i)).toBeInTheDocument()
  })

  it("does not show locked card when user has Bracket Brain AI", async () => {
    const WorldCupMatchupIntelligencePanel = (await import(
      "@/components/brackets/world-cup/WorldCupMatchupIntelligencePanel"
    )).default

    render(
      <WorldCupMatchupIntelligencePanel
        challengeId="c1"
        entryId="e1"
        matchId="m1"
        homeName="Brazil"
        awayName="France"
        disabled={false}
        hasBracketBrainAi
        stagedSide={null}
        onStageSide={() => {}}
        onUseThisPick={() => {}}
      />
    )

    await screen.findByTestId("world-cup-matchup-intelligence-panel")
    expect(screen.queryByTestId("wc-bracket-brain-locked-card")).not.toBeInTheDocument()
    expect(screen.queryByText(/Basic stats \(non-AI\)/i)).not.toBeInTheDocument()
    expect(screen.getByTestId("wc-ai-ask-button")).not.toBeDisabled()
    expect(screen.getByTestId("wc-ai-explain-button")).not.toBeDisabled()
  })

  it("uses the shared flag fallback for matchup display", async () => {
    const WorldCupMatchupIntelligencePanel = (await import(
      "@/components/brackets/world-cup/WorldCupMatchupIntelligencePanel"
    )).default

    render(
      <WorldCupMatchupIntelligencePanel
        challengeId="c1"
        entryId="e1"
        matchId="m1"
        homeName="Brazil"
        awayName="France"
        homeLogo="https://flagcdn.com/w80/br.png"
        awayLogo={null}
        disabled={false}
        hasBracketBrainAi
        stagedSide={null}
        onStageSide={() => {}}
        onUseThisPick={() => {}}
      />
    )

    await screen.findByTestId("world-cup-matchup-intelligence-panel")
    expect(screen.getByAltText("Brazil flag")).toBeInTheDocument()
    // France has no flagUrl here — the fixed fallback now derives the emoji
    // 🇫🇷 (FRA → FR) instead of the legacy code badge "FRA". Verify the
    // flag renders in any form (image, emoji, or code) with the correct label.
    expect(screen.getByRole("img", { name: /France flag/i })).toBeInTheDocument()
  })
})

describe("WorldCupMatchupCard AI insight entrypoint", () => {
  const match = {
    id: "m1",
    matchNumber: 1,
    round: "round_of_32",
    region: "left",
    homeSlotKey: "A1",
    awaySlotKey: "B2",
    homeTeamId: "bra",
    awayTeamId: "fra",
    homeTeamName: "Brazil",
    awayTeamName: "France",
    homeTeamLogo: null,
    awayTeamLogo: null,
    homeScore: null,
    awayScore: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    winnerTeamId: null,
    winnerTeamName: null,
    startsAt: "2026-06-01T00:00:00.000Z",
    status: "scheduled",
    apiStatusShort: null,
    venueName: "Stadium",
    venueCity: "City",
  } as any

  it("shows locked matchup AI CTA without opening detailed insights", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    render(<WorldCupMatchupCard match={match} aiInsightsUnlocked={false} />)

    const card = screen.getByTestId("world-cup-match-ai-insight-m1")
    expect(within(card).getByText("Locked")).toBeInTheDocument()
    expect(within(card).getByText(/Locked users do not trigger AI calls/i)).toBeInTheDocument()
    expect(within(card).queryByText(/Safer pick/i)).toBeNull()
  })

  it("opens deterministic matchup insights for AI/Pro users with safe copy", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    render(<WorldCupMatchupCard match={match} aiInsightsUnlocked />)

    const card = screen.getByTestId("world-cup-match-ai-insight-m1")
    fireEvent.click(within(card).getByText("AI Insights"))

    expect(within(card).getByText(/Safer pick/i)).toBeInTheDocument()
    expect(within(card).getByText(/Upside pick/i)).toBeInTheDocument()
    expect(card.textContent?.toLowerCase()).toContain("bracket guidance stays limited to pool picks and scoring mechanics")
    expect(card.textContent?.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager/)
  })

  it("hides confidence selector when disabled", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    render(<WorldCupMatchupCard match={match} />)

    expect(screen.queryByTestId("wc-match-confidence-selector-m1")).not.toBeInTheDocument()
  })

  it("renders mobile confidence selector and saves confidence with the pick", async () => {
    const WorldCupMatchupCard = (await import("@/components/brackets/world-cup/WorldCupMatchupCard")).default
    const onPick = vi.fn()
    render(
      <WorldCupMatchupCard
        match={match}
        confidenceScoringEnabled
        onPick={onPick}
      />
    )

    const selector = screen.getByTestId("wc-match-confidence-selector-m1")
    expect(within(selector).getByText(/Higher confidence means more bonus points if correct/i)).toBeInTheDocument()
    expect(within(selector).getByRole("combobox")).toHaveClass("min-h-10")

    fireEvent.change(within(selector).getByRole("combobox"), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: /Pick Brazil to win/i }))

    expect(onPick).toHaveBeenCalledWith(match, "home", 5)
    expect(selector.textContent?.toLowerCase()).not.toMatch(/\bdfs\b|\bbetting\b|\bwager/)
  })
})
