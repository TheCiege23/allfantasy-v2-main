import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  platformConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { isLiveReady, setLiveReady } from "@/lib/commissioner-ui/liveReadiness"

describe("commissioner-os live readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("defaults to false for every namespace when no row exists yet", async () => {
    prismaMock.platformConfig.findUnique.mockResolvedValue(null)
    for (const moduleId of ["league-health", "activity", "help", "search" as never]) {
      expect(await isLiveReady(moduleId)).toBe(false)
    }
  })

  it("set then get roundtrips true, scoped to the exact module id's own key", async () => {
    prismaMock.platformConfig.upsert.mockResolvedValue({ key: "commissioner_os_live_ready_league-health", value: "true" })
    await setLiveReady("league-health", true)
    expect(prismaMock.platformConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "commissioner_os_live_ready_league-health" } })
    )

    prismaMock.platformConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      where.key === "commissioner_os_live_ready_league-health" ? Promise.resolve({ value: "true" }) : Promise.resolve(null)
    )
    expect(await isLiveReady("league-health")).toBe(true)
    expect(await isLiveReady("activity")).toBe(false)
  })

  it("degrades gracefully to false when the underlying config read fails, never throwing", async () => {
    prismaMock.platformConfig.findUnique.mockRejectedValue(new Error("db unavailable"))
    await expect(isLiveReady("league-health")).resolves.toBe(false)
  })
})
