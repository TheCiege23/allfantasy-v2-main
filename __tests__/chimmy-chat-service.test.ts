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
      response: "Hold tight.",
      meta: undefined,
    })
  })

  /*
   * ⚠ ONE BOOLEAN WAS DOING TWO JOBS, AND THE SERVER BELIEVED THE WRONG ONE.
   *
   * `confirmTokenSpend` meant both "should I prompt?" and "what do I tell the
   * server?", so a caller that had ALREADY asked the user could only suppress the
   * second dialog by also telling the server it had no consent. app/components/
   * ChimmyChat.tsx did exactly that: it ran its own window.confirm, the user
   * clicked OK, and it then sent confirmTokenSpend:false. requireFeatureEntitlement
   * answers that with 409 token_confirmation_required for any user without AF Pro,
   * and lib/chimmy-chat/response-copy.ts files that code under PREMIUM_GATE_CODES —
   * so a user holding tokens, who had just agreed to spend them, was shown
   * "Upgrade to AF Pro". ai_chat is accessType "subscription_or_tokens"; the token
   * half was unreachable on that surface.
   */
  it("sends confirmTokenSpend: true for a caller that already has consent, without prompting again", async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ result: "Agent response." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
    await sendChimmyMessage({
      message: "What should I do?",
      promptForTokenSpend: false,
      tokenSpendConfirmed: true,
    })

    expect(confirmTokenSpendMock).not.toHaveBeenCalled()
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(JSON.parse(String(init?.body)).confirmTokenSpend).toBe(true)
  })

  /* The same suppression must NOT manufacture consent nobody gave. */
  it("sends confirmTokenSpend: false when prompting is suppressed and no consent was obtained", async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ result: "Agent response." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
    await sendChimmyMessage({
      message: "What should I do?",
      promptForTokenSpend: false,
    })

    expect(confirmTokenSpendMock).not.toHaveBeenCalled()
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(JSON.parse(String(init?.body)).confirmTokenSpend).toBe(false)
  })

  /*
   * ⚠ A 409 token_confirmation_required MEANS "ASK THEM", NOT "SELL TO THEM".
   *
   * requireFeatureEntitlement returns that code only after it has confirmed
   * preview.canSpend is true, so the user can pay and simply was not asked.
   * response-copy.ts files the code under PREMIUM_GATE_CODES with
   * feature_not_entitled, so it used to render "Upgrade to AF Pro" — answering a
   * paying user's question with a sales pitch. These cover the recovery.
   */
  describe("a 409 asking for confirmation is recovered, not sold against", () => {
    const gate409 = () =>
      new Response(JSON.stringify({ code: "token_confirmation_required", preview: { tokenCost: 15 } }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    const ok = (text: string) =>
      new Response(JSON.stringify({ result: text }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    const preview = (over: Record<string, unknown> = {}) => ({
      ruleCode: "ai_chimmy_chat_message",
      featureLabel: "Chimmy chat message",
      tokenCost: 15,
      currentBalance: 100,
      canSpend: true,
      requiresConfirmation: true,
      ...over,
    })

    it("asks, then retries with consent, and returns the real answer", async () => {
      const f = global.fetch as unknown as ReturnType<typeof vi.fn>
      f.mockResolvedValueOnce(gate409()).mockResolvedValueOnce(ok("Start him."))
      confirmTokenSpendMock.mockResolvedValueOnce({ confirmed: true, preview: preview() })

      const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
      const result = await sendChimmyMessage({
        message: "Who should I start?",
        promptForTokenSpend: false,
      })

      expect(confirmTokenSpendMock).toHaveBeenCalledWith("ai_chimmy_chat_message")
      expect(f).toHaveBeenCalledTimes(2)
      /* The retry must carry the consent, or the server answers 409 again. */
      const [, retryInit] = f.mock.calls[1]!
      expect(JSON.parse(String(retryInit?.body)).confirmTokenSpend).toBe(true)
      expect(result.response).toBe("Start him.")
      expect(result.upgradeRequired).not.toBe(true)
    })

    it("does not retry, and does not sell, when the user declines", async () => {
      const f = global.fetch as unknown as ReturnType<typeof vi.fn>
      f.mockResolvedValueOnce(gate409())
      confirmTokenSpendMock.mockResolvedValueOnce({ confirmed: false, preview: preview() })

      const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
      const result = await sendChimmyMessage({ message: "Who should I start?", promptForTokenSpend: false })

      expect(f).toHaveBeenCalledTimes(1)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/cancelled/i)
      expect(result.upgradeRequired).not.toBe(true)
    })

    /* Out of balance is the one case where the upgrade path IS the right answer. */
    it("still shows the upgrade path when the balance genuinely cannot cover it", async () => {
      const f = global.fetch as unknown as ReturnType<typeof vi.fn>
      f.mockResolvedValueOnce(gate409())
      confirmTokenSpendMock.mockResolvedValueOnce({
        confirmed: false,
        preview: preview({ canSpend: false, currentBalance: 0 }),
      })

      const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
      const result = await sendChimmyMessage({ message: "Who should I start?", promptForTokenSpend: false })

      expect(f).toHaveBeenCalledTimes(1)
      expect(result.upgradeRequired).toBe(true)
    })

    /* A server that always demands confirmation must not loop the prompt. */
    it("gives up after one retry rather than prompting forever", async () => {
      const f = global.fetch as unknown as ReturnType<typeof vi.fn>
      f.mockResolvedValueOnce(gate409()).mockResolvedValueOnce(gate409())
      confirmTokenSpendMock.mockResolvedValue({ confirmed: true, preview: preview() })

      const { sendChimmyMessage } = await import("@/lib/chimmy-chat/ChimmyChatService")
      const result = await sendChimmyMessage({ message: "Who should I start?", promptForTokenSpend: false })

      expect(f).toHaveBeenCalledTimes(2)
      expect(confirmTokenSpendMock).toHaveBeenCalledTimes(1)
      expect(result.upgradeRequired).toBe(true)
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })
})
