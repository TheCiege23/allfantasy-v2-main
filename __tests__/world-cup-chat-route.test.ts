import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const requireUserMock = vi.hoisted(() => vi.fn())
const memberAccessMock = vi.hoisted(() => vi.fn())
const managerAccessMock = vi.hoisted(() => vi.fn())
const hasAiMock = vi.hoisted(() => vi.fn())
const notifyMentionMock = vi.hoisted(() => vi.fn())
const notifyAllMentionMock = vi.hoisted(() => vi.fn())
const notifyChimmyReplyMock = vi.hoisted(() => vi.fn())
const generateChimmyReplyMock = vi.hoisted(() => vi.fn())
const createPlatformThreadMock = vi.hoisted(() => vi.fn())
const findManyMessagesMock = vi.hoisted(() => vi.fn())
const findFirstMessageMock = vi.hoisted(() => vi.fn())
const createMessageMock = vi.hoisted(() => vi.fn())
const updateMessageMock = vi.hoisted(() => vi.fn())
const countMessagesMock = vi.hoisted(() => vi.fn())
const findManyParticipantsMock = vi.hoisted(() => vi.fn())

vi.mock("@/app/api/brackets/world-cup/_utils", () => ({
  requireWorldCupApiUser: requireUserMock,
  assertWorldCupChallengeMemberOrManager: memberAccessMock,
  assertWorldCupManager: managerAccessMock,
  worldCupChallengeParamsSchema: z.object({ challengeId: z.string().min(1) }),
}))

vi.mock("@/lib/bracket-brain/bracketBrainAccess", () => ({
  userHasBracketBrainAi: hasAiMock,
}))

vi.mock("@/lib/world-cup/worldCupNotifications", () => ({
  notifyWorldCupMention: notifyMentionMock,
  notifyWorldCupAllMention: notifyAllMentionMock,
  notifyWorldCupChimmyReply: notifyChimmyReplyMock,
}))

vi.mock("@/lib/world-cup/worldCupChimmyPrivateReply", () => ({
  generateWorldCupChimmyPrivateReply: generateChimmyReplyMock,
  ChimmyTokenSpendFailedError: class ChimmyTokenSpendFailedError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = "ChimmyTokenSpendFailedError"
    }
  },
}))

vi.mock("@/lib/platform/chat-service", () => ({
  createPlatformThread: createPlatformThreadMock,
}))

// next/headers cookies() requires an AsyncLocalStorage request scope that vitest
// does not provide. Mock it to return a minimal stub so @chimmy AI tests can run.
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupBracketChatEvent: {
      findMany: findManyMessagesMock,
      findFirst: findFirstMessageMock,
      create: createMessageMock,
      update: updateMessageMock,
      count: countMessagesMock,
    },
    worldCupBracketParticipant: {
      findMany: findManyParticipantsMock,
    },
    // Token fallback gate (prepareWorldCupAiTokenFallback -> TokenSpendService).
    // Seed sync + a zero balance, so a non-entitled user gets the 402 path.
    tokenPackage: { upsert: vi.fn().mockResolvedValue({}) },
    tokenRefundRule: { upsert: vi.fn().mockResolvedValue({}) },
    tokenSpendRule: {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        code: "world_cup_ai_chimmy_coaching",
        featureLabel: "World Cup Chimmy coaching",
        tokenCost: 1,
        requiresConfirmation: true,
        isActive: true,
      }),
    },
    userTokenBalance: {
      upsert: vi.fn().mockResolvedValue({
        balance: 0,
        lifetimePurchased: 0,
        lifetimeSpent: 0,
        lifetimeRefunded: 0,
        updatedAt: new Date("2026-06-01T12:00:00.000Z"),
      }),
    },
    // EntitlementResolver.resolveSnapshot
    userSubscription: { findMany: vi.fn().mockResolvedValue([]) },
    adminSubscriptionGrant: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

function request(body?: unknown) {
  return new Request("http://localhost/api/brackets/world-cup/c1/chat", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function dbMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    challengeId: "c1",
    userId: "user-1",
    eventType: "world_cup.pool_chat_message",
    eventTitle: "Pool chat",
    eventBody: "hello pool",
    metadata: { visibility: "public", messageType: "text" },
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    isAiGenerated: false,
    user: { displayName: "User One", username: "userone", email: "u1@example.com", avatarUrl: null },
    ...overrides,
  }
}

describe("World Cup pool chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({
      ok: true,
      user: { id: "user-1", email: "u1@example.com", name: "User One" },
    })
    memberAccessMock.mockResolvedValue({ ok: true })
    managerAccessMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    hasAiMock.mockResolvedValue(false)
    notifyMentionMock.mockResolvedValue([])
    notifyAllMentionMock.mockResolvedValue([])
    notifyChimmyReplyMock.mockResolvedValue([])
    generateChimmyReplyMock.mockResolvedValue({
      reply: "Keep it simple: prioritize the group winner path.",
      conversationId: "chimmy:user-1:world-cup:c1",
      provider: "openai",
      model: "gpt-test",
      billingDecision: {
        shouldChargeToken: true,
        reason: "llm_required",
        displayHint: "1 token used · AI coaching answer",
      },
    })
    createPlatformThreadMock.mockResolvedValue({
      id: "thread-1",
      threadType: "dm",
      productType: "bracket",
      title: "Friend",
      lastMessageAt: "2026-06-01T12:00:00.000Z",
      unreadCount: 0,
      memberCount: 2,
      context: {},
    })
    findManyMessagesMock.mockResolvedValue([])
    findFirstMessageMock.mockResolvedValue(null)
    countMessagesMock.mockResolvedValue(0)
    findManyParticipantsMock.mockResolvedValue([])
    createMessageMock.mockImplementation(async ({ data }) => dbMessage({
      id: data.isAiGenerated ? "chimmy-response-1" : "created-1",
      userId: data.userId,
      eventType: data.eventType,
      eventBody: data.eventBody,
      metadata: data.metadata,
      isAiGenerated: data.isAiGenerated,
    }))
    updateMessageMock.mockImplementation(async ({ data }) => dbMessage({
      id: "poll-1",
      eventBody: "Who wins Group A?",
      metadata: data.metadata,
    }))
  })

  it("allows a member to GET visible chat messages", async () => {
    findManyMessagesMock.mockResolvedValue([dbMessage()])
    const { GET } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await GET(request(), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.messages).toHaveLength(1)
    expect(json.messages[0]).toMatchObject({ body: "hello pool", authorName: "User One" })
  })

  it("rejects non-members from GET", async () => {
    memberAccessMock.mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) })
    const { GET } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await GET(request(), { params: { challengeId: "c1" } })

    expect(res.status).toBe(403)
  })

  it("lists World Cup pool members for the DM picker", async () => {
    findManyParticipantsMock.mockResolvedValue([
      {
        userId: "user-1",
        displayName: "Owner",
        joinedAt: new Date("2026-06-01T12:00:00.000Z"),
        user: { id: "user-1", username: "owner", displayName: "Owner", email: "owner@example.com", avatarUrl: null },
      },
      {
        userId: "user-2",
        displayName: "Friend",
        joinedAt: new Date("2026-06-01T12:10:00.000Z"),
        user: { id: "user-2", username: "friend", displayName: "Friend", email: "friend@example.com", avatarUrl: "https://example.com/a.png" },
      },
    ])
    const { GET } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await GET(new Request("http://localhost/api/brackets/world-cup/c1/chat?action=members"), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.members).toEqual([
      expect.objectContaining({ userId: "user-1", username: "owner", isCurrentUser: true }),
      expect.objectContaining({ userId: "user-2", username: "friend", isCurrentUser: false }),
    ])
  })

  it("starts a World Cup private DM only with pool members", async () => {
    findManyParticipantsMock.mockResolvedValue([{ userId: "user-2" }])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({
      action: "start_dm",
      memberUserIds: ["user-2"],
    }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(createPlatformThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      creatorUserId: "user-1",
      threadType: "dm",
      productType: "bracket",
      memberUserIds: ["user-2"],
    }))
    expect(json.thread.id).toBe("thread-1")
  })

  it("blocks World Cup private DMs to users outside the pool", async () => {
    findManyParticipantsMock.mockResolvedValue([])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({
      action: "start_dm",
      memberUserIds: ["outsider"],
    }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(403)
    expect(createPlatformThreadMock).not.toHaveBeenCalled()
  })

  it("allows a member to POST public text", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ body: "hello @friend" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "world_cup.pool_chat_message",
        eventBody: "hello @friend",
      }),
    }))
    expect(json.message.body).toBe("hello @friend")
  })

  it("persists safe GIF metadata with a chat message", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const gif = {
      id: "gif-1",
      title: "Goal",
      previewUrl: "https://media.klipy.com/gifs/goal.webp",
      gifUrl: "https://media.klipy.com/gifs/goal.gif",
      width: 320,
      height: 180,
      provider: "klipy",
    }
    const res = await POST(request({ body: "Goal GIF", gif }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventBody: "Goal GIF",
        metadata: expect.objectContaining({
          messageType: "gif",
          gif,
        }),
      }),
    }))
    expect(json.message.gif).toMatchObject(gif)
  })

  it("persists safe Cloudinary image metadata with a chat message", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const image = {
      assetId: "asset-1",
      publicId: "allfantasy/world-cup/c1/chat/image",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/image.png",
      width: 320,
      height: 200,
      format: "png",
      bytes: 1234,
      provider: "cloudinary",
    }
    const res = await POST(request({ body: "Image", image }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventBody: "Image",
        metadata: expect.objectContaining({
          messageType: "image",
          image,
        }),
      }),
    }))
    expect(json.message.image).toMatchObject(image)
  })

  it("lets members create valid polls through the consolidated chat route", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({
      action: "create_poll",
      question: "Who wins Group A?",
      options: ["Mexico", "South Africa", "Uruguay"],
    }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventTitle: "Pool poll",
        eventBody: "Who wins Group A?",
        metadata: expect.objectContaining({
          messageType: "poll",
          poll: expect.objectContaining({
            question: "Who wins Group A?",
            options: [
              { id: "option-1", label: "Mexico" },
              { id: "option-2", label: "South Africa" },
              { id: "option-3", label: "Uruguay" },
            ],
            votes: [],
            createdByUserId: "user-1",
            closedAt: null,
          }),
        }),
      }),
    }))
    expect(json.message.poll).toMatchObject({
      question: "Who wins Group A?",
      totalVotes: 0,
      currentUserVote: null,
    })
  })

  it("blocks non-members from creating polls", async () => {
    memberAccessMock.mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) })
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ action: "create_poll", question: "Pick one", options: ["A", "B"] }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(403)
    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it("validates poll question and option counts", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const missingQuestion = await POST(request({ action: "create_poll", question: "", options: ["A", "B"] }), { params: { challengeId: "c1" } })
    const tooFewOptions = await POST(request({ action: "create_poll", question: "Pick one", options: ["A"] }), { params: { challengeId: "c1" } })
    const tooManyOptions = await POST(request({ action: "create_poll", question: "Pick one", options: ["A", "B", "C", "D", "E", "F", "G"] }), { params: { challengeId: "c1" } })

    expect(missingQuestion.status).toBe(400)
    expect(tooFewOptions.status).toBe(400)
    expect(tooManyOptions.status).toBe(400)
  })

  it("rejects duplicate or effectively empty poll options after cleanup", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const duplicate = await POST(request({ action: "create_poll", question: "Pick one", options: ["Mexico", " mexico "] }), { params: { challengeId: "c1" } })
    const emptyAfterCleanup = await POST(request({ action: "create_poll", question: "Pick one", options: ["< > ", "Mexico"] }), { params: { challengeId: "c1" } })

    expect(duplicate.status).toBe(400)
    expect(emptyAfterCleanup.status).toBe(400)
  })

  it("serializes poll summary for GET messages", async () => {
    findManyMessagesMock.mockResolvedValue([
      dbMessage({
        id: "poll-1",
        eventBody: "Who wins Group A?",
        metadata: {
          visibility: "public",
          messageType: "poll",
          poll: {
            question: "Who wins Group A?",
            options: [
              { id: "option-1", label: "Mexico" },
              { id: "option-2", label: "Uruguay" },
            ],
            votes: [
              { userId: "user-1", optionId: "option-1", votedAt: "2026-06-01T12:00:00.000Z" },
              { userId: "user-2", optionId: "option-2", votedAt: "2026-06-01T12:01:00.000Z" },
            ],
            createdByUserId: "user-1",
            createdAt: "2026-06-01T11:59:00.000Z",
            closedAt: null,
          },
        },
      }),
    ])
    const { GET } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await GET(request(), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.messages[0].poll).toMatchObject({
      question: "Who wins Group A?",
      currentUserVote: "option-1",
      totalVotes: 2,
      options: [
        { id: "option-1", label: "Mexico", votes: 1, percentage: 50 },
        { id: "option-2", label: "Uruguay", votes: 1, percentage: 50 },
      ],
    })
  })

  it("lets members vote and change their poll vote while open", async () => {
    const pollRow = dbMessage({
      id: "poll-1",
      eventBody: "Who wins Group A?",
      metadata: {
        visibility: "public",
        messageType: "poll",
        poll: {
          question: "Who wins Group A?",
          options: [
            { id: "option-1", label: "Mexico" },
            { id: "option-2", label: "Uruguay" },
          ],
          votes: [{ userId: "user-1", optionId: "option-1", votedAt: "2026-06-01T12:00:00.000Z" }],
          createdByUserId: "user-2",
          createdAt: "2026-06-01T11:59:00.000Z",
          closedAt: null,
        },
      },
    })
    findFirstMessageMock.mockResolvedValue(pollRow)
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ action: "poll_vote", messageId: "poll-1", optionId: "option-2" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(updateMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "poll-1" },
      data: {
        metadata: expect.objectContaining({
          poll: expect.objectContaining({
            votes: [expect.objectContaining({ userId: "user-1", optionId: "option-2" })],
          }),
        }),
      },
    }))
    expect(json.poll.currentUserVote).toBe("option-2")
  })

  it("rejects non-members and invalid options for poll votes", async () => {
    const pollRow = dbMessage({
      id: "poll-1",
      metadata: {
        visibility: "public",
        messageType: "poll",
        poll: {
          question: "Who wins Group A?",
          options: [{ id: "option-1", label: "Mexico" }],
          votes: [],
          closedAt: null,
        },
      },
    })
    findFirstMessageMock.mockResolvedValue(pollRow)
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const invalidOption = await POST(request({ action: "poll_vote", messageId: "poll-1", optionId: "missing" }), { params: { challengeId: "c1" } })
    memberAccessMock.mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) })
    const blocked = await POST(request({ action: "poll_vote", messageId: "poll-1", optionId: "option-1" }), { params: { challengeId: "c1" } })

    expect(invalidOption.status).toBe(400)
    expect(blocked.status).toBe(403)
  })

  it("rejects arbitrary external image URLs", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({
      body: "bad image",
      image: {
        assetId: "asset-1",
        publicId: "external/image",
        secureUrl: "https://example.com/image.png",
        width: 320,
        height: 200,
        format: "png",
        bytes: 1234,
        provider: "cloudinary",
      },
    }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(400)
  })

  it("rejects arbitrary external GIF URLs", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({
      body: "bad gif",
      gif: {
        id: "bad",
        title: "Bad",
        previewUrl: "https://evil.example.com/gif.webp",
        gifUrl: "https://evil.example.com/gif.gif",
        width: 1,
        height: 1,
        provider: "klipy",
      },
    }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(400)
  })

  it("blocks @global for normal users", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ body: "@global update" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toMatch(/commissioner-only/i)
  })

  it("returns coming soon for @global managers", async () => {
    managerAccessMock.mockResolvedValue({ ok: true })
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ body: "@global update" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("WORLD_CUP_GLOBAL_BROADCAST_COMING_SOON")
  })

  it("blocks @all for normal users and allows managers", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const blocked = await POST(request({ body: "@all deadline" }), { params: { challengeId: "c1" } })
    expect(blocked.status).toBe(403)

    managerAccessMock.mockResolvedValue({ ok: true })
    const allowed = await POST(request({ body: "@all deadline" }), { params: { challengeId: "c1" } })
    expect(allowed.status).toBe(201)
  })

  it("keeps @chimmy locked without AI and private when AI is enabled", async () => {
    const { POST, GET } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const locked = await POST(request({ body: "@chimmy help me" }), { params: { challengeId: "c1" } })
    expect(locked.status).toBe(402)
    expect(generateChimmyReplyMock).not.toHaveBeenCalled()

    hasAiMock.mockResolvedValue(true)
    const created = await POST(request({ body: "@chimmy help me" }), { params: { challengeId: "c1" } })
    const createdJson = await created.json()
    expect(created.status).toBe(201)
    expect(createMessageMock).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "world_cup.pool_chat_chimmy_private",
        metadata: expect.objectContaining({
          visibility: "private_to_user",
          targetUserId: "user-1",
          messageType: "chimmy_private_response",
        }),
      }),
    }))
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventTitle: "Private Chimmy prompt",
        eventBody: "@chimmy help me",
        isAiGenerated: false,
        metadata: expect.objectContaining({
          visibility: "private_to_user",
          targetUserId: "user-1",
          messageType: "chimmy_private_prompt",
        }),
      }),
    }))
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventTitle: "Private Chimmy reply",
        eventBody: "Keep it simple: prioritize the group winner path.",
        isAiGenerated: true,
        metadata: expect.objectContaining({
          visibility: "private_to_user",
          targetUserId: "user-1",
          authorName: "Chimmy",
          source: "world_cup_pool_chat",
        }),
      }),
    }))
    expect(generateChimmyReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      challengeId: "c1",
      prompt: "@chimmy help me",
    }))
    expect(createdJson.messages).toHaveLength(2)
    expect(createdJson.chimmyResponse).toMatchObject({
      authorName: "Chimmy",
      body: "Keep it simple: prioritize the group winner path.",
      isPrivate: true,
    })
    expect(JSON.stringify(createdJson)).not.toMatch(/OPENAI|sk-/i)

    requireUserMock.mockResolvedValue({ ok: true, user: { id: "user-2", email: "u2@example.com" } })
    findManyMessagesMock.mockResolvedValue([
      dbMessage({
        eventType: "world_cup.pool_chat_chimmy_private",
        metadata: { visibility: "private_to_user", targetUserId: "user-1" },
      }),
    ])
    const privateList = await GET(request(), { params: { challengeId: "c1" } })
    const json = await privateList.json()
    expect(json.messages).toHaveLength(0)
  })

  it("allows cache-grounded Chimmy pool questions for non-Pro users without opening the LLM gate", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ action: "chimmy_private", body: "Who is leading?" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(generateChimmyReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      challengeId: "c1",
      prompt: "Who is leading?",
      deterministicOnly: true,
    }))
    expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventTitle: "Private Chimmy prompt",
        eventBody: "Who is leading?",
        metadata: expect.objectContaining({
          visibility: "private_to_user",
          targetUserId: "user-1",
          messageType: "chimmy_private_prompt",
        }),
      }),
    }))
    expect(json.messages).toHaveLength(2)
  })

  it("shows sender both private Chimmy prompt and response on GET", async () => {
    hasAiMock.mockResolvedValue(true)
    findManyMessagesMock.mockResolvedValue([
      dbMessage({
        id: "chimmy-response-1",
        userId: null,
        eventType: "world_cup.pool_chat_chimmy_private",
        eventBody: "Lean toward the safer group winner path.",
        isAiGenerated: true,
        createdAt: new Date("2026-06-01T12:00:01.000Z"),
        metadata: {
          visibility: "private_to_user",
          targetUserId: "user-1",
          messageType: "chimmy_private_response",
          authorName: "Chimmy",
        },
      }),
      dbMessage({
        id: "chimmy-prompt-1",
        eventType: "world_cup.pool_chat_chimmy_private",
        eventBody: "@chimmy who should I pick?",
        createdAt: new Date("2026-06-01T12:00:00.000Z"),
        metadata: {
          visibility: "private_to_user",
          targetUserId: "user-1",
          messageType: "chimmy_private_prompt",
        },
      }),
    ])
    const { GET } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await GET(request(), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.messages).toHaveLength(2)
    expect(json.messages[0]).toMatchObject({ body: "@chimmy who should I pick?", isPrivate: true })
    expect(json.messages[1]).toMatchObject({ authorName: "Chimmy", body: "Lean toward the safer group winner path.", isPrivate: true })
  })

  it("calls World Cup notification helper for resolved @username mentions", async () => {
    findManyParticipantsMock.mockResolvedValue([
      { userId: "user-2", displayName: "Friend", user: { id: "user-2", username: "friend", displayName: "Friend", email: "friend@example.com" } },
    ])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ body: "hey @friend" }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(201)
    expect(notifyMentionMock).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "c1",
      senderUserId: "user-1",
      messageId: "created-1",
      targetUserIds: ["user-2"],
    }))
  })

  it("@all calls pool-wide notification helper for managers", async () => {
    managerAccessMock.mockResolvedValue({ ok: true })
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ body: "@all deadline" }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(201)
    expect(notifyAllMentionMock).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "c1",
      senderUserId: "user-1",
      messageId: "created-1",
      body: "@all deadline",
    }))
  })

  it("@chimmy calls private sender notification helper when AI is enabled", async () => {
    hasAiMock.mockResolvedValue(true)
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/chat/route")

    const res = await POST(request({ action: "chimmy_private", body: "help me" }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(201)
    expect(notifyChimmyReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "c1",
      userId: "user-1",
      messageId: "chimmy-response-1",
    }))
  })
})
