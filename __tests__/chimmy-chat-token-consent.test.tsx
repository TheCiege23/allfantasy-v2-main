import React from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

/*
 * ⚠ WHAT THIS GUARDS, AND WHY A SERVICE TEST WAS NOT ENOUGH.
 *
 * e44790c14 split sendChimmyMessage's single `confirmTokenSpend` flag — which had
 * meant both "should I prompt?" and "what do I tell the server?" — into
 * `promptForTokenSpend` and `tokenSpendConfirmed`. The service-level tests prove the
 * new contract exists and the typechecker proves the field NAMES are wired, because
 * the old field no longer exists on the input type.
 *
 * Neither proves the thing that was actually broken: that this component reports the
 * consent it obtained. ChimmyChat asks the user itself (window.confirm, via
 * lib/tokens/client-confirm) and then tells the service not to ask again — so if it
 * forgets to pass the answer along, the user clicks OK and the server is still told
 * "not confirmed". requireFeatureEntitlement answers that with 409
 * token_confirmation_required for any account without AF Pro, and
 * lib/chimmy-chat/response-copy.ts files that code under PREMIUM_GATE_CODES, so a
 * user holding tokens who had just agreed to spend them was shown "Upgrade to AF
 * Pro". That is the bug these two cases exist to keep fixed.
 */

const confirmTokenSpendMock = vi.hoisted(() => vi.fn())
const sendChimmyMessageMock = vi.hoisted(() => vi.fn())

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("@/lib/tokens/client-confirm", () => ({
  confirmTokenSpend: confirmTokenSpendMock,
}))

vi.mock("@/lib/chimmy-chat/ChimmyChatService", () => ({
  sendChimmyMessage: sendChimmyMessageMock,
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

vi.mock("@/hooks/useChimmyAutoTradeEval", () => ({
  useChimmyAutoTradeEval: () => ({
    autoTradeEvalEnabled: false,
    toggleAutoTradeEval: vi.fn(),
    autoTradeEvalReady: true,
  }),
}))

vi.mock("@/app/dashboard/components/chat/ChimmyAssistantAvatar", () => ({
  ChimmyAssistantAvatar: () => <div data-testid="chimmy-avatar" />,
}))

/*
 * Must NOT be a no-charge intent, or the component skips its preflight entirely and
 * there is no consent to report. "start" puts this on nfl_redraft /
 * charge_after_success via lib/ai/chimmyIntentRouter, which is the real module here.
 */
const PAID_QUESTION = "Who should I start this week?"

function spendPreview(overrides: Record<string, unknown> = {}) {
  return {
    ruleCode: "ai_chimmy_chat_message",
    featureLabel: "Chimmy chat message",
    tokenCost: 15,
    currentBalance: 100,
    canSpend: true,
    requiresConfirmation: true,
    ...overrides,
  }
}

async function renderChat() {
  const ChimmyChat = (await import("@/app/components/ChimmyChat")).default
  render(<ChimmyChat embedded panelFill parentControlsNew />)
  return screen.getByPlaceholderText(/Ask about your roster/i)
}

describe("ChimmyChat token consent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.dataset.mode = "light"
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ available: false }),
      })
    )
    sendChimmyMessageMock.mockResolvedValue({ ok: true, response: "Start him." })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute("data-mode")
  })

  it("reports the consent it obtained, and does not ask the service to ask again", async () => {
    confirmTokenSpendMock.mockResolvedValue({ confirmed: true, preview: spendPreview() })

    const composer = await renderChat()
    fireEvent.change(composer, { target: { value: PAID_QUESTION } })
    fireEvent.keyDown(composer, { key: "Enter" })

    await waitFor(() => expect(sendChimmyMessageMock).toHaveBeenCalledTimes(1))

    expect(confirmTokenSpendMock).toHaveBeenCalledWith("ai_chimmy_chat_message")

    const sent = sendChimmyMessageMock.mock.calls[0]![0]
    expect(sent.message).toBe(PAID_QUESTION)
    /* The whole bug in one assertion: the user said yes, so the server must hear yes. */
    expect(sent.tokenSpendConfirmed).toBe(true)
    /* And it must not be asked a second time, which is why the flag was conflated. */
    expect(sent.promptForTokenSpend).toBe(false)
  })

  it("sends nothing at all when the user declines, and gives the question back", async () => {
    confirmTokenSpendMock.mockResolvedValue({ confirmed: false, preview: spendPreview() })

    const composer = await renderChat()
    fireEvent.change(composer, { target: { value: PAID_QUESTION } })
    fireEvent.keyDown(composer, { key: "Enter" })

    await waitFor(() => expect(confirmTokenSpendMock).toHaveBeenCalledTimes(1))

    expect(sendChimmyMessageMock).not.toHaveBeenCalled()
    /* Declining must not cost the user their typing. */
    await waitFor(() => expect((composer as HTMLInputElement).value).toBe(PAID_QUESTION))
  })
})
