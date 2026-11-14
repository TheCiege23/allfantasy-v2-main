// @vitest-environment node
/**
 * One per-account password guess budget (lib/auth/passwordGuessBudget), spent by sign-in AND by
 * the two settings routes that re-check the current password. Before it, those routes compared
 * with no shared limit, so a stolen session could grind the current password indefinitely.
 *
 * Uses the REAL limiter with Upstash unset, so the in-process floor is what counts here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(async () => "new-hash"),
  session: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(async () => ({})),
}))

vi.mock("@/lib/auth/AuthIdentityResolver", () => ({ resolveUnifiedAuthIdentity: h.resolveIdentity }))
vi.mock("bcryptjs", () => ({
  default: { compare: h.compare, hash: h.hash },
  compare: h.compare,
  hash: h.hash,
}))
vi.mock("@/lib/moderation/accountSuspension", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/moderation/accountSuspension")>()),
  activeAccountRestriction: vi.fn(async () => null),
}))
vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: h.session,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { appUser: { findUnique: h.findUnique, update: h.update } },
}))

const savedEnv = {
  secret: process.env.NEXTAUTH_SECRET,
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
}
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})
afterAll(() => {
  for (const [k, v] of [
    ["NEXTAUTH_SECRET", savedEnv.secret],
    ["UPSTASH_REDIS_REST_URL", savedEnv.url],
    ["UPSTASH_REDIS_REST_TOKEN", savedEnv.token],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const USER = { id: "u-lock", email: "lock@example.com", username: "lock", displayName: null, avatarUrl: null, passwordHash: "hash" }

async function signIn(password: string) {
  const { authOptions } = await import("@/lib/auth")
  const p = authOptions.providers.find(
    (x) => ((x as { options?: { id?: string } }).options?.id ?? (x as { id?: string }).id) === "credentials",
  ) as { options: { authorize: (c: Record<string, string>) => Promise<unknown> } }
  return p.options.authorize({ login: "lock", password })
}

async function changePassword(currentPassword: string) {
  const { POST } = await import("@/app/api/user/password/change/route")
  return POST(
    new Request("http://localhost/api/user/password/change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword: "NewPassw0rd" }),
    }),
  )
}

/** Wrong when the password is "wrong", right otherwise. */
const passwordIsRight = (typed: string) => typed !== "wrong"

beforeEach(async () => {
  vi.clearAllMocks()
  const { __resetSharedRateLimitForTests } = await import("@/lib/security/sharedRateLimit")
  __resetSharedRateLimitForTests()
  h.resolveIdentity.mockResolvedValue(USER)
  h.compare.mockImplementation(async (typed: string) => passwordIsRight(typed))
  h.session.mockResolvedValue({ user: { id: USER.id } })
  h.findUnique.mockResolvedValue({ passwordHash: "hash" })
})

describe("sign-in lockout", () => {
  it("refuses even the correct password after 10 wrong ones, without comparing it", async () => {
    for (let i = 0; i < 10; i++) expect(await signIn("wrong")).toBeNull()
    expect(h.compare).toHaveBeenCalledTimes(10)

    expect(await signIn("right")).toBeNull()
    expect(h.compare).toHaveBeenCalledTimes(10)
  })

  it("lets the 10th attempt through when it is correct (control)", async () => {
    for (let i = 0; i < 9; i++) await signIn("wrong")
    expect(await signIn("right")).toMatchObject({ id: USER.id })
  })
})

describe("change-password lockout", () => {
  it("answers 429 after 10 wrong current passwords and never compares the 11th", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await changePassword("wrong")
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe("WRONG_PASSWORD")
    }
    const locked = await changePassword("right")
    expect(locked.status).toBe(429)
    expect((await locked.json()).error).toBe("TOO_MANY_ATTEMPTS")
    expect(h.compare).toHaveBeenCalledTimes(10)
    expect(h.update).not.toHaveBeenCalled()
  })

  it("a correct password clears the count, so a user's own typos do not add up", async () => {
    for (let i = 0; i < 9; i++) await changePassword("wrong")
    expect((await changePassword("right")).status).toBe(200)
    for (let i = 0; i < 10; i++) expect((await changePassword("wrong")).status).toBe(400)
  })
})

describe("one budget across sign-in and settings", () => {
  it("wrong guesses on change-password lock sign-in too, and the reverse", async () => {
    for (let i = 0; i < 6; i++) await signIn("wrong")
    for (let i = 0; i < 4; i++) await changePassword("wrong")

    expect((await changePassword("right")).status).toBe(429)
    expect(await signIn("right")).toBeNull()
  })

  it("does not lock a different account (control)", async () => {
    for (let i = 0; i < 10; i++) await changePassword("wrong")
    h.session.mockResolvedValue({ user: { id: "u-other" } })
    expect((await changePassword("right")).status).toBe(200)
  })
})
