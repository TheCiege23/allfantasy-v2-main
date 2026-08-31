import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_WORLD_CUP_SCORING } from "@/lib/world-cup/worldCupBracketBuilder"
import type { WorldCupChimmyContext } from "@/lib/world-cup/worldCupChimmyContext"
import {
  buildWorldCupChimmySystemPrompt,
  enforceWorldCupChimmyReplyGuard,
  isBracketImpactQuestion,
  isPoolStandingQuestion,
  isScheduleQuestion,
  isScoringExplanationQuestion,
  isUnsupportedVerifiedDataQuestion,
  reliableDataUnavailableMessage,
  serializeChimmyContext,
  tryDeterministicWorldCupChimmyReply,
} from "@/lib/world-cup/worldCupChimmyReplyPolicy"

const routeTextCallMock = vi.hoisted(() => vi.fn())
const appendChatHistoryMock = vi.hoisted(() => vi.fn())
const buildChimmyConversationIdMock = vi.hoisted(() => vi.fn())
const tryDeterministicAnswerMock = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))

vi.mock("@/lib/ai/providerRouter", () => ({
  routeTextCall: routeTextCallMock,
}))

vi.mock("@/lib/ai/deterministic", () => ({
  DETERMINISTIC_SOURCE: "deterministic",
  tryDeterministicAnswer: tryDeterministicAnswerMock,
}))

vi.mock("@/lib/ai-memory/chat-history-store", () => ({
  appendChatHistory: appendChatHistoryMock,
  buildChimmyConversationId: buildChimmyConversationIdMock,
}))

function baseContext(overrides: Partial<WorldCupChimmyContext> = {}): WorldCupChimmyContext {
  return {
    challengeId: "c1",
    poolName: "Office Cup",
    isLocked: false,
    lockReason: null,
    participantCount: 8,
    scoring: { ...DEFAULT_WORLD_CUP_SCORING },
    entry: {
      entryId: "e1",
      entryName: "Guap Bracket",
      championPick: "Brazil",
      totalScore: 120,
      maxPossibleScore: 400,
      rank: 2,
      correctPicks: 8,
      incorrectPicks: 2,
      isComplete: false,
      isLocked: false,
      groupPicks: [],
      knockoutPicks: [
        {
          round: "round_of_16",
          homeTeamName: "Argentina",
          awayTeamName: "France",
          pickedTeam: "Argentina",
          isCorrect: null,
          pointsAwarded: 0,
        },
      ],
    },
    liveMatches: [],
    upcomingMatches: [],
    recentMatches: [],
    groupStandings: [],
    leaderboard: [
      {
        rank: 1,
        entryId: "e0",
        entryName: "Leader",
        userId: "u0",
        totalScore: 140,
        maxPossibleScore: 400,
        championPickName: "Spain",
      },
      {
        rank: 2,
        entryId: "e1",
        entryName: "Guap Bracket",
        userId: "u1",
        totalScore: 120,
        maxPossibleScore: 400,
        championPickName: "Brazil",
      },
    ],
    liveDataStatus: "unavailable",
    lastSyncedAt: null,
    locale: "en",
    fetchedAt: "2026-06-15T18:00:00.000Z",
    ...overrides,
  }
}

describe("World Cup Chimmy reply policy", () => {
  it("system prompt is pool-scoped and forbids inventing live data", () => {
    const prompt = buildWorldCupChimmySystemPrompt("en")
    expect(prompt).toMatch(/bracket pool analyst/i)
    expect(prompt).toMatch(/GROUNDING JSON/i)
    expect(prompt).toMatch(/SOCCER BASICS/i)
    expect(prompt).toMatch(/Never invent scores/i)
    expect(prompt).toMatch(/NOT in scope: betting advice/i)
    expect(prompt).toMatch(/SOURCE CUE/i)
    expect(prompt).toMatch(/I don't have reliable data for that yet/i)
  })

  it("serializes leaderboard and scoring for pool standing questions", () => {
    const block = serializeChimmyContext(baseContext())
    expect(block).toContain("LEADERBOARD")
    expect(block).toContain("SCORING:")
    expect(block).toContain("YOUR ENTRY:")
    expect(isPoolStandingQuestion("who is leading the pool?")).toBe(true)
  })

  it("detects bracket impact and scoring explanation intents", () => {
    expect(isBracketImpactQuestion("if Argentina wins, how does that affect my bracket?")).toBe(true)
    expect(isScoringExplanationQuestion("how do quarterfinal points work?")).toBe(true)
    expect(isScheduleQuestion("when is the next match?")).toBe(true)
    expect(isUnsupportedVerifiedDataQuestion("who has injury news and player stats?")).toBe(true)
  })
})

describe("generateWorldCupChimmyPrivateReply — stabilization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildChimmyConversationIdMock.mockReturnValue("chimmy:user-1:world-cup:c1")
    appendChatHistoryMock.mockResolvedValue(undefined)
    tryDeterministicAnswerMock.mockResolvedValue(null)
    routeTextCallMock.mockResolvedValue({
      ok: true,
      text: "Placeholder",
      model: "gpt-test",
      provider: "openai",
      tokensUsed: 10,
    })
  })

  async function replyWith(input: {
    prompt: string
    locale?: string | null
    context?: WorldCupChimmyContext | null
  }) {
    const { generateWorldCupChimmyPrivateReply } = await import("@/lib/world-cup/worldCupChimmyPrivateReply")
    return generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      challengeName: "Office Cup",
      prompt: input.prompt,
      locale: input.locale ?? "en",
      context: input.context ?? baseContext(),
    })
  }

  it("score question with live data — keeps feed-backed score", async () => {
    routeTextCallMock.mockResolvedValue({
      ok: true,
      text: "Argentina lead 2-1 (67') in your pool feed — that keeps your R16 pick alive.",
      model: "gpt-test",
      provider: "openai",
      tokensUsed: 10,
    })

    const result = await replyWith({
      prompt: "@chimmy what's the live score for Argentina?",
      context: baseContext({
        liveDataStatus: "live",
        liveMatches: [
          {
            matchId: "m1",
            round: "round_of_16",
            homeTeamName: "Argentina",
            awayTeamName: "France",
            homeScore: 2,
            awayScore: 1,
            homePenaltyScore: null,
            awayPenaltyScore: null,
            winnerTeamName: null,
            status: "live",
            minute: 67,
            injuryTime: null,
            startsAt: "2026-06-15T20:00:00.000Z",
            venueName: null,
            venueCity: null,
            apiStatusShort: "LIVE",
            lastSyncedAt: "2026-06-15T20:30:00.000Z",
          },
        ],
      }),
    })

    expect(routeTextCallMock).toHaveBeenCalled()
    expect(result.reply).toMatch(/2-1/)
    expect(result.reply).not.toMatch(/live feed isn't synced/i)
  })

  it("score question without live data — deterministic unavailable message", async () => {
    const result = await replyWith({
      prompt: "@chimmy what's the live score right now?",
      context: baseContext({ liveDataStatus: "unavailable", liveMatches: [] }),
    })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toMatch(/live score feed/i)
    expect(result.reply).not.toMatch(/\b\d{1,2}-\d{1,2}\b/)
  })

  it("pool standing question answers from stored leaderboard without model calls", async () => {
    const result = await replyWith({ prompt: "@chimmy where am I on the leaderboard?" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("Best bracket so far")
    expect(result.reply).toContain("Leader")
    expect(result.reply).toContain("Guap Bracket")
    expect(result.reply).toContain("Source: stored pool data")
  })

  it("bracket impact question answers from saved entry and picks", async () => {
    const result = await replyWith({ prompt: "@chimmy explain my path to win" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("Your path")
    expect(result.reply).toContain("Guap Bracket")
    expect(result.reply).toContain("Argentina")
  })

  it("scoring explanation answers from pool scoring rules", async () => {
    const result = await replyWith({ prompt: "@chimmy how do quarterfinal points work in this pool?" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("Scoring rules")
    expect(result.reply).toContain("quarterfinal 40")
    expect(result.reply).toContain("champion bonus 320")
  })

  it("points question answers from saved entry without model calls", async () => {
    const result = await replyWith({ prompt: "@chimmy how many points do I have?" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("120 pts")
    expect(result.reply).toContain("Confidence:")
  })

  it("champion pick question answers from saved entry without model calls", async () => {
    const result = await replyWith({ prompt: "@chimmy show my champion pick" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("Brazil")
  })

  it("commissioner summary uses stored pool context instead of refusing everything", async () => {
    const result = await replyWith({ prompt: "@chimmy Commissioner: give me a pool health report" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("Office Cup has 8 participants")
    expect(result.reply).toContain("Top snapshot")
    expect(result.reply).toContain("Commissioner note")
  })

  it("watch-today prompt pivots to saved picks when live fixtures are missing", async () => {
    const result = await replyWith({ prompt: "@chimmy what picks should I watch today?" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("watch your champion pick")
    expect(result.reply).toContain("Source: stored pool data")
  })

  it("general soccer knowledge answers without model calls or fresh-data claims", async () => {
    const result = await replyWith({ prompt: "@chimmy what is a false nine?" })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("stable soccer knowledge")
    expect(result.reply).toContain("false nine")
  })

  it("Spanish response when locale is Spanish", async () => {
    const deterministic = tryDeterministicWorldCupChimmyReply({
      prompt: "marcador en vivo?",
      context: baseContext({ liveDataStatus: "unavailable" }),
      locale: "es",
    })
    expect(deterministic).toMatch(/marcador en vivo/i)

    const result = await replyWith({
      prompt: "@chimmy marcador en vivo?",
      locale: "es",
      context: baseContext({ liveDataStatus: "unavailable" }),
    })
    expect(result.reply).toMatch(/marcador en vivo|datos en vivo/i)
    expect(routeTextCallMock).not.toHaveBeenCalled()

    const system = buildWorldCupChimmySystemPrompt("es")
    expect(system).toContain("Respond in Spanish")
  })

  it("hallucination guard — blocks invented score when live data missing", async () => {
    routeTextCallMock.mockResolvedValue({
      ok: true,
      text: "Brazil are up 3-2 in the 78th minute!",
      model: "gpt-test",
      provider: "openai",
      tokensUsed: 10,
    })

    const guarded = enforceWorldCupChimmyReplyGuard({
      reply: "Brazil are up 3-2 in the 78th minute!",
      prompt: "any update on Brazil?",
      context: baseContext({ liveDataStatus: "unavailable" }),
      locale: "en",
    })
    expect(guarded).not.toMatch(/3-2/)
    expect(guarded).toMatch(/won't guess|live score feed/i)

    const result = await replyWith({
      prompt: "@chimmy score for Brazil?",
      context: baseContext({ liveDataStatus: "unavailable" }),
    })
    expect(result.reply).not.toMatch(/3-2/)
  })

  it("schedule question without synced schedule data does not call the model", async () => {
    const result = await replyWith({
      prompt: "@chimmy when does the next match start?",
      context: baseContext({
        liveDataStatus: "unavailable",
        liveMatches: [],
        upcomingMatches: [],
        recentMatches: [],
      }),
    })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("I don't have reliable data for that yet")
  })

  it("team schedule question uses cached fixtures without model calls", async () => {
    /*
     * ⚠ A DATE TIME-BOMB, NOT A CONTRACT CHANGE. This fixture used to hardcode
     * `startsAt: "2026-06-16T20:00:00.000Z"`, and buildScheduleReply filters a
     * requested team's fixtures with
     *
     *     .filter((m) => !m.startsAt || new Date(m.startsAt) >= now || m.status === "live")
     *
     * against `const now = new Date()` — the REAL clock, with no injection point.
     * The moment that kickoff fell into the past the match was filtered out,
     * `relevant.length === 0`, and the code correctly answered "no fresh cached
     * fixture for Brazil". The code was right; the fixture had expired.
     *
     * Anchored to run time so it cannot expire again. The offset is what makes
     * the test meaningful — a fixture at `Date.now()` sits exactly on the
     * boundary the filter compares against.
     */
    const kickoff = new Date(Date.now() + 24 * 60 * 60 * 1000)
    expect(kickoff.getTime()).toBeGreaterThan(Date.now())

    const result = await replyWith({
      prompt: "@chimmy who does Brazil play next?",
      context: baseContext({
        liveDataStatus: "fixture_only",
        upcomingMatches: [
          {
            matchId: "m2",
            round: "round_of_32",
            homeTeamName: "Brazil",
            awayTeamName: "Japan",
            homeScore: null,
            awayScore: null,
            homePenaltyScore: null,
            awayPenaltyScore: null,
            winnerTeamName: null,
            status: "scheduled",
            minute: null,
            injuryTime: null,
            startsAt: kickoff.toISOString(),
            venueName: null,
            venueCity: null,
            apiStatusShort: "NS",
            lastSyncedAt: "2026-06-15T20:30:00.000Z",
          },
        ],
      }),
    })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("Brazil fixture from cache")
    expect(result.reply).toContain("Brazil vs Japan")
  })

  it("model prompts include structured grounding JSON", async () => {
    routeTextCallMock.mockResolvedValue({
      ok: true,
      text: "Grounded story: your pool is tight, with Leader ahead and Brazil as your swing pick.",
      model: "gpt-test",
      provider: "openai",
      tokensUsed: 10,
    })

    const result = await replyWith({ prompt: "@chimmy run a premium multi-scenario optimization report" })

    expect(routeTextCallMock).toHaveBeenCalled()
    const call = routeTextCallMock.mock.calls[0][0]
    const userMessage = call.messages.find((message: { role: string }) => message.role === "user")
    expect(userMessage.content).toContain("--- GROUNDING JSON ---")
    expect(userMessage.content).toContain('"contractVersion": "wc-chimmy-grounding-v1"')
    expect(userMessage.content).toContain('"dataQuality"')
    expect(result.provider).toBe("openai")
  })

  it("unsupported exact-data question does not call the model", async () => {
    const result = await replyWith({
      prompt: "@chimmy give me Brazil player stats, lineup injuries, and odds",
      context: baseContext({
        liveDataStatus: "fixture_only",
        upcomingMatches: [
          {
            matchId: "m2",
            round: "round_of_32",
            homeTeamName: "Brazil",
            awayTeamName: "Japan",
            homeScore: null,
            awayScore: null,
            homePenaltyScore: null,
            awayPenaltyScore: null,
            winnerTeamName: null,
            status: "scheduled",
            minute: null,
            injuryTime: null,
            startsAt: "2026-06-16T20:00:00.000Z",
            venueName: null,
            venueCity: null,
            apiStatusShort: "NS",
            lastSyncedAt: "2026-06-15T20:30:00.000Z",
          },
        ],
      }),
    })

    /*
     * ⚠ THE REFUSAL GOT MORE SPECIFIC, WHICH IS AN IMPROVEMENT THIS TEST WAS
     * PINNED AGAINST. It required the GENERIC "I don't have reliable data for
     * that yet ... Ask me for pool standings" fallback. A prompt that names a
     * team and asks for player stats now takes a dedicated roster branch
     * (worldCupChimmyReplyPolicy.ts:653) which says WHICH data is missing and
     * WHAT an admin must run, instead of a generic shrug.
     *
     * Both messages still exist — the generic redirect at :1052 continues to
     * serve prompts that do not name a team — so this is a routing change, not a
     * deletion. Every invariant the test actually exists to protect is unchanged
     * and still asserted below: no model call, deterministic provider, and no
     * fabricated scoreline.
     *
     * The `not.toContain` is deliberate: it pins the specialization, so a
     * regression back to the generic shrug for this prompt fails here.
     */
    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toContain("roster loaded yet")
    expect(result.reply).toContain("syncWorldCupRosters")
    expect(result.reply).not.toContain(reliableDataUnavailableMessage("en"))
    expect(result.reply).not.toMatch(/\b\d{1,2}-\d{1,2}\b/)
  })

  it("hallucination guard blocks unknown score even when a live feed exists", () => {
    const guarded = enforceWorldCupChimmyReplyGuard({
      reply: "Argentina are live at 2-1, but Brazil are somehow up 9-8 too.",
      prompt: "what is happening live?",
      context: baseContext({
        liveDataStatus: "live",
        liveMatches: [
          {
            matchId: "m1",
            round: "round_of_16",
            homeTeamName: "Argentina",
            awayTeamName: "France",
            homeScore: 2,
            awayScore: 1,
            homePenaltyScore: null,
            awayPenaltyScore: null,
            winnerTeamName: null,
            status: "live",
            minute: 67,
            injuryTime: null,
            startsAt: "2026-06-15T20:00:00.000Z",
            venueName: null,
            venueCity: null,
            apiStatusShort: "LIVE",
            lastSyncedAt: "2026-06-15T20:30:00.000Z",
          },
        ],
      }),
      locale: "en",
    })

    expect(guarded).not.toMatch(/9-8/)
    expect(guarded).toMatch(/won't guess/i)
  })
})
