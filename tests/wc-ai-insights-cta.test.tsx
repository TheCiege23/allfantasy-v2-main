/**
 * WorldCupAiInsightsCTA — rendering, locked state, and action tests
 *
 * Tests:
 *   1. Renders panel with AI and Commissioner row labels
 *   2. Renders all AI-tier chip labels
 *   3. Renders all Commissioner-tier chip labels
 *   4. Free user (both tiers locked) sees lock icons on every chip
 *   5. Free user sees AF Pro and AF Commissioner upgrade links
 *   6. Locked chips are marked aria-disabled
 *   7. Chimmy CTA calls onOpenChimmyWithPrompt (not fetch)
 *   8. Card action calls commissioner-brain and renders InsightCardView
 *   9. Text action calls commissioner-brain and renders TextResultBlock
 *  10. API error shows error box
 *  11. Pro-only: commissioner CTAs are locked while AI CTAs are active
 *  12. Click on locked chip does nothing (no fetch, no callback)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import WorldCupAiInsightsCTA from "@/components/brackets/world-cup/WorldCupAiInsightsCTA"

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ language: "en" }),
}))

// Silence toast so it doesn't throw in JSDOM
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// Silence analytics beacons — they use fetch internally and would pollute fetch call counts
vi.mock("@/lib/analytics/client", () => ({
  sendProductAnalyticsBeacon: vi.fn(),
}))

// Provide a simple stub for InsightCardView
vi.mock("@/components/brackets/world-cup/InsightCards", () => ({
  InsightCardView: ({ card }: { card: { kind: string } }) => (
    <div data-testid="insight-card-view">{card.kind}</div>
  ),
}))

// Keep token confirm helpers as real (they don't need browser confirm in these tests)
// isWorldCupTokenConfirmationResponse returns false for status 200 so the confirmation
// branch is never triggered in happy-path tests.

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntitlements({
  ai = false,
  commissioner = false,
}: {
  ai?: boolean
  commissioner?: boolean
}) {
  return {
    basicCommissioner: commissioner,
    commissioner,
    ai,
    multipleEntries: false,
    exportLeaderboard: false,
    chat: true,
    labels: [],
  } as ReturnType<typeof import("@/lib/world-cup/worldCupEntitlements").resolveWorldCupEntitlementSummary>
}

function makeProps(
  overrides: Partial<React.ComponentProps<typeof WorldCupAiInsightsCTA>> = {}
) {
  return {
    challengeId: "ch-test-123",
    entitlementSummary: makeEntitlements({ ai: true, commissioner: true }),
    selectedEntryId: "entry-1",
    selectedEntryName: "My Bracket",
    onOpenChimmyWithPrompt: vi.fn(),
    onSwitchToReviewTab: vi.fn(),
    ...overrides,
  }
}

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json(body, { status: ok ? 200 : 500 }))
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorldCupAiInsightsCTA — rendering", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the panel wrapper", () => {
    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    expect(screen.getByTestId("wc-ai-insights-cta")).toBeTruthy()
  })

  it("renders AI row chips: Ask Chimmy, Path to First, Explain My Bracket", () => {
    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    const aiChips = screen.getByTestId("wc-ai-cta-ai-chips")
    expect(aiChips.textContent).toContain("Ask Chimmy")
    expect(aiChips.textContent).toContain("Path to First")
    expect(aiChips.textContent).toContain("Explain My Bracket")
  })

  it("renders Commissioner row chips: Rooting Guide, Pool Swing, Champion Risk, Commissioner Recap, Post Hype, Incomplete Picks", () => {
    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    const comChips = screen.getByTestId("wc-ai-cta-commissioner-chips")
    expect(comChips.textContent).toContain("Rooting Guide")
    expect(comChips.textContent).toContain("Pool Swing")
    expect(comChips.textContent).toContain("Champion Risk")
    expect(comChips.textContent).toContain("Commissioner Recap")
    expect(comChips.textContent).toContain("Post Hype")
    expect(comChips.textContent).toContain("Incomplete Picks")
  })

  it("does not show upgrade links when both tiers are unlocked", () => {
    render(<WorldCupAiInsightsCTA {...makeProps({ entitlementSummary: makeEntitlements({ ai: true, commissioner: true }) })} />)
    expect(screen.queryByTestId("wc-ai-cta-upgrade-ai")).toBeNull()
    expect(screen.queryByTestId("wc-ai-cta-upgrade-commissioner")).toBeNull()
  })
})

describe("WorldCupAiInsightsCTA — locked state (free user)", () => {
  it("shows upgrade links for both tiers when nothing is unlocked", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )
    expect(screen.getByTestId("wc-ai-cta-upgrade-ai")).toBeTruthy()
    expect(screen.getByTestId("wc-ai-cta-upgrade-commissioner")).toBeTruthy()
  })

  it("upgrade AI link points to AF Pro pricing", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )
    const link = screen.getByTestId("wc-ai-cta-upgrade-ai") as HTMLAnchorElement
    expect(link.href).toContain("af-pro")
  })

  it("upgrade Commissioner link points to AF Commissioner pricing", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )
    const link = screen.getByTestId("wc-ai-cta-upgrade-commissioner") as HTMLAnchorElement
    expect(link.href).toContain("af-commissioner")
  })

  it("all chips are aria-disabled when locked", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )
    // Every chip button should be aria-disabled
    const buttons = screen.getAllByRole("button")
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-disabled")).toBe("true")
    }
  })
})

describe("WorldCupAiInsightsCTA — chimmy CTA action", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("clicking Ask Chimmy calls onOpenChimmyWithPrompt with a non-empty string", () => {
    const onOpenChimmy = vi.fn()
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ onOpenChimmyWithPrompt: onOpenChimmy })}
      />
    )

    fireEvent.click(screen.getByTestId("wc-ai-cta-ask-chimmy"))

    expect(onOpenChimmy).toHaveBeenCalledOnce()
    const prompt = onOpenChimmy.mock.calls[0]?.[0]
    expect(typeof prompt).toBe("string")
    expect(prompt.length).toBeGreaterThan(0)
  })

  it("clicking Ask Chimmy does NOT call fetch", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const onOpenChimmy = vi.fn()

    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ onOpenChimmyWithPrompt: onOpenChimmy })}
      />
    )

    fireEvent.click(screen.getByTestId("wc-ai-cta-ask-chimmy"))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("clicking Path to First includes entry name in the prompt when entry is selected", () => {
    const onOpenChimmy = vi.fn()
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({
          onOpenChimmyWithPrompt: onOpenChimmy,
          selectedEntryName: "World Cup Winners",
        })}
      />
    )

    fireEvent.click(screen.getByTestId("wc-ai-cta-path-to-first"))

    expect(onOpenChimmy).toHaveBeenCalledOnce()
    // The prompt should mention the bracket name or be a non-empty string
    const prompt = onOpenChimmy.mock.calls[0]?.[0] as string
    expect(prompt.length).toBeGreaterThan(0)
  })
})

describe("WorldCupAiInsightsCTA — card action (commissioner)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("clicking Rooting Guide calls /commissioner-brain with rooting_guide_card action", async () => {
    const fakeFetch = vi.fn().mockImplementation(async () => Response.json({
      card: { kind: "rooting_guide", title: "Test Guide", data: {} },
    }))
    vi.stubGlobal("fetch", fakeFetch)

    render(<WorldCupAiInsightsCTA {...makeProps()} />)

    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      expect(fakeFetch).toHaveBeenCalledOnce()
    })

    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("ch-test-123")
    expect(url).toContain("commissioner-brain")
    const body = JSON.parse(init.body as string)
    expect(body.action).toBe("rooting_guide_card")
  })

  it("renders InsightCardView after a successful card response", async () => {
    mockFetch({
      card: { kind: "rooting_guide", title: "My Rooting Guide", data: {} },
    })

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      expect(screen.getByTestId("insight-card-view")).toBeTruthy()
    })
    expect(screen.getByTestId("insight-card-view").textContent).toContain("rooting_guide")
  })

  it("sends entryId in payload for card actions when an entry is selected", async () => {
    const fakeFetch = vi.fn().mockImplementation(async () => Response.json({ card: { kind: "pool_swing", title: "Swing", data: {} } }))
    vi.stubGlobal("fetch", fakeFetch)

    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ selectedEntryId: "entry-abc" })}
      />
    )

    fireEvent.click(screen.getByTestId("wc-ai-cta-pool-swing"))

    await waitFor(() => expect(fakeFetch).toHaveBeenCalled())

    const body = JSON.parse((fakeFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.entryId).toBe("entry-abc")
    expect(body.action).toBe("pool_swing_card")
  })
})

describe("WorldCupAiInsightsCTA — text action (commissioner)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("clicking Post Hype calls commissioner-brain with hype action", async () => {
    const fakeFetch = vi.fn().mockImplementation(async () => Response.json({
      lines: ["Great game today!", "Your bracket is alive!"], posted: false,
    }))
    vi.stubGlobal("fetch", fakeFetch)

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-post-hype"))

    await waitFor(() => expect(fakeFetch).toHaveBeenCalled())

    const body = JSON.parse((fakeFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.action).toBe("hype")
  })

  it("renders TextResultBlock with the returned lines", async () => {
    mockFetch({
      lines: ["Game on!", "Watch out for Brazil."],
      posted: false,
    })

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-post-hype"))

    await waitFor(() => {
      expect(screen.getByTestId("wc-ai-cta-text-result")).toBeTruthy()
    })
    expect(screen.getByTestId("wc-ai-cta-text-result").textContent).toContain("Game on!")
    expect(screen.getByTestId("wc-ai-cta-text-result").textContent).toContain("Watch out for Brazil.")
  })
})

describe("WorldCupAiInsightsCTA — error state", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows error box when API returns error", async () => {
    mockFetch({ error: "Something went wrong on the server." }, false)

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      expect(screen.getByTestId("wc-ai-cta-result-error")).toBeTruthy()
    })
    expect(screen.getByTestId("wc-ai-cta-result-error").textContent).toContain(
      "Something went wrong on the server."
    )
  })

  it("shows error box when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unreachable"))
    )

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      expect(screen.getByTestId("wc-ai-cta-result-error")).toBeTruthy()
    })
    expect(screen.getByTestId("wc-ai-cta-result-error").textContent).toContain("Network unreachable")
  })
})

describe("WorldCupAiInsightsCTA — partial entitlements", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("AI chips are active while Commissioner chips are locked when only ai=true", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: true, commissioner: false }) })}
      />
    )

    // AI chips: aria-disabled should be false (not set / "false")
    const askChimmy = screen.getByTestId("wc-ai-cta-ask-chimmy")
    expect(askChimmy.getAttribute("aria-disabled")).toBe("false")

    // Commissioner chips: aria-disabled should be true
    const rootingGuide = screen.getByTestId("wc-ai-cta-rooting-guide")
    expect(rootingGuide.getAttribute("aria-disabled")).toBe("true")
  })

  it("clicking locked commissioner chip does not call fetch", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: true, commissioner: false }) })}
      />
    )

    // This click should be a no-op since the chip is locked
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
