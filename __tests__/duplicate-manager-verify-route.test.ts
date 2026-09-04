import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDuplicateManagerVerifyPreflight: vi.fn(),
  runDuplicateManagerVerification: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock("@/lib/admin-dashboard/DuplicateManagerVerificationService", () => ({
  getDuplicateManagerVerifyPreflight: mocks.getDuplicateManagerVerifyPreflight,
  runDuplicateManagerVerification: mocks.runDuplicateManagerVerification,
  TEST_LEAGUE_NAME: "ZZ TEST — Duplicate Manager Verification",
}))

const ORIGINAL_ENV = { ...process.env }

function postReq(body: unknown): never {
  return new Request("http://localhost/api/admin/duplicate-manager-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never
}

describe("/api/admin/duplicate-manager-verify", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { email: "founder@allfantasy.ai" } })
    process.env.NODE_ENV = "test"
    delete process.env.VERCEL_ENV
    delete process.env.ALLOW_DUPLICATE_MANAGER_VERIFY_EXECUTE
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  describe("GET", () => {
    it("blocks non-admin users", async () => {
      mocks.requireAdmin.mockResolvedValueOnce({ ok: false, res: new Response("Forbidden", { status: 403 }) })
      const { GET } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await GET()

      expect(response.status).toBe(403)
      expect(mocks.getDuplicateManagerVerifyPreflight).not.toHaveBeenCalled()
    })

    it("returns the dry-run preflight for an admin", async () => {
      mocks.getDuplicateManagerVerifyPreflight.mockResolvedValueOnce({ plan: [], existingTestLeague: null })
      const { GET } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await GET()
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json.mode).toBe("dry-run")
      expect(mocks.runDuplicateManagerVerification).not.toHaveBeenCalled()
    })
  })

  describe("POST", () => {
    it("blocks non-admin users before touching the confirm name or the flag", async () => {
      mocks.requireAdmin.mockResolvedValueOnce({ ok: false, res: new Response("Forbidden", { status: 403 }) })
      const { POST } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await POST(postReq({}))

      expect(response.status).toBe(403)
      expect(mocks.runDuplicateManagerVerification).not.toHaveBeenCalled()
    })

    it("rejects a wrong confirmLeagueName outside production", async () => {
      const { POST } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await POST(postReq({ confirmLeagueName: "not the right name" }))
      const json = await response.json()

      expect(response.status).toBe(400)
      expect(json.error).toMatch(/confirmLeagueName/)
      expect(mocks.runDuplicateManagerVerification).not.toHaveBeenCalled()
    })

    it("runs without the opt-in flag when NODE_ENV is not production", async () => {
      process.env.NODE_ENV = "test"
      mocks.runDuplicateManagerVerification.mockResolvedValueOnce({ ok: true })
      const { POST } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await POST(postReq({ confirmLeagueName: "ZZ TEST — Duplicate Manager Verification" }))

      expect(response.status).toBe(200)
      expect(mocks.runDuplicateManagerVerification).toHaveBeenCalledTimes(1)
    })

    it("THE ACTUAL BUG: blocks execute mode in production on Railway, where VERCEL_ENV is never set", async () => {
      // The exact shape of real Railway production: NODE_ENV=production, no VERCEL_ENV at all.
      // The old check (`NODE_ENV === "production" && VERCEL_ENV === "production"`) was false
      // here, so this gate never fired against real production traffic.
      process.env.NODE_ENV = "production"
      expect(process.env.VERCEL_ENV).toBeUndefined()
      const { POST } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await POST(postReq({ confirmLeagueName: "ZZ TEST — Duplicate Manager Verification" }))
      const json = await response.json()

      expect(response.status).toBe(403)
      expect(json.error).toMatch(/disabled in production/i)
      expect(mocks.runDuplicateManagerVerification).not.toHaveBeenCalled()
    })

    it("allows execute mode in production once the opt-in flag is set", async () => {
      process.env.NODE_ENV = "production"
      process.env.ALLOW_DUPLICATE_MANAGER_VERIFY_EXECUTE = "true"
      mocks.runDuplicateManagerVerification.mockResolvedValueOnce({ ok: true })
      const { POST } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await POST(postReq({ confirmLeagueName: "ZZ TEST — Duplicate Manager Verification" }))

      expect(response.status).toBe(200)
      expect(mocks.runDuplicateManagerVerification).toHaveBeenCalledTimes(1)
    })

    it("still blocks in production when VERCEL_ENV happens to be set to something other than production", async () => {
      // Guards against a narrower, wrong fix: gating on VERCEL_ENV !== "production" instead of
      // dropping it would leave a hole if VERCEL_ENV is ever set to some other stray value.
      process.env.NODE_ENV = "production"
      process.env.VERCEL_ENV = "development"
      const { POST } = await import("@/app/api/admin/duplicate-manager-verify/route")

      const response = await POST(postReq({ confirmLeagueName: "ZZ TEST — Duplicate Manager Verification" }))

      expect(response.status).toBe(403)
      expect(mocks.runDuplicateManagerVerification).not.toHaveBeenCalled()
    })
  })
})
