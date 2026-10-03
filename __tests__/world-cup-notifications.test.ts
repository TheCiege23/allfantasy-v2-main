import { beforeEach, describe, expect, it, vi } from "vitest"

const createPlatformNotificationMock = vi.hoisted(() => vi.fn())
const sendSmsMock = vi.hoisted(() => vi.fn())
const getSettingsProfileMock = vi.hoisted(() => vi.fn())
const challengeFindUniqueMock = vi.hoisted(() => vi.fn())
const participantFindManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/platform/notification-service", () => ({
  createPlatformNotification: createPlatformNotificationMock,
}))

vi.mock("@/lib/twilio-client", () => ({
  sendSms: sendSmsMock,
}))

vi.mock("@/lib/user-settings", () => ({
  getSettingsProfile: getSettingsProfileMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupBracketChallenge: { findUnique: challengeFindUniqueMock },
    worldCupBracketParticipant: { findMany: participantFindManyMock },
  },
}))

function profile(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-2",
    phone: "+15555550100",
    phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    notificationPreferences: {
      worldCup: {
        inAppEnabled: true,
        smsEnabled: true,
      },
      // The opt-in record /api/verify/phone/start writes; a verified phone alone is not consent.
      smsConsent: { consentedAt: "2026-01-01T00:00:00.000Z", phone: "+15555550100" },
    },
    ...overrides,
  }
}

describe("worldCupNotifications", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.TWILIO_ACCOUNT_SID = "AC_TEST"
    process.env.TWILIO_PHONE_NUMBER = "+15555550000"
    process.env.TWILIO_AUTH_TOKEN = "token"
    delete process.env.TWILIO_API_KEY
    delete process.env.TWILIO_API_SECRET
    createPlatformNotificationMock.mockResolvedValue(true)
    sendSmsMock.mockResolvedValue(true)
    getSettingsProfileMock.mockResolvedValue(profile())
    challengeFindUniqueMock.mockResolvedValue({ name: "Office Pool" })
    participantFindManyMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
      { userId: "user-3" },
    ])
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("sends @username SMS only with verified phone and opt-in", async () => {
    const { notifyWorldCupMention } = await import("@/lib/world-cup/worldCupNotifications")

    const diagnostics = await notifyWorldCupMention({
      challengeId: "pool-1",
      poolName: "Office Pool",
      senderName: "Alex",
      body: "hey @friend",
      messageId: "msg-1",
      senderUserId: "user-1",
      targetUserIds: ["user-2"],
    })

    expect(createPlatformNotificationMock).toHaveBeenCalledTimes(1)
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
    expect(sendSmsMock.mock.calls[0]?.[1]).toContain("You were mentioned in World Cup Pool: Office Pool")
    expect(diagnostics[0]).toMatchObject({ smsEligible: true, smsSent: true, twilioConfigured: true })
  })

  it("does not SMS @username when pool is muted", async () => {
    getSettingsProfileMock.mockResolvedValue(profile({
      notificationPreferences: {
        worldCup: {
          smsEnabled: true,
          pools: { "pool-1": { poolMuted: true } },
        },
      },
    }))
    const { notifyWorldCupMention } = await import("@/lib/world-cup/worldCupNotifications")

    const diagnostics = await notifyWorldCupMention({
      challengeId: "pool-1",
      senderName: "Alex",
      body: "hey @friend",
      messageId: "msg-1",
      senderUserId: "user-1",
      targetUserIds: ["user-2"],
    })

    expect(createPlatformNotificationMock).not.toHaveBeenCalled()
    expect(sendSmsMock).not.toHaveBeenCalled()
    expect(diagnostics[0]).toMatchObject({ smsEligible: false, smsSent: false, skippedReason: "pool_muted" })
  })

  it("@all notifies unmuted pool members and does not duplicate the sender", async () => {
    getSettingsProfileMock.mockImplementation(async (userId: string) => {
      if (userId === "user-3") {
        return profile({
          userId,
          notificationPreferences: { worldCup: { smsEnabled: true, pools: { "pool-1": { poolMuted: true } } } },
        })
      }
      return profile({ userId })
    })
    const { notifyWorldCupAllMention } = await import("@/lib/world-cup/worldCupNotifications")

    const diagnostics = await notifyWorldCupAllMention({
      challengeId: "pool-1",
      poolName: "Office Pool",
      senderName: "Alex",
      body: "@all picks lock tonight",
      messageId: "msg-2",
      senderUserId: "user-1",
    })

    expect(diagnostics.map((d) => d.userId)).toEqual(["user-2", "user-3"])
    expect(createPlatformNotificationMock).toHaveBeenCalledTimes(1)
    expect(createPlatformNotificationMock.mock.calls[0]?.[0]).toMatchObject({ userId: "user-2" })
    expect(sendSmsMock).toHaveBeenCalledTimes(1)
    // The poster's words and name stay in-app: user-written text is not sent over SMS.
    const text = String(sendSmsMock.mock.calls[0]?.[1])
    expect(text).toContain("Office Pool")
    expect(text).not.toContain("picks lock tonight")
    expect(text).not.toContain("Alex")
  })

  it("does not SMS a verified phone with SMS switched on but no stored opt-in", async () => {
    getSettingsProfileMock.mockResolvedValue(profile({
      notificationPreferences: { worldCup: { inAppEnabled: true, smsEnabled: true } },
    }))
    const { notifyWorldCupMention } = await import("@/lib/world-cup/worldCupNotifications")

    const diagnostics = await notifyWorldCupMention({
      challengeId: "pool-1",
      poolName: "Office Pool",
      senderName: "Alex",
      body: "hey @friend",
      messageId: "msg-9",
      senderUserId: "user-1",
      targetUserIds: ["user-2"],
    })

    expect(createPlatformNotificationMock).toHaveBeenCalledTimes(1)
    expect(sendSmsMock).not.toHaveBeenCalled()
    expect(diagnostics[0]).toMatchObject({ smsEligible: false, smsSent: false })
  })

  it("private Chimmy notification is sender-only and private-safe", async () => {
    const { notifyWorldCupChimmyReply } = await import("@/lib/world-cup/worldCupNotifications")

    await notifyWorldCupChimmyReply({
      challengeId: "pool-1",
      poolName: "Office Pool",
      userId: "user-1",
      messageId: "msg-3",
    })

    expect(createPlatformNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      meta: expect.objectContaining({ privateSafe: true }),
    }))
    expect(createPlatformNotificationMock.mock.calls[0]?.[0]?.body).not.toContain("@chimmy")
  })

  it("general chat does not SMS by default when disabled", async () => {
    const { isWorldCupNotificationTypeEnabled, resolveWorldCupNotificationPreferences } = await import("@/lib/world-cup/worldCupNotificationPreferences")
    const prefs = resolveWorldCupNotificationPreferences({ worldCup: { smsEnabled: true } }, "pool-1")

    expect(isWorldCupNotificationTypeEnabled(prefs, "generalChat")).toBe(false)
    expect(sendSmsMock).not.toHaveBeenCalled()
  })

  it("bracket finalized creates in-app notification", async () => {
    const { notifyWorldCupBracketFinalized } = await import("@/lib/world-cup/worldCupNotifications")

    await notifyWorldCupBracketFinalized({
      challengeId: "pool-1",
      poolName: "Office Pool",
      userId: "user-1",
      entryId: "entry-1",
    })

    expect(createPlatformNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      type: "world_cup_bracketFinalized",
      title: "World Cup bracket finalized",
    }))
  })

  it("does not expose Twilio secret values in diagnostics or payloads", async () => {
    const { notifyWorldCupMention } = await import("@/lib/world-cup/worldCupNotifications")

    const diagnostics = await notifyWorldCupMention({
      challengeId: "pool-1",
      senderName: "Alex",
      body: "hey @friend",
      messageId: "msg-4",
      senderUserId: "user-1",
      targetUserIds: ["user-2"],
    })
    const serialized = JSON.stringify({ diagnostics, notification: createPlatformNotificationMock.mock.calls })

    expect(serialized).not.toContain("token")
    expect(serialized).not.toContain("AC_TEST")
    expect(serialized).not.toContain("+15555550000")
  })
})
