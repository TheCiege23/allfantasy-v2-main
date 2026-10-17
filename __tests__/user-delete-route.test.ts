import { beforeEach, describe, it, expect, vi } from "vitest"

// B1 — account erasure route: authorized + confirmed erasure revokes auth and
// scrubs PII; unauthorized → 401; unconfirmed → 400.

const {
  getServerSessionMock,
  authAccountDeleteMany,
  emailVerifyDeleteMany,
  passwordResetDeleteMany,
  appUserUpdate,
  profileUpdateMany,
  identityDeleteMany,
  teamUpdateMany,
  pushDeleteMany,
  comparisonDeleteMany,
  leagueAuthDeleteMany,
  yahooDeleteMany,
  sessionDeleteMany,
  mflDeleteMany,
  cancelSubsMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  authAccountDeleteMany: vi.fn(),
  emailVerifyDeleteMany: vi.fn(),
  passwordResetDeleteMany: vi.fn(),
  appUserUpdate: vi.fn(),
  profileUpdateMany: vi.fn(),
  identityDeleteMany: vi.fn(),
  teamUpdateMany: vi.fn(),
  pushDeleteMany: vi.fn(),
  comparisonDeleteMany: vi.fn(),
  leagueAuthDeleteMany: vi.fn(),
  yahooDeleteMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  mflDeleteMany: vi.fn(),
  cancelSubsMock: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/account/cancelSubscriptionsOnDelete", () => ({ cancelSubscriptionsOnDelete: cancelSubsMock }))
vi.mock("@/lib/stripe-client", () => ({ getStripeClient: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        authAccount: { deleteMany: authAccountDeleteMany },
        emailVerifyToken: { deleteMany: emailVerifyDeleteMany },
        passwordResetToken: { deleteMany: passwordResetDeleteMany },
        appUser: { update: appUserUpdate },
        userProfile: { updateMany: profileUpdateMany },
        platformIdentity: { deleteMany: identityDeleteMany },
        leagueTeam: { updateMany: teamUpdateMany },
        webPushSubscription: { deleteMany: pushDeleteMany },
        genericTradeComparison: { deleteMany: comparisonDeleteMany },
        leagueAuth: { deleteMany: leagueAuthDeleteMany },
        yahooConnection: { deleteMany: yahooDeleteMany },
        authSession: { deleteMany: sessionDeleteMany },
        mFLConnection: { deleteMany: mflDeleteMany },
      }),
  },
}))

import { POST } from "@/app/api/user/delete/route"

function req(body?: unknown, cookie?: string) {
  return new Request("http://localhost/api/user/delete", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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
    profileUpdateMany.mockResolvedValue({ count: 1 })
    identityDeleteMany.mockResolvedValue({ count: 2 })
    teamUpdateMany.mockResolvedValue({ count: 3 })
    pushDeleteMany.mockResolvedValue({ count: 2 })
    comparisonDeleteMany.mockResolvedValue({ count: 1 })
    leagueAuthDeleteMany.mockResolvedValue({ count: 3 })
    yahooDeleteMany.mockResolvedValue({ count: 1 })
    sessionDeleteMany.mockResolvedValue({ count: 0 })
    mflDeleteMany.mockResolvedValue({ count: 1 })
    cancelSubsMock.mockResolvedValue({ cancelled: [], hasAppleSubscription: false })
  })

  /*
   * Owner's call, 2026-10-02: deleting an account cancels its subscription. Before, the route never
   * called Stripe and a subscriber kept being charged for an account that no longer existed.
   */
  it("cancels billing BEFORE erasing anything", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    cancelSubsMock.mockResolvedValue({ cancelled: ["sub_1"], hasAppleSubscription: false })
    const res = await POST(req({ confirm: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, cancelledSubscriptions: 1, appleSubscriptionActive: false })
    expect(cancelSubsMock.mock.calls[0][0]).toBe("u1")
    expect(cancelSubsMock.mock.invocationCallOrder[0]).toBeLessThan(appUserUpdate.mock.invocationCallOrder[0])
  })

  it("erases NOTHING when the subscription could not be cancelled", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    cancelSubsMock.mockRejectedValue(new Error("stripe down"))
    const res = await POST(req({ confirm: true }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: "subscription_cancel_failed" })
    expect(appUserUpdate).not.toHaveBeenCalled()
    expect(authAccountDeleteMany).not.toHaveBeenCalled()
  })

  it("does not cancel anything for an unconfirmed request", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    expect((await POST(req({}))).status).toBe(400)
    expect(cancelSubsMock).not.toHaveBeenCalled()
  })

  /*
   * 🛑 Found by deleting the App Review demo account (2026-09-28): the new review
   * account could not re-import the same Sleeper leagues, because the deleted
   * account still OWNED the unique Sleeper link — and still held live Discord and
   * Spotify tokens and the phone number.
   */
  it("releases the Sleeper link, phone, Discord/Spotify tokens, platform identities, claimed teams and Legacy", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    expect((await POST(req({ confirm: true }))).status).toBe(200)

    const profile = profileUpdateMany.mock.calls[0][0]
    expect(profile.where).toEqual({ userId: "u1" })
    for (const field of [
      "sleeperUserId", "sleeperUsername", "phone", "discordUserId", "discordEmail",
      "discordAccessToken", "discordRefreshToken", "spotifyAccessToken", "spotifyRefreshToken",
    ]) {
      expect(profile.data[field], field).toBeNull()
    }
    expect(identityDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(teamUpdateMany).toHaveBeenCalledWith({ where: { claimedByUserId: "u1" }, data: { claimedByUserId: null } })
    // Browser push AND the iOS app's device tokens: a deleted account stops notifying its phone.
    expect(pushDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    // The anonymising update stays first; the Legacy release follows it.
    expect(appUserUpdate.mock.calls[0][0].data.passwordHash).toBeNull()
    expect(appUserUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { legacyUserId: null } })
  })

  /*
   * The 2026-10 Privacy Policy (§8.4) promises Connected Platform tokens are deleted. They
   * outlived every deletion before this: the FK cascades only fire on a hard delete.
   */
  it("deletes stored platform credentials: league_auths, the Yahoo connection and sessions", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    expect((await POST(req({ confirm: true }))).status).toBe(200)
    expect(leagueAuthDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(yahooDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
    // No legacy MFL cookie on this browser: nothing to find the MFL row by, so nothing is touched.
    expect(mflDeleteMany).not.toHaveBeenCalled()
  })

  it("deletes the legacy MFL session this browser holds, and expires its cookie", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    const res = await POST(req({ confirm: true }, "theme=dark; mfl_session=sess-123; other=1"))
    expect(res.status).toBe(200)
    expect(mflDeleteMany).toHaveBeenCalledWith({ where: { sessionId: "sess-123" } })
    expect(res.headers.get("set-cookie")).toMatch(/mfl_session=;.*Max-Age=0/i)
  })

  it("does not delete credentials when the subscription could not be cancelled", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    cancelSubsMock.mockRejectedValue(new Error("stripe down"))
    expect((await POST(req({ confirm: true }))).status).toBe(502)
    expect(leagueAuthDeleteMany).not.toHaveBeenCalled()
    expect(yahooDeleteMany).not.toHaveBeenCalled()
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
    expect(comparisonDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } })
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
