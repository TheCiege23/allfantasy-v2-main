// @vitest-environment node
/**
 * The change-email route re-checks the current password. Its own limit is in-process and keyed
 * on user + IP, so rotating IPs or replicas walked past it. It now also spends the shared
 * per-account budget (lib/auth/passwordGuessBudget). Real limiter, Upstash unset.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  session: vi.fn(),
  compare: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(async () => null),
  ip: { value: "10.0.0.1" },
}))

vi.mock("next-auth", () => ({ getServerSession: h.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/rate-limit", () => ({
  // The route's own per-IP limit always passes here: this suite is about the per-ACCOUNT one.
  rateLimit: vi.fn(() => ({ success: true })),
  getClientIp: vi.fn(() => h.ip.value),
}))
vi.mock("bcryptjs", () => ({ default: { compare: h.compare } }))
vi.mock("@/lib/prisma", () => ({
  prisma: { appUser: { findUnique: h.findUnique, findFirst: h.findFirst } },
}))

const saved = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }
beforeAll(() => {
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})
afterAll(() => {
  if (saved.url !== undefined) process.env.UPSTASH_REDIS_REST_URL = saved.url
  if (saved.token !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = saved.token
})

async function changeEmail(currentPassword: string) {
  const { POST } = await import("@/app/api/user/contact/email/route")
  return POST(
    new Request("http://localhost/api/user/contact/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", currentPassword }),
    }) as never,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  const { __resetSharedRateLimitForTests } = await import("@/lib/security/sharedRateLimit")
  __resetSharedRateLimitForTests()
  h.session.mockResolvedValue({ user: { id: "u1" } })
  h.findUnique.mockResolvedValue({ id: "u1", email: "old@example.com", passwordHash: "hash" })
  h.compare.mockResolvedValue(false)
})

describe("change-email current-password lockout", () => {
  it("answers 429 after 10 wrong passwords, from rotating IPs, without comparing the 11th", async () => {
    for (let i = 0; i < 10; i++) {
      h.ip.value = `10.0.0.${i + 1}`
      const res = await changeEmail("wrong")
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe("WRONG_PASSWORD")
    }
    h.ip.value = "10.0.0.99"
    const locked = await changeEmail("whatever")
    expect(locked.status).toBe(429)
    expect((await locked.json()).error).toBe("TOO_MANY_ATTEMPTS")
    expect(h.compare).toHaveBeenCalledTimes(10)
  })

  it("still compares the 10th attempt (control)", async () => {
    for (let i = 0; i < 10; i++) await changeEmail("wrong")
    expect(h.compare).toHaveBeenCalledTimes(10)
  })
})
