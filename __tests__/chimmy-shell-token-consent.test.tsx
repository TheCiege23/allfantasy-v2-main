import React from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

/*
 * ⚠ THE SHELL HAD NO TESTS AT ALL, AND IT IS THE CHIMMY CLIENT MOST USERS REACH —
 * /ai-chat, /chimmy/chat, /messages and the league panels. app/components/ChimmyChat
 * (/dashboard and /legacy) had one render test; this side had none.
 *
 * What matters here is a CONTRACT BY OMISSION, which is the easiest kind to break by
 * accident. sendChimmyMessage defaults to prompting for the token spend and to
 * claiming no consent, so the Shell is correct precisely BECAUSE it passes neither
 * flag: the service asks, and the answer it gets is what reaches billing.
 *
 * ChimmyChat does the opposite — it asks itself and passes both flags. Copying half of
 * that pattern here (suppressing the prompt without forwarding the answer) is exactly
 * the bug that was fixed in e44790c14: requireFeatureEntitlement returns 409
 * token_confirmation_required for an unconfirmed spend, response-copy.ts files that
 * code under PREMIUM_GATE_CODES, and a user holding tokens gets told to buy AF Pro.
 * Nothing in the type system prevents that, because both flags are optional.
 */

const sendChimmyMessageMock = vi.hoisted(() => vi.fn())
const confirmTokenSpendMock = vi.hoisted(() => vi.fn())

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))

/*
 * Mocked at the DEEP module, not at the '@/lib/chimmy-chat' barrel the Shell actually
 * imports from. The barrel is `export * from "./ChimmyChatService"`, so replacing the
 * deep module replaces the binding the barrel re-exports — while the barrel's OTHER
 * exports (thread persistence, sport resolution) stay real. Mocking the barrel instead
 * would have meant hand-stubbing those too, and a stub that drifts from them is how a
 * mock stops intercepting anything.
 */
vi.mock("@/lib/chimmy-chat/ChimmyChatService", () => ({
  sendChimmyMessage: sendChimmyMessageMock,
}))

vi.mock("@/lib/tokens/client-confirm", () => ({
  confirmTokenSpend: confirmTokenSpendMock,
  previewTokenSpend: vi.fn(),
}))

vi.mock("@/lib/chimmy-voice", () => ({
  getVoiceConfig: () => ({ enabled: false, autoPlay: false }),
  playChimmyVoice: vi.fn(),
  saveVoiceConfig: (next: unknown) => next,
  stopCurrentVoice: vi.fn(),
}))

vi.mock("@/lib/chimmy-chat/voiceEngagementNudge", () => ({
  triggerChimmyVoiceListenNudge: vi.fn(),
}))

vi.mock("@/lib/chimmy-chat/analytics-events-client", () => ({
  trackChimmyAIEvent: vi.fn().mockResolvedValue(undefined),
  trackChimmyModeChangeEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/chimmy-conversation-service", () => ({
  loadChimmyConversation: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/hooks/useChimmyAutoTradeEval", () => ({
  useChimmyAutoTradeEval: () => ({
    autoTradeEvalEnabled: false,
    toggleAutoTradeEval: vi.fn(),
    autoTradeEvalReady: true,
  }),
}))

const QUESTION = "Who should I start this week?"

async function renderShell() {
  const ChimmyChatShell = (await import("@/components/chimmy/ChimmyChatShell")).default
  render(<ChimmyChatShell />)
  return screen.getByTestId("chimmy-message-input")
}

describe("ChimmyChatShell", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ available: false, leagues: [] }),
      })
    )
    sendChimmyMessageMock.mockResolvedValue({ ok: true, response: "Start him." })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /* Zero coverage meant a crash on mount was invisible. This is the floor. */
  it("mounts and offers a composer", async () => {
    const composer = await renderShell()

    expect(composer).toBeInTheDocument()
    expect(screen.getByTestId("chimmy-send-button")).toBeInTheDocument()
  })

  it("leaves the token-spend prompt to the service instead of suppressing it", async () => {
    const composer = await renderShell()
    fireEvent.change(composer, { target: { value: QUESTION } })
    fireEvent.click(screen.getByTestId("chimmy-send-button"))

    await waitFor(() => expect(sendChimmyMessageMock).toHaveBeenCalledTimes(1))

    const sent = sendChimmyMessageMock.mock.calls[0]![0]
    expect(sent.message).toBe(QUESTION)

    /*
     * The Shell must not turn the prompt off. `undefined` is the correct value —
     * asserting "not false" rather than "is undefined" on purpose, so deliberately
     * passing `true` stays legal while the silent-suppression case fails.
     */
    expect(sent.promptForTokenSpend).not.toBe(false)

    /* And it must not assert a consent it never collected. */
    expect(sent.tokenSpendConfirmed).not.toBe(true)

    /* It asks nobody itself, which is why the service has to. */
    expect(confirmTokenSpendMock).not.toHaveBeenCalled()
  })
})
