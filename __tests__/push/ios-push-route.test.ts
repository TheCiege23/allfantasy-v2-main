// @vitest-environment node
/** /api/push/ios — the iOS app's device-token registration. */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  jwt: vi.fn(),
  save: vi.fn(async () => true),
  remove: vi.fn(async () => true),
}))
vi.mock("next-auth", () => ({ getServerSession: mocks.session }))
vi.mock("next-auth/jwt", () => ({ getToken: mocks.jwt }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/resolve-auth-secret", () => ({ resolveAuthSecret: () => "secret" }))
vi.mock("@/lib/push-notifications", () => ({ saveIosDevice: mocks.save, removeIosDevice: mocks.remove }))

import { DELETE, GET, POST } from "@/app/api/push/ios/route"

const TOKEN = "c".repeat(64)
const req = (method: string, body: unknown) =>
  new NextRequest("https://www.allfantasy.ai/api/push/ios", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: "u1" } })
  mocks.jwt.mockResolvedValue({ id: "u1", sid: "sid-9" })
})

describe("/api/push/ios", () => {
  it("registers the phone for the signed-in user with THIS login's sid", async () => {
    const res = await POST(req("POST", { token: TOKEN }))
    expect(res.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith("u1", TOKEN, "sid-9")
  })

  it("refuses a signed-out request and never stores anything", async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(req("POST", { token: TOKEN }))).status).toBe(401)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("rejects something that is not a device token", async () => {
    expect((await POST(req("POST", { token: "<script>" }))).status).toBe(400)
    expect((await POST(req("POST", {}))).status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("unregisters the phone", async () => {
    expect((await DELETE(req("DELETE", { token: TOKEN }))).status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith("u1", TOKEN)
  })

  it("says whether Apple push is configured, so the app only asks when it can deliver", async () => {
    const saved = process.env.APNS_KEY_ID
    delete process.env.APNS_KEY_ID
    expect(await (await GET()).json()).toEqual({ configured: false })
    if (saved !== undefined) process.env.APNS_KEY_ID = saved
  })
})
