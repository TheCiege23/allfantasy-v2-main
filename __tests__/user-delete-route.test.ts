import { beforeEach, describe, it, expect, vi } from "vitest"

// B1 — account erasure route: authorized + confirmed erasure revokes auth and
// scrubs PII; unauthorized → 401; unconfirmed → 400.

const {
  getServerSessionMock,
  authAccountDeleteMany,
  emailVerifyDeleteMany,
  passwordResetDeleteMany,
  appUserUpdate,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  authAccountDeleteMany: vi.fn(),
  emailVerifyDeleteMany: vi.fn(),
  passwordResetDeleteMany: vi.fn(),
  appUserUpdate: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        authAccount: { deleteMany: authAccountDeleteMany },
        emailVerifyToken: { deleteMany: emailVerifyDeleteMany },
        passwordResetToken: { deleteMany: passwordResetDeleteMany },
        appUser: { update: appUserUpdate },
      }),
  },
}))

import { POST } from "@/app/api/user/delete/route"

function req(body?: unknown) {
  return new Request("http://localhost/api/user/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("POST /api/user/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAccountDeleteMany.mockResolvedValue({ count: 1 })
    emailVerifyDeleteMany.mockResolvedValue({ count: 0 })
    passwordResetDeleteMany.mockResolvedValue({ count: 0 })
    appUserUpdate.mockResolvedValue({ id: "u1" })
  })

  it("401 when unauthenticated", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await POST(req({ confirm: true }))
    expect(res.status).toBe(401)
    expect(appUserUpdate).not.toHaveBeenCalled()
  })

  it("400 when not explicitly confirmed", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect(appUserUpdate).not.toHaveBeenCalled()
  })

  it("erases PII + revokes auth when confirmed", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    const res = await POST(req({ confirm: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: true })

    expect(authAccountDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    const update = appUserUpdate.mock.calls[0][0]
    expect(update.where).toEqual({ id: "u1" })
    expect(update.data.passwordHash).toBeNull()
    expect(update.data.email).toBe("deleted+u1@deleted.invalid")
    expect(update.data.username).toBe("deleted_u1")
    expect(update.data.displayName).toBeNull()
    expect(update.data.avatarUrl).toBeNull()
    expect(update.data.emailVerified).toBeNull()
  })
})
