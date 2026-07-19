import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminApiToken: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
      findMany: mocks.findMany,
    },
  },
}))

import {
  ADMIN_API_TOKEN_PREFIX,
  generateAdminApiToken,
  hashAdminApiToken,
  issueAdminApiToken,
  resolveAdminApiToken,
  revokeAdminApiToken,
} from "@/lib/admin/adminApiTokens"

const ALWAYS_ADMIN = () => true
const NEVER_ADMIN = () => false

const activeRow = {
  id: "tok_1",
  label: "deploy bot",
  ownerEmail: "admin@example.com",
  ownerUserId: "user_1",
  revokedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.update.mockResolvedValue({})
})

describe("admin API token hashing", () => {
  it("hashes to sha256 hex and is deterministic", () => {
    const hash = hashAdminApiToken("afadm_example")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashAdminApiToken("afadm_example")).toBe(hash)
    expect(hashAdminApiToken("afadm_example2")).not.toBe(hash)
  })

  it("generates prefixed, non-repeating tokens", () => {
    const a = generateAdminApiToken()
    const b = generateAdminApiToken()
    expect(a.startsWith(ADMIN_API_TOKEN_PREFIX)).toBe(true)
    expect(a).not.toBe(b)
    // 32 random bytes in base64url — comfortably beyond brute force.
    expect(a.length).toBeGreaterThan(ADMIN_API_TOKEN_PREFIX.length + 40)
  })
})

describe("resolveAdminApiToken", () => {
  it("resolves a valid token to its owner and records lastUsedAt", async () => {
    mocks.findUnique.mockResolvedValue(activeRow)

    const owner = await resolveAdminApiToken("afadm_raw", ALWAYS_ADMIN)

    expect(owner).toEqual({
      tokenId: "tok_1",
      label: "deploy bot",
      ownerEmail: "admin@example.com",
      ownerUserId: "user_1",
    })
    // Looked up by HASH, never by the raw value.
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashAdminApiToken("afadm_raw") } }),
    )
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok_1" } }),
    )
  })

  it("rejects an unknown token", async () => {
    mocks.findUnique.mockResolvedValue(null)
    expect(await resolveAdminApiToken("afadm_nope", ALWAYS_ADMIN)).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rejects a revoked token", async () => {
    mocks.findUnique.mockResolvedValue({ ...activeRow, revokedAt: new Date() })
    expect(await resolveAdminApiToken("afadm_raw", ALWAYS_ADMIN)).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rejects a token whose owner is no longer an admin", async () => {
    mocks.findUnique.mockResolvedValue(activeRow)

    // The whole point of deriving authority at call time: the row is untouched and
    // still 'valid', but the person behind it lost admin access.
    expect(await resolveAdminApiToken("afadm_raw", NEVER_ADMIN)).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rejects an empty token without hitting the database", async () => {
    expect(await resolveAdminApiToken("", ALWAYS_ADMIN)).toBeNull()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("still authenticates when recording lastUsedAt fails", async () => {
    mocks.findUnique.mockResolvedValue(activeRow)
    mocks.update.mockRejectedValue(new Error("db down"))
    const warn = vi.spyOn(console, "error").mockImplementation(() => {})

    // The caller presented a valid token; a bookkeeping write failing must not
    // turn a legitimate request into a 401.
    const owner = await resolveAdminApiToken("afadm_raw", ALWAYS_ADMIN)
    expect(owner?.ownerEmail).toBe("admin@example.com")
    expect(warn).toHaveBeenCalled()
  })
})

describe("issueAdminApiToken", () => {
  it("persists only the hash and returns the raw token once", async () => {
    mocks.create.mockImplementation(({ data }: any) => ({
      id: "tok_new",
      label: data.label,
      ownerEmail: data.ownerEmail,
      ownerUserId: data.ownerUserId,
      createdByEmail: data.createdByEmail,
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
      revokedByEmail: null,
    }))

    const { rawToken, token } = await issueAdminApiToken({
      label: "  deploy bot  ",
      ownerEmail: "  Admin@Example.com ",
      createdByEmail: "Boss@Example.com",
    })

    const written = mocks.create.mock.calls[0]![0].data

    // The crown-jewel assertion: the raw value must not be recoverable from storage.
    expect(written.tokenHash).toBe(hashAdminApiToken(rawToken))
    expect(JSON.stringify(written)).not.toContain(rawToken)
    expect(written).not.toHaveProperty("rawToken")

    // Inputs are normalised so lookups and allowlist checks agree on casing.
    expect(written.ownerEmail).toBe("admin@example.com")
    expect(written.createdByEmail).toBe("boss@example.com")
    expect(written.label).toBe("deploy bot")
    expect(token.id).toBe("tok_new")
  })
})

describe("revokeAdminApiToken", () => {
  const row = {
    ...activeRow,
    createdByEmail: null,
    createdAt: new Date(),
    lastUsedAt: null,
    revokedByEmail: null,
  }

  it("stamps revokedAt and keeps the row", async () => {
    mocks.findUnique.mockResolvedValue(row)
    mocks.update.mockImplementation(({ data }: any) => ({
      ...row,
      revokedAt: data.revokedAt,
      revokedByEmail: data.revokedByEmail,
    }))

    const result = await revokeAdminApiToken("tok_1", "Boss@Example.com")

    expect(result?.revokedAt).toBeInstanceOf(Date)
    expect(result?.revokedByEmail).toBe("boss@example.com")
  })

  it("returns null for an unknown token", async () => {
    mocks.findUnique.mockResolvedValue(null)
    expect(await revokeAdminApiToken("nope", null)).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("is idempotent on an already-revoked token", async () => {
    const revokedAt = new Date("2026-07-01T00:00:00Z")
    mocks.findUnique.mockResolvedValue({ ...row, revokedAt })

    const result = await revokeAdminApiToken("tok_1", "boss@example.com")

    // Re-revoking must not move the original timestamp.
    expect(result?.revokedAt).toBe(revokedAt)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
