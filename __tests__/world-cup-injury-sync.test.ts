import { beforeEach, describe, expect, it, vi } from "vitest"

const getProviderMock = vi.hoisted(() => vi.fn())
const injuryFindFirstMock = vi.hoisted(() => vi.fn())
const injuryUpsertMock = vi.hoisted(() => vi.fn())
const entryFindManyMock = vi.hoisted(() => vi.fn())
const createPlatformNotificationMock = vi.hoisted(() => vi.fn())
const dispatchNotificationMock = vi.hoisted(() => vi.fn())
const recordProviderSyncMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/world-cup/worldCupDataProvider", async () => {
  class WorldCupProviderConfigError extends Error {
    constructor(public readonly provider: string, message: string) {
      super(message)
    }
  }
  return {
    getWorldCupDataProvider: getProviderMock,
    WorldCupProviderConfigError,
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    injuryReportRecord: {
      findFirst: injuryFindFirstMock,
      upsert: injuryUpsertMock,
    },
    worldCupBracketEntry: {
      findMany: entryFindManyMock,
    },
  },
}))

vi.mock("@/lib/platform/notification-service", () => ({
  createPlatformNotification: createPlatformNotificationMock,
}))
vi.mock("@/lib/notifications/NotificationDispatcher", () => ({
  dispatchNotification: dispatchNotificationMock,
}))

vi.mock("@/lib/provider-sync-logger", () => ({
  recordProviderSync: recordProviderSyncMock,
}))

describe("syncWorldCupInjuries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderMock.mockResolvedValue({
      name: "apifootball",
      getInjuries: vi.fn().mockResolvedValue([
        {
          providerPlayerId: "p-10",
          playerName: "Alex Striker",
          teamName: "Brazil",
          status: "Questionable",
          bodyPart: "Hamstring",
          notes: "Hamstring",
          fixtureProviderId: "fixture-1",
          fixtureDate: "2026-06-12T20:00:00Z",
        },
      ]),
    })
    injuryFindFirstMock.mockResolvedValue(null)
    injuryUpsertMock.mockResolvedValue({})
    entryFindManyMock.mockResolvedValue([
      {
        id: "entry-1",
        userId: "user-1",
        challengeId: "challenge-1",
        name: "Main",
        challenge: { id: "challenge-1", name: "Office Pool", ownerUserId: "owner-1" },
      },
    ])
    createPlatformNotificationMock.mockResolvedValue(true)
    dispatchNotificationMock.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
    recordProviderSyncMock.mockResolvedValue(undefined)
  })

  it("writes new injury rows and notifies affected users and commissioners", async () => {
    const { syncWorldCupInjuries } = await import("@/lib/world-cup/worldCupDataSyncService")

    const result = await syncWorldCupInjuries({ provider: "apifootball", seasonYear: 2026 })

    expect(result.created).toBe(1)
    expect(result.notificationsCreated).toBe(2)
    expect(injuryUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        sport: "WC_SOCCER",
        playerId: "p-10",
        playerName: "Alex Striker",
        team: "Brazil",
        status: "Questionable",
      }),
    }))
    expect(entryFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.any(Array),
      }),
    }))
    expect(createPlatformNotificationMock).toHaveBeenCalledTimes(2)
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(2)
    expect(dispatchNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      category: "bracket_updates", type: "world_cup_injury_update",
      actionHref: "/brackets/world-cup/challenge-1",
      skipChannels: { inApp: true, email: true, sms: true },
    }))
  })

  it("does not notify when the latest cached injury is unchanged", async () => {
    injuryFindFirstMock.mockResolvedValue({ id: "injury-1", status: "Questionable", notes: "Hamstring" })
    const { syncWorldCupInjuries } = await import("@/lib/world-cup/worldCupDataSyncService")

    const result = await syncWorldCupInjuries({ provider: "apifootball", seasonYear: 2026 })

    expect(result.skipped).toBe(1)
    expect(result.notificationsCreated).toBe(0)
    expect(createPlatformNotificationMock).not.toHaveBeenCalled()
    expect(dispatchNotificationMock).not.toHaveBeenCalled()
  })

  it("reports not tracked yet when the provider has no injury endpoint", async () => {
    getProviderMock.mockResolvedValue({ name: "mock" })
    const { syncWorldCupInjuries } = await import("@/lib/world-cup/worldCupDataSyncService")

    const result = await syncWorldCupInjuries({ provider: "mock", seasonYear: 2026 })

    expect(result.warnings[0]).toMatch(/does not expose World Cup injury data/)
    expect(injuryUpsertMock).not.toHaveBeenCalled()
  })
})
