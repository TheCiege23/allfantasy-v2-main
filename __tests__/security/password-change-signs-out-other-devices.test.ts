// @vitest-environment node
/**
 * POST /api/user/password/change revokes every OTHER session of the account, sparing only the
 * session making the change — and only when its token provably belongs to the signed-in user.
 * The revocation store itself is covered in __tests__/auth/session-revocation.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  session: vi.fn(),
  getToken: vi.fn(),
  revokeAll: vi.fn(),
  compare: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(async () => ({})),
}))

vi.mock("next-auth", () => ({ getServerSession: h.session }))
vi.mock("next-auth/jwt", () => ({ getToken: h.getToken }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/sessionRevocation", () => ({ revokeAllSessionsForUser: h.revokeAll }))
vi.mock("@/lib/auth/passwordGuessBudget", () => ({
  spendPasswordGuess: vi.fn(async () => true),
  clearPasswordGuesses: vi.fn(async () => undefined),
}))
vi.mock("@/lib/auth/resolve-auth-secret", () => ({ resolveAuthSecret: () => "test-secret-not-real" }))
vi.mock("bcryptjs", () => ({ default: { compare: h.compare, hash: vi.fn(async () => "new-hash") } }))
vi.mock("@/lib/prisma", () => ({ prisma: { appUser: { findUnique: h.findUnique, update: h.update } } }))

async function change() {
  const { POST } = await import("@/app/api/user/password/change/route")
  return POST(
    new Request("http://localhost/api/user/password/change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "OldPassw0rd", newPassword: "NewPassw0rd" }),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: "u1" } })
  h.findUnique.mockResolvedValue({ passwordHash: "hash" })
  h.compare.mockResolvedValue(true)
  h.getToken.mockResolvedValue({ id: "u1", sid: "sid-this-device" })
  h.revokeAll.mockResolvedValue(true)
})

describe("password change signs out other devices", () => {
  it("revokes every session of the user except this device's, after the password is saved", async () => {
    const res = await change()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, otherSessionsSignedOut: true })
    expect(h.revokeAll).toHaveBeenCalledTimes(1)
    expect(h.revokeAll).toHaveBeenCalledWith("u1", undefined, { exceptSid: "sid-this-device" })
    expect(h.update.mock.invocationCallOrder[0]).toBeLessThan(h.revokeAll.mock.invocationCallOrder[0])
  })

  it("spares nobody when the token belongs to a different user", async () => {
    h.getToken.mockResolvedValue({ id: "someone-else", sid: "sid-other" })
    await change()
    expect(h.revokeAll).toHaveBeenCalledWith("u1", undefined, { exceptSid: null })
  })

  it("spares nobody when the token has no sid, or cannot be read", async () => {
    h.getToken.mockResolvedValue({ id: "u1" })
    await change()
    expect(h.revokeAll).toHaveBeenLastCalledWith("u1", undefined, { exceptSid: null })

    h.getToken.mockRejectedValue(new Error("bad cookie"))
    await change()
    expect(h.revokeAll).toHaveBeenLastCalledWith("u1", undefined, { exceptSid: null })
  })

  it("still succeeds, and says so honestly, when the revocation was not recorded", async () => {
    h.revokeAll.mockResolvedValue(false)
    const res = await change()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, otherSessionsSignedOut: false })
  })

  it("does not revoke anything on a wrong current password (control)", async () => {
    h.compare.mockResolvedValue(false)
    expect((await change()).status).toBe(400)
    expect(h.revokeAll).not.toHaveBeenCalled()
  })
})
