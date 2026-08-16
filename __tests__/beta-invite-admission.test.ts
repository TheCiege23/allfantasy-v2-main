/**
 * P0-1 BETA-GATE — behavioral tests for the centralized admission service.
 *
 * The admission INVARIANTS live in this service, so this is where they are proven with a
 * mocked Prisma (matching the repo's existing unit-test convention). The register/OAuth
 * routes are too heavy to import, so their WIRING is proven separately by source assertion
 * in beta-gate-account-creation-paths.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    betaInvite: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      create: mocks.create,
      findMany: mocks.findMany,
    },
  },
}))

import {
  admissionErrorMessage,
  consumeAdmission,
  generateRawToken,
  hashToken,
  isInviteOnlyEnabled,
  isWellFormedToken,
  issueInvite,
  listInvites,
  revokeInvite,
  validateAdmission,
} from "@/lib/beta-invite/betaAdmissionService"

const NOW = new Date("2026-07-24T12:00:00.000Z")
const FUTURE = new Date("2026-08-24T12:00:00.000Z")
const PAST = new Date("2026-06-24T12:00:00.000Z")
const RAW = "abcdefghijklmnopqrstuvwxyz012345" // 32 chars, well-formed

function pendingInvite(over: Record<string, unknown> = {}) {
  return { id: "inv-1", invitedEmail: "alice@example.com", status: "pending", expiresAt: null, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateMany.mockResolvedValue({ count: 1 })
})

describe("isInviteOnlyEnabled — signup is OPEN", () => {
  it("is disabled when nothing is configured", () => {
    expect(isInviteOnlyEnabled({})).toBe(false)
  })
  it("stays disabled even when a stale INVITE_ONLY is still set in the environment", () => {
    // The whole point of the open-signup change: a leftover flag in a deployed environment
    // (Vercel/Railway) must NOT be able to re-close public signup behind the repo's back.
    for (const v of ["1", "true", "TRUE", "yes", "on", "maybe"]) {
      expect(isInviteOnlyEnabled({ INVITE_ONLY: v })).toBe(false)
    }
  })
  it("stays disabled in production regardless of the flag (no silent re-closing)", () => {
    expect(isInviteOnlyEnabled({ INVITE_ONLY: "1", VERCEL_ENV: "production" })).toBe(false)
    expect(isInviteOnlyEnabled({ INVITE_ONLY: "maybe", NODE_ENV: "production" })).toBe(false)
  })
  it("reads the real process env without throwing (default-argument path)", () => {
    expect(isInviteOnlyEnabled()).toBe(false)
  })
})

describe("token hashing — the raw token is never the stored value", () => {
  it("hashToken is deterministic and not the raw token", () => {
    expect(hashToken(RAW)).toBe(hashToken(RAW))
    expect(hashToken(RAW)).not.toBe(RAW)
    expect(hashToken(RAW)).toMatch(/^[0-9a-f]{64}$/)
  })
  it("generateRawToken yields distinct, well-formed tokens", () => {
    const a = generateRawToken()
    const b = generateRawToken()
    expect(a).not.toBe(b)
    expect(isWellFormedToken(a)).toBe(true)
  })
  it("rejects obviously malformed tokens without a DB hit", () => {
    expect(isWellFormedToken("short")).toBe(false)
    expect(isWellFormedToken("has spaces and $ymbols!")).toBe(false)
  })
})

describe("validateAdmission — every rejection case", () => {
  it("INVITE_REQUIRED when no token is presented", async () => {
    expect(await validateAdmission({ rawToken: null, email: "alice@example.com" })).toEqual({
      ok: false,
      code: "INVITE_REQUIRED",
    })
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
  it("INVITE_MALFORMED for a junk token", async () => {
    expect(await validateAdmission({ rawToken: "nope", email: "a@b.com" })).toMatchObject({ code: "INVITE_MALFORMED" })
  })
  it("INVITE_NOT_FOUND when no invite matches the digest", async () => {
    mocks.findUnique.mockResolvedValue(null)
    expect(await validateAdmission({ rawToken: RAW, email: "a@b.com" })).toMatchObject({ code: "INVITE_NOT_FOUND" })
  })
  it("INVITE_REVOKED / INVITE_REDEEMED by status", async () => {
    mocks.findUnique.mockResolvedValueOnce(pendingInvite({ status: "revoked" }))
    expect(await validateAdmission({ rawToken: RAW, email: "alice@example.com" })).toMatchObject({ code: "INVITE_REVOKED" })
    mocks.findUnique.mockResolvedValueOnce(pendingInvite({ status: "redeemed" }))
    expect(await validateAdmission({ rawToken: RAW, email: "alice@example.com" })).toMatchObject({ code: "INVITE_REDEEMED" })
  })
  it("INVITE_EXPIRED when past expiry", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite({ expiresAt: PAST }))
    expect(await validateAdmission({ rawToken: RAW, email: "alice@example.com", now: NOW })).toMatchObject({
      code: "INVITE_EXPIRED",
    })
  })
  it("INVITE_EMAIL_MISMATCH when the signup email differs", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite())
    expect(await validateAdmission({ rawToken: RAW, email: "mallory@example.com", now: NOW })).toMatchObject({
      code: "INVITE_EMAIL_MISMATCH",
    })
  })
  it("accepts a valid, matching, unexpired invite (case-insensitive email)", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite({ expiresAt: FUTURE }))
    expect(await validateAdmission({ rawToken: RAW, email: "ALICE@example.com", now: NOW })).toEqual({
      ok: true,
      inviteId: "inv-1",
    })
  })
  it("REJECTS token-only admission (email=null) — an invite is not a transferable code", async () => {
    // Email-bound policy: possession of a token is never sufficient. The Sleeper synthetic
    // -email path passes email=null and must be refused, not admitted.
    mocks.findUnique.mockResolvedValue(pendingInvite())
    expect(await validateAdmission({ rawToken: RAW, email: null, now: NOW })).toMatchObject({
      code: "INVITE_EMAIL_MISMATCH",
    })
  })
  it("REJECTS an invite record that has no bound email", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite({ invitedEmail: "" }))
    expect(await validateAdmission({ rawToken: RAW, email: "alice@example.com", now: NOW })).toMatchObject({
      code: "INVITE_EMAIL_MISMATCH",
    })
  })
})

describe("consumeAdmission — atomic single-use", () => {
  it("consumes exactly once with a status-guarded conditional update", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite())
    mocks.updateMany.mockResolvedValue({ count: 1 })

    const result = await consumeAdmission({ rawToken: RAW, email: "alice@example.com", userId: "u1", db: prismaMock(), now: NOW })

    expect(result).toEqual({ ok: true, inviteId: "inv-1" })
    const call = mocks.updateMany.mock.calls[0][0]
    expect(call.where).toMatchObject({ status: "pending" }) // guard is what makes it single-use
    expect(call.data).toMatchObject({ status: "redeemed", redeemedByUserId: "u1" })
  })
  it("the LOSER of a concurrent redemption gets INVITE_REDEEMED (count 0)", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite())
    mocks.updateMany.mockResolvedValue({ count: 0 })
    expect(await consumeAdmission({ rawToken: RAW, email: "alice@example.com", userId: "u2", db: prismaMock() })).toEqual({
      ok: false,
      code: "INVITE_REDEEMED",
    })
  })
  it("does not consume an invite for the wrong email", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite())
    expect(await consumeAdmission({ rawToken: RAW, email: "wrong@example.com", userId: "u3", db: prismaMock() })).toMatchObject({
      code: "INVITE_EMAIL_MISMATCH",
    })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it("REFUSES to consume token-only (email=null) and never touches the row", async () => {
    mocks.findUnique.mockResolvedValue(pendingInvite())
    expect(await consumeAdmission({ rawToken: RAW, email: null, userId: "u4", db: prismaMock() })).toMatchObject({
      code: "INVITE_EMAIL_MISMATCH",
    })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})

describe("admin operations", () => {
  it("issueInvite stores only the digest and returns the raw token exactly once", async () => {
    mocks.create.mockResolvedValue({ id: "inv-9", invitedEmail: "bob@example.com", expiresAt: null })
    const issued = await issueInvite({ email: "BOB@example.com", adminId: "admin@af" })

    const created = mocks.create.mock.calls[0][0].data
    expect(created.tokenDigest).toBe(hashToken(issued.rawToken)) // digest stored
    expect(created).not.toHaveProperty("rawToken")
    expect(JSON.stringify(created)).not.toContain(issued.rawToken) // raw never persisted
    expect(created.invitedEmail).toBe("bob@example.com") // normalized
    expect(issued.rawToken.length).toBeGreaterThan(20)
  })
  it("refuses to issue an invite with no (or malformed) email — email is required", async () => {
    await expect(issueInvite({ email: "", adminId: "admin@af" })).rejects.toThrow("BETA_INVITE_EMAIL_REQUIRED")
    await expect(issueInvite({ email: "not-an-email", adminId: "admin@af" })).rejects.toThrow("BETA_INVITE_EMAIL_REQUIRED")
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("revokeInvite revokes a pending invite, refuses a redeemed one", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 })
    expect(await revokeInvite({ id: "inv-1", adminId: "admin@af" })).toEqual({ ok: true })

    mocks.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.findUnique.mockResolvedValueOnce({ status: "redeemed" })
    expect(await revokeInvite({ id: "inv-1", adminId: "admin@af" })).toEqual({ ok: false, reason: "already_redeemed" })
  })
  it("listInvites never returns a token digest as a usable secret", async () => {
    mocks.findMany.mockResolvedValue([{ id: "inv-1", invitedEmail: "a@b.com", status: "pending" }])
    const rows = await listInvites()
    const selected = mocks.findMany.mock.calls[0][0].select
    expect(selected.tokenDigest).toBeUndefined()
    expect(JSON.stringify(rows)).not.toContain("tokenDigest")
  })
})

describe("admissionErrorMessage — honest, non-enumerating", () => {
  it("has copy for every code and never says whether an arbitrary email is invited", () => {
    for (const code of [
      "INVITE_REQUIRED",
      "INVITE_MALFORMED",
      "INVITE_NOT_FOUND",
      "INVITE_EXPIRED",
      "INVITE_REVOKED",
      "INVITE_REDEEMED",
      "INVITE_EMAIL_MISMATCH",
      "GATE_UNAVAILABLE",
    ] as const) {
      expect(admissionErrorMessage(code)).toBeTruthy()
    }
  })
})

/** A stand-in for a Prisma tx client — same shape the service touches. */
function prismaMock() {
  return { betaInvite: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } as never
}
