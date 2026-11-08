import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  playoffBracketChallenge: { findUnique: vi.fn() },
  playoffBracketEntry: { findMany: vi.fn(), create: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/auth/admin", () => ({ hasPoolAdminAccess: () => false }))
vi.mock("@/lib/entitlements/afCommissionerPlan", () => ({ hasAfCommissionerPlan: async () => false }))

import { cfpInviteCode } from "@/lib/playoffs/cfpInvite"
import { createPlayoffBracketEntry, getPlayoffBracketView } from "@/lib/playoffs/playoffService"

const pool = { id: "cmw79xpf10008wmae48wlfp85", ownerUserId: "owner", sport: "ncaaf", seasonYear: 2026,
  isTestMode: true, config: { visibility: "private", maxParticipants: 50, maxEntriesPerParticipant: 2 }, series: [], entries: [] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXTAUTH_SECRET", "test-only-secret-that-is-at-least-32-characters")
  db.playoffBracketChallenge.findUnique.mockResolvedValue(pool)
  db.playoffBracketEntry.findMany.mockResolvedValue([])
  db.playoffBracketEntry.create.mockResolvedValue({ id: "new-entry" })
})

describe("private CFP pool access", () => {
  it("does not reveal the pool to a stranger or accept a guessed legacy invite", async () => {
    await expect(getPlayoffBracketView({ challengeId: pool.id, user: null })).resolves.toBeNull()
    await expect(getPlayoffBracketView({ challengeId: pool.id, user: { id: "stranger" }, inviteCode: pool.id.slice(0, 8) })).resolves.toBeNull()
    await expect(createPlayoffBracketEntry({ challengeId: pool.id, user: { id: "stranger" }, inviteCode: pool.id.slice(0, 8) })).rejects.toThrow(/valid CFP invitation/)
    expect(db.playoffBracketEntry.create).not.toHaveBeenCalled()
  })

  it("allows a valid invitation to create an entry", async () => {
    const inviteCode = cfpInviteCode(pool.id)
    await expect(createPlayoffBracketEntry({ challengeId: pool.id, user: { id: "new-member" }, inviteCode })).resolves.toMatchObject({ entryId: "new-entry" })
    expect(db.playoffBracketEntry.create).toHaveBeenCalledOnce()
  })

  it("allows an existing member without the retired link", async () => {
    db.playoffBracketEntry.findMany.mockResolvedValueOnce([{ id: "previous", userId: "member" }])
    await expect(createPlayoffBracketEntry({ challengeId: pool.id, user: { id: "member" } })).resolves.toMatchObject({ entryId: "new-entry" })
  })
})
