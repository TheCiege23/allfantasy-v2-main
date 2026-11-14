import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ADMIN_PASSWORD is not a machine admin key in production.
 *
 * It was the shared human admin login password. The login is retired in production and admin
 * sign-in needs an authenticator code — but the same value also opened every admin route as
 * `Authorization: Bearer <password>` / `x-admin-secret`, which skipped the code entirely. These
 * pin all three shared gates (requireAdminOrBearer/isAuthorizedRequest, requireCronAuth, and the
 * geo gate's hasMachineCredential mirror), and that dev/test keep accepting it.
 */

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock("next-auth", () => ({ getServerSession: async () => null }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { isAuthorizedRequest } from "@/lib/adminAuth"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { adminPasswordAsMachineKey, hasMachineCredential } from "@/lib/http/machineCredential"

const PASSWORD = "test-admin-password-not-real-7731"
const BRACKET = "test-bracket-admin-secret-not-real-5512"
const CRON = "test-cron-secret-not-real-9034"

function req(headers: Record<string, string>) {
  return new Request("https://example.test/api/admin/x", { headers })
}

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD", PASSWORD)
  vi.stubEnv("BRACKET_ADMIN_SECRET", BRACKET)
  vi.stubEnv("CRON_SECRET", CRON)
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-admin-session-secret-not-real")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("in production, ADMIN_PASSWORD opens nothing", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production")
  })

  it("is not offered as a machine key at all", () => {
    expect(adminPasswordAsMachineKey()).toBeUndefined()
  })

  it("is refused as a Bearer token and as x-admin-secret / x-cron-secret by the admin gate", () => {
    expect(isAuthorizedRequest(req({ authorization: `Bearer ${PASSWORD}` }))).toBe(false)
    expect(isAuthorizedRequest(req({ "x-admin-secret": PASSWORD }))).toBe(false)
    expect(isAuthorizedRequest(req({ "x-cron-secret": PASSWORD }))).toBe(false)
  })

  it("stays refused when BRACKET_ADMIN_SECRET is unset (the old `||` fallback)", () => {
    vi.stubEnv("BRACKET_ADMIN_SECRET", "")
    expect(isAuthorizedRequest(req({ "x-admin-secret": PASSWORD }))).toBe(false)
    expect(requireCronAuth(req({ "x-admin-secret": PASSWORD }) as never)).toBe(false)
  })

  it("is refused by requireCronAuth", () => {
    expect(requireCronAuth(req({ authorization: `Bearer ${PASSWORD}` }) as never)).toBe(false)
  })

  it("does not exempt a request from the geo gate", () => {
    expect(hasMachineCredential(req({ authorization: `Bearer ${PASSWORD}` }).headers)).toBe(false)
  })

  it("leaves the real machine keys working", () => {
    expect(isAuthorizedRequest(req({ "x-admin-secret": BRACKET }))).toBe(true)
    expect(isAuthorizedRequest(req({ authorization: `Bearer ${BRACKET}` }))).toBe(true)
    expect(requireCronAuth(req({ authorization: `Bearer ${CRON}` }) as never)).toBe(true)
    expect(requireCronAuth(req({ "x-admin-secret": BRACKET }) as never)).toBe(true)
    expect(hasMachineCredential(req({ authorization: `Bearer ${CRON}` }).headers)).toBe(true)
  })

  it("rejects a wrong key", () => {
    expect(isAuthorizedRequest(req({ authorization: "Bearer nope" }))).toBe(false)
    expect(isAuthorizedRequest(req({ authorization: "Bearer " }))).toBe(false)
  })
})

describe("outside production, ADMIN_PASSWORD keeps working (dev, tests, CI e2e)", () => {
  it("is accepted by all three gates", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(adminPasswordAsMachineKey()).toBe(PASSWORD)
    expect(isAuthorizedRequest(req({ authorization: `Bearer ${PASSWORD}` }))).toBe(true)
    expect(hasMachineCredential(req({ authorization: `Bearer ${PASSWORD}` }).headers)).toBe(true)
    vi.stubEnv("BRACKET_ADMIN_SECRET", "")
    expect(requireCronAuth(req({ "x-admin-secret": PASSWORD }) as never)).toBe(true)
  })
})
