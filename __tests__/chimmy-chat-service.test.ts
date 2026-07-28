import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const confirmTokenSpendMock = vi.fn()

vi.mock("@/lib/tokens/client-confirm", () => ({
  confirmTokenSpend: confirmTokenSpendMock,
}))

describe("sendChimmyMessage", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it("continues the Chimmy request when token preview preflight fails", async () => {
    confirmTokenSpendMock.mockRejectedValueOnce(new Error("Failed to load monetization context"))
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ result: "Agent response." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
    const result = await sendChimmyMessage({
      message: "What should I do?",
      context: {
        leagueId: "league-1",
        sport: "NFL",
      },
    })

    expect(confirmTokenSpendMock).toHaveBeenCalledWith("ai_chimmy_chat_message")
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const payload = JSON.parse(String(init?.body))
    expect(payload.confirmTokenSpend).toBe(false)
    expect(result).toEqual({
      ok: true,
      content: "Agent response.",
      response: "Agent response.",
      meta: undefined,
    })
  })

  it("still blocks when preview succeeds but balance is insufficient", async () => {
    confirmTokenSpendMock.mockResolvedValueOnce({
      confirmed: false,
      preview: {
        ruleCode: "ai_chimmy_chat_message",
        featureLabel: "Chimmy chat message",
        tokenCost: 15,
        currentBalance: 0,
        canSpend: false,
        requiresConfirmation: true,
      },
    })

    const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
    const result = await sendChimmyMessage({
      message: "What should I do?",
      context: {
        leagueId: "league-1",
        sport: "NFL",
      },
    })

    expect(global.fetch).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      content:
        "This is a premium feature. Upgrade to AF Pro or AF Supreme to unlock full trade analysis, waiver recommendations, draft assistance, and more.",
      response:
        "This is a premium feature. Upgrade to AF Pro or AF Supreme to unlock full trade analysis, waiver recommendations, draft assistance, and more.",
      meta: {
        variant: "premium_gate",
        ctaLabel: "View plans",
        ctaHref: "/pricing",
      },
      upgradeRequired: true,
      upgradePath: "/pricing",
    })
  })

  it("parses streamed Chimmy responses and forwards partial text", async () => {
    confirmTokenSpendMock.mockResolvedValueOnce({
      confirmed: true,
      preview: {
        ruleCode: "ai_chimmy_chat_message",
        featureLabel: "Chimmy chat message",
        tokenCost: 15,
        currentBalance: 20,
        canSpend: true,
        requiresConfirmation: true,
      },
    })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        [
          'event: chunk',
          'data: {"delta":"Hold ","response":"Hold "}',
          "",
          'event: chunk',
          'data: {"delta":"tight.","response":"Hold tight."}',
          "",
          'event: done',
          'data: {"result":"Hold tight.","response":"Hold tight."}',
          "",
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }
      )
    )

    const onChunk = vi.fn()
    const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
    const result = await sendChimmyMessage({
      message: "What should I do?",
      onChunk,
      context: {
        leagueId: "league-1",
        sport: "NFL",
      },
    })

    expect(onChunk).toHaveBeenNthCalledWith(1, "Hold ")
    expect(onChunk).toHaveBeenNthCalledWith(2, "Hold tight.")
    expect(result).toEqual({
      ok: true,
      content: "Hold tight.",
      response: "Hold tight.",
      meta: undefined,
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })
})
