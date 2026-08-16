/**
 * Age consent must survive OAuth signup.
 *
 * The signup form's single checkbox drives 18+/disclaimer/terms, and the credentials path
 * POSTs them to /api/auth/register, which writes `ageConfirmedAt`. The OAuth buttons sit
 * on the SAME form below the SAME checkbox, but received only `callbackUrl` — so ticking
 * the box and clicking "Continue with Google" discarded it, `ensureSharedAccountProfile`
 * left `ageConfirmedAt` null, and every later gate (hasConfirmedAge, bracket entry, the
 * settings legal panel) reported the user had never confirmed. Users who HAD ticked were
 * told they hadn't.
 *
 * Worse, nothing stopped an OAuth signup with the box UNCHECKED, so accounts could be
 * created with no consent recorded anywhere.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { userProfile: { upsert: mocks.upsert, updateMany: mocks.updateMany, update: mocks.update } },
}))

import { ensureSharedAccountProfile } from "@/lib/auth/SharedAccountBootstrapService"
import {
  SIGNUP_CONSENT_COOKIE,
  buildSignupConsentCookie,
  isConsentCookieValue,
} from "@/lib/auth/signupConsentCookie"

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsert.mockResolvedValue({})
  mocks.updateMany.mockResolvedValue({ count: 1 })
})

describe("the consent cookie", () => {
  it("survives the provider's top-level redirect back (SameSite=Lax, not Strict)", () => {
    const cookie = buildSignupConsentCookie(true)
    expect(cookie.toLowerCase()).toContain("samesite=lax")
    expect(cookie.toLowerCase()).not.toContain("samesite=strict")
  })

  it("is Secure over https and omits it otherwise (so local http still works)", () => {
    expect(buildSignupConsentCookie(true).toLowerCase()).toContain("secure")
    expect(buildSignupConsentCookie(false).toLowerCase()).not.toContain("secure")
  })

  it("is short-lived — a tick must not linger for a later unrelated sign-in", () => {
    const maxAge = Number(/max-age=(\d+)/.exec(buildSignupConsentCookie(true))?.[1])
    expect(maxAge).toBeGreaterThan(0)
    expect(maxAge).toBeLessThanOrEqual(900)
  })

  it("treats only the exact consent value as consent", () => {
    expect(isConsentCookieValue("1")).toBe(true)
    for (const v of ["0", "", "true", "yes", null, undefined]) {
      expect(isConsentCookieValue(v)).toBe(false)
    }
    expect(SIGNUP_CONSENT_COOKIE).toBeTruthy()
  })
})

describe("ensureSharedAccountProfile records the consent", () => {
  it("stamps ageConfirmedAt on a NEW profile when consent was given", async () => {
    await ensureSharedAccountProfile({ userId: "u1", displayName: "A", ageConfirmed: true })
    expect(mocks.upsert.mock.calls[0][0].create.ageConfirmedAt).toBeInstanceOf(Date)
  })

  it("does NOT stamp it when no consent was carried", async () => {
    // No tick means no record. Inventing one would fabricate a legal attestation.
    await ensureSharedAccountProfile({ userId: "u1", displayName: "A", ageConfirmed: false })
    expect(mocks.upsert.mock.calls[0][0].create.ageConfirmedAt).toBeUndefined()
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("only fills ageConfirmedAt when it is still null, never overwriting the original", async () => {
    // This runs on every authenticated request; re-stamping would move the recorded date
    // of consent forward each sign-in and lose when it was actually given.
    await ensureSharedAccountProfile({ userId: "u1", ageConfirmed: true })
    expect(mocks.updateMany).toHaveBeenCalledTimes(1)
    expect(mocks.updateMany.mock.calls[0][0].where).toMatchObject({
      userId: "u1",
      ageConfirmedAt: null,
    })
  })

  it("never retracts consent — the update payload cannot clear ageConfirmedAt", async () => {
    await ensureSharedAccountProfile({ userId: "u1", displayName: "A", ageConfirmed: false })
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty("ageConfirmedAt")
  })
})

describe("wiring", () => {
  const signup = read("app/signup/SignupContent.tsx")
  const grid = read("components/auth/NocturneOAuthGrid.tsx")
  const linking = read("lib/auth/SocialAccountLinkingService.ts")

  it("signup passes the checkbox state to the OAuth grid", () => {
    expect(signup).toMatch(/NocturneOAuthGrid[\s\S]{0,400}consent=\{/)
    expect(signup).toMatch(/granted: consentChecked/)
  })

  it("the grid blocks OAuth signup when the box is unchecked", () => {
    expect(grid).toMatch(/if \(consent && !consent\.granted\)/)
    expect(grid).toMatch(/consent\.onMissing\(\)/)
  })

  it("the grid writes the cookie BEFORE redirecting to the provider", () => {
    const cookieAt = grid.indexOf("buildSignupConsentCookie")
    const signInAt = grid.indexOf("await signIn(")
    expect(cookieAt).toBeGreaterThan(-1)
    expect(cookieAt).toBeLessThan(signInAt)
  })

  it("the OAuth link path reads the cookie and passes it to the bootstrap", () => {
    expect(linking).toContain("readSignupConsentCookie")
    expect(linking).toMatch(/ageConfirmed: await readSignupConsentCookie\(\)/)
  })

  it("login does NOT gate on consent — existing users are never re-asked", () => {
    // /login has no checkbox; adding a gate there would lock out established accounts.
    expect(read("app/login/LoginContent.tsx")).not.toMatch(/consent=\{/)
  })
})
