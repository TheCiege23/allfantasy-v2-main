/**
 * WorldCupAiInsightsCTA — analytics event tests
 *
 * Tests:
 *   1.  cta_viewed fires once on mount (with aiUnlocked + commissionerUnlocked)
 *   2.  cta_locked_clicked fires when a locked chip is clicked
 *   3.  upgrade_clicked fires when AI upgrade link is clicked (row_label source)
 *   4.  upgrade_clicked fires when panel header upgrade link is clicked (panel_header source)
 *   5.  cta_clicked fires for chimmy action (no fetch)
 *   6.  cta_clicked fires for card action before fetch resolves
 *   7.  cta_success fires after successful card action
 *   8.  cta_success fires after successful text action
 *   9.  cta_error fires after API error response
 *  10.  cta_error fires after fetch throws
 *  11.  token_confirm_opened fires on HTTP 409
 *  12.  token_confirm_accepted fires when user confirms token spend
 *
 * Entitlement matrix tests:
 *  13.  Free (ai=false, commissioner=false): all chips locked, viewed fires with both false
 *  14.  Pro only (ai=true, commissioner=false): AI chips unlocked, commissioner chips locked
 *  15.  Commissioner only (ai=false, commissioner=true): AI chips locked, commissioner chips unlocked
 *  16.  Supreme (ai=true, commissioner=true): all chips unlocked, no upgrade links shown
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import WorldCupAiInsightsCTA from "@/components/brackets/world-cup/WorldCupAiInsightsCTA"

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ language: "en" }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("@/components/brackets/world-cup/InsightCards", () => ({
  InsightCardView: ({ card }: { card: { kind: string } }) => (
    <div data-testid="insight-card-view">{card.kind}</div>
  ),
}))

// Spy on analytics helpers — track call arguments without invoking sendBeacon
const beaconMock = vi.fn()
vi.mock("@/lib/analytics/client", () => ({
  sendProductAnalyticsBeacon: (...args: unknown[]) => beaconMock(...args),
}))

// Keep confirmWorldCupTokenSpend controllable
const confirmMock = vi.fn()
vi.mock("@/lib/world-cup/worldCupClientTokenConfirm", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/world-cup/worldCupClientTokenConfirm")>()
  return {
    ...real,
    confirmWorldCupTokenSpend: (...args: unknown[]) => {
      const accepted = confirmMock(...args)
      if (accepted) approvePaidToolQuote(args[0])
      return accepted
    },
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

import { approvePaidToolQuote } from '@/lib/tokens/paidToolClient'
import { WORLD_CUP_CTA } from "@/lib/analytics/eventNames"

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
    challengeId: "ch-analytics-test",
    entitlementSummary: makeEntitlements({ ai: true, commissioner: true }),
    selectedEntryId: "entry-1",
    selectedEntryName: "Test Bracket",
    onOpenChimmyWithPrompt: vi.fn(),
    onSwitchToReviewTab: vi.fn(),
    ...overrides,
  }
}

function okFetch(body: unknown) {
  return vi.fn().mockImplementation(async () => Response.json(body))
}

function errorFetch(body: unknown, status = 500) {
  return vi.fn().mockImplementation(async () => Response.json(body, { status }))
}

function confirmFetch(body: Record<string, unknown>) {
  return vi.fn().mockImplementationOnce(async (_url, init: RequestInit) => Response.json({
    code: "token_confirmation_required", preview: { tokenCost: 5 },
    tokenQuote: 'test-signed-offer', paidToolRequestId: new Headers(init.headers).get('x-paid-tool-request-id'), ...body,
  }, { status: 409 })).mockImplementationOnce(async () => Response.json({ card: { kind: "rooting_guide", data: {} } }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorldCupAiInsightsCTA — analytics: viewed event", () => {
  beforeEach(() => {
    beaconMock.mockReset()
    vi.unstubAllGlobals()
  })

  it("fires cta_viewed on mount with entitlement flags", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: true, commissioner: false }) })}
      />
    )
    const calls = beaconMock.mock.calls
    const viewedCall = calls.find(([name]) => name === WORLD_CUP_CTA.VIEWED)
    expect(viewedCall).toBeTruthy()
    const meta = viewedCall![1] as Record<string, unknown>
    expect(meta.aiUnlocked).toBe(true)
    expect(meta.commissionerUnlocked).toBe(false)
    expect(meta.challengeId).toBe("ch-analytics-test")
  })

  it("fires cta_viewed only once even when props change", () => {
    const { rerender } = render(<WorldCupAiInsightsCTA {...makeProps()} />)
    rerender(<WorldCupAiInsightsCTA {...makeProps({ selectedEntryName: "Updated Name" })} />)

    const viewedCalls = beaconMock.mock.calls.filter(([name]) => name === WORLD_CUP_CTA.VIEWED)
    expect(viewedCalls).toHaveLength(1)
  })
})

describe("WorldCupAiInsightsCTA — analytics: locked chip clicked", () => {
  beforeEach(() => {
    beaconMock.mockReset()
    vi.unstubAllGlobals()
  })

  it("fires cta_locked_clicked when a locked AI chip is clicked", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )

    fireEvent.click(screen.getByTestId("wc-ai-cta-ask-chimmy"))

    const lockedCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.LOCKED_CLICKED)
    expect(lockedCall).toBeTruthy()
    const meta = lockedCall![1] as Record<string, unknown>
    expect(meta.actionKey).toBe("ask-chimmy")
    expect(meta.tier).toBe("ai")
    expect(meta.locked).toBe(true)
  })

  it("fires cta_locked_clicked when a locked commissioner chip is clicked", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: true, commissioner: false }) })}
      />
    )

    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    const lockedCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.LOCKED_CLICKED)
    expect(lockedCall).toBeTruthy()
    const meta = lockedCall![1] as Record<string, unknown>
    expect(meta.tier).toBe("commissioner")
  })
})

describe("WorldCupAiInsightsCTA — analytics: upgrade link clicked", () => {
  beforeEach(() => {
    beaconMock.mockReset()
    vi.unstubAllGlobals()
  })

  it("fires upgrade_clicked with row_label source when AI row badge is clicked", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )

    fireEvent.click(screen.getByTestId("wc-ai-cta-upgrade-ai"))

    const upgradeCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.UPGRADE_CLICKED)
    expect(upgradeCall).toBeTruthy()
    const meta = upgradeCall![1] as Record<string, unknown>
    expect(meta.tier).toBe("ai")
    expect(meta.source).toBe("row_label")
  })

  it("fires upgrade_clicked with panel_header source for header unlock link", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )

    // The header "Unlock All" link is a sibling of the panel title
    const links = screen.getAllByRole("link")
    const unlockAllLink = links.find((l) => l.textContent?.includes("Unlock All"))
    expect(unlockAllLink).toBeTruthy()
    fireEvent.click(unlockAllLink!)

    const upgradeCall = beaconMock.mock.calls.find(
      ([name, meta]) => name === WORLD_CUP_CTA.UPGRADE_CLICKED && (meta as Record<string,unknown>).source === "panel_header"
    )
    expect(upgradeCall).toBeTruthy()
  })
})

describe("WorldCupAiInsightsCTA — analytics: CTA clicked and success", () => {
  beforeEach(() => {
    beaconMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fires cta_clicked for chimmy action without calling fetch", () => {
    vi.stubGlobal("fetch", vi.fn())
    render(<WorldCupAiInsightsCTA {...makeProps()} />)

    fireEvent.click(screen.getByTestId("wc-ai-cta-ask-chimmy"))

    const clickedCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.CLICKED)
    expect(clickedCall).toBeTruthy()
    const meta = clickedCall![1] as Record<string, unknown>
    expect(meta.actionKey).toBe("ask-chimmy")
    expect(meta.tier).toBe("ai")
    expect(meta.kind).toBe("chimmy")
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("fires cta_success after successful card action", async () => {
    vi.stubGlobal("fetch", okFetch({ card: { kind: "rooting_guide", data: {} } }))

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      const successCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.SUCCESS)
      expect(successCall).toBeTruthy()
    })

    const successCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.SUCCESS)!
    const meta = successCall[1] as Record<string, unknown>
    expect(meta.actionKey).toBe("rooting-guide")
    expect(meta.resultKind).toBe("card")
    expect(meta.tier).toBe("commissioner")
  })

  it("fires cta_success after successful text action", async () => {
    vi.stubGlobal("fetch", okFetch({ lines: ["Hype!"], posted: false }))

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-post-hype"))

    await waitFor(() => {
      const successCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.SUCCESS)
      expect(successCall).toBeTruthy()
    })

    const successCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.SUCCESS)!
    const meta = successCall[1] as Record<string, unknown>
    expect(meta.resultKind).toBe("lines")
  })
})

describe("WorldCupAiInsightsCTA — analytics: error events", () => {
  beforeEach(() => {
    beaconMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fires cta_error after API error response", async () => {
    vi.stubGlobal("fetch", errorFetch({ error: "provider unavailable" }))

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      const errorCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.ERROR)
      expect(errorCall).toBeTruthy()
    })

    const errorCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.ERROR)!
    const meta = errorCall[1] as Record<string, unknown>
    expect(meta.actionKey).toBe("rooting-guide")
    expect(meta.errorMessage).toContain("provider unavailable")
  })

  it("fires cta_error after fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")))

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      const errorCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.ERROR)
      expect(errorCall).toBeTruthy()
    })

    const errorCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.ERROR)!
    const meta = errorCall[1] as Record<string, unknown>
    expect(meta.errorMessage).toContain("connection refused")
  })
})

describe("WorldCupAiInsightsCTA — analytics: token confirmation", () => {
  beforeEach(() => {
    beaconMock.mockReset()
    confirmMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fires token_confirm_opened on HTTP 409 with tokenCost", async () => {
    vi.stubGlobal("fetch", confirmFetch({}))
    confirmMock.mockReturnValue(false) // user cancels

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      const confirmOpenedCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.TOKEN_CONFIRM_OPENED)
      expect(confirmOpenedCall).toBeTruthy()
    })

    const call = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.TOKEN_CONFIRM_OPENED)!
    const meta = call[1] as Record<string, unknown>
    expect(meta.tokenCost).toBe(5)
    expect(meta.actionKey).toBe("rooting-guide")
  })

  it("fires token_confirm_accepted when user confirms token spend", async () => {
    const fetchMock = confirmFetch({})
    vi.stubGlobal("fetch", fetchMock)
    confirmMock.mockReturnValue(true) // user accepts

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    await waitFor(() => {
      const acceptedCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.TOKEN_CONFIRM_ACCEPTED)
      expect(acceptedCall).toBeTruthy()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const first = fetchMock.mock.calls[0][1] as RequestInit
    const second = fetchMock.mock.calls[1][1] as RequestInit
    expect(new Headers(second.headers).get('x-paid-tool-request-id')).toBe(new Headers(first.headers).get('x-paid-tool-request-id'))
    expect(new Headers(first.headers).get('x-paid-tool-quote')).toBeNull()
    expect(new Headers(second.headers).get('x-paid-tool-quote')).toBe('test-signed-offer')
  })

  it("does NOT fire token_confirm_accepted when user cancels", async () => {
    vi.stubGlobal("fetch", confirmFetch({}))
    confirmMock.mockReturnValue(false)

    render(<WorldCupAiInsightsCTA {...makeProps()} />)
    fireEvent.click(screen.getByTestId("wc-ai-cta-rooting-guide"))

    // Wait for opened to appear, then assert accepted is absent
    await waitFor(() => {
      expect(beaconMock.mock.calls.some(([name]) => name === WORLD_CUP_CTA.TOKEN_CONFIRM_OPENED)).toBe(true)
    })

    expect(beaconMock.mock.calls.some(([name]) => name === WORLD_CUP_CTA.TOKEN_CONFIRM_ACCEPTED)).toBe(false)
  })
})

// ─── Entitlement matrix ───────────────────────────────────────────────────────

describe("WorldCupAiInsightsCTA — entitlement matrix", () => {
  beforeEach(() => {
    beaconMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("Free (ai=false, commissioner=false): all chips aria-disabled, both upgrade links shown, viewed fired with both false", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: false }) })}
      />
    )

    // All chips locked
    const buttons = screen.getAllByRole("button")
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-disabled")).toBe("true")
    }

    // Both upgrade links visible
    expect(screen.getByTestId("wc-ai-cta-upgrade-ai")).toBeTruthy()
    expect(screen.getByTestId("wc-ai-cta-upgrade-commissioner")).toBeTruthy()

    // viewed event carries both-false flags
    const viewedCall = beaconMock.mock.calls.find(([name]) => name === WORLD_CUP_CTA.VIEWED)!
    const meta = viewedCall[1] as Record<string, unknown>
    expect(meta.aiUnlocked).toBe(false)
    expect(meta.commissionerUnlocked).toBe(false)
  })

  it("Pro only (ai=true, commissioner=false): AI chips active, commissioner chips locked", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: true, commissioner: false }) })}
      />
    )

    expect(screen.getByTestId("wc-ai-cta-ask-chimmy").getAttribute("aria-disabled")).toBe("false")
    expect(screen.getByTestId("wc-ai-cta-path-to-first").getAttribute("aria-disabled")).toBe("false")
    expect(screen.getByTestId("wc-ai-cta-rooting-guide").getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByTestId("wc-ai-cta-pool-swing").getAttribute("aria-disabled")).toBe("true")

    // No AI upgrade link, commissioner upgrade link shown
    expect(screen.queryByTestId("wc-ai-cta-upgrade-ai")).toBeNull()
    expect(screen.getByTestId("wc-ai-cta-upgrade-commissioner")).toBeTruthy()
  })

  it("Commissioner only (ai=false, commissioner=true): AI chips locked, commissioner chips active", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: false, commissioner: true }) })}
      />
    )

    expect(screen.getByTestId("wc-ai-cta-ask-chimmy").getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByTestId("wc-ai-cta-rooting-guide").getAttribute("aria-disabled")).toBe("false")
    expect(screen.getByTestId("wc-ai-cta-post-hype").getAttribute("aria-disabled")).toBe("false")

    // AI upgrade link shown, commissioner upgrade link absent
    expect(screen.getByTestId("wc-ai-cta-upgrade-ai")).toBeTruthy()
    expect(screen.queryByTestId("wc-ai-cta-upgrade-commissioner")).toBeNull()
  })

  it("Supreme (ai=true, commissioner=true): all chips active, no upgrade links", () => {
    render(
      <WorldCupAiInsightsCTA
        {...makeProps({ entitlementSummary: makeEntitlements({ ai: true, commissioner: true }) })}
      />
    )

    const buttons = screen.getAllByRole("button")
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-disabled")).toBe("false")
    }

    expect(screen.queryByTestId("wc-ai-cta-upgrade-ai")).toBeNull()
    expect(screen.queryByTestId("wc-ai-cta-upgrade-commissioner")).toBeNull()
  })
})
