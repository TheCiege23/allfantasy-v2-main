import { describe, expect, it, vi, afterEach } from "vitest"

import { consumeRateLimit } from "@/lib/rate-limit"

/**
 * `consumeRateLimit` keys buckets as `scope:action:user:<u>[:ip:<ip>]`.
 *
 * The failure mode these tests lock down: a caller that passes an `ip` but
 * neither a `sleeperUsername` nor `includeIpInKey: true` used to key on
 * `scope:action:user:anonymous` — ONE bucket shared by every visitor on the
 * platform. It reads like a per-IP limit at the call site, so it survived
 * review on 14 routes (`app/api/import-sleeper` among them, at 5 imports/min
 * platform-wide).
 *
 * The module keeps its bucket Map at module scope, so every test below uses a
 * distinct `action` to stay isolated from its neighbours.
 */

// Each test uses its own action name; no shared state to reset between them.
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const WINDOW = 60_000

describe("consumeRateLimit key composition", () => {
  it("keys per-user when a sleeperUsername is supplied and IP is not requested", () => {
    const rl = consumeRateLimit({
      scope: "test",
      action: "per_user",
      sleeperUsername: "User_A",
      maxRequests: 5,
      windowMs: WINDOW,
    })

    expect(rl.key).toBe("test:per_user:user:user_a")
    expect(rl.key).not.toContain(":ip:")
  })

  it("keys per-user AND per-IP when includeIpInKey is true", () => {
    const rl = consumeRateLimit({
      scope: "test",
      action: "per_user_ip",
      sleeperUsername: "User_A",
      ip: "203.0.113.7",
      maxRequests: 5,
      windowMs: WINDOW,
      includeIpInKey: true,
    })

    expect(rl.key).toBe("test:per_user_ip:user:user_a:ip:203.0.113.7")
  })

  it("keeps a per-user key when includeIpInKey is explicitly false", () => {
    const rl = consumeRateLimit({
      scope: "test",
      action: "explicit_false",
      sleeperUsername: "User_A",
      ip: "203.0.113.7",
      maxRequests: 5,
      windowMs: WINDOW,
      includeIpInKey: false,
    })

    // The guard must not over-fire: a real user key was supplied, so honouring
    // the explicit opt-out is correct here.
    expect(rl.key).toBe("test:explicit_false:user:user_a")
  })

  describe("degenerate-bucket guard", () => {
    it("falls back to bucketing by IP when an ip is passed with no user key", () => {
      const rl = consumeRateLimit({
        scope: "test",
        action: "guarded",
        ip: "203.0.113.7",
        maxRequests: 5,
        windowMs: WINDOW,
      })

      expect(rl.key).toBe("test:guarded:user:anonymous:ip:203.0.113.7")
      // The pre-fix key — one global bucket — must no longer be produced.
      expect(rl.key).not.toBe("test:guarded:user:anonymous")
    })

    it("gives two different IPs independent budgets (the actual platform-wide bug)", () => {
      const call = (ip: string) =>
        consumeRateLimit({
          scope: "test",
          action: "independent_budgets",
          ip,
          maxRequests: 2,
          windowMs: WINDOW,
        })

      // Exhaust the limit from one IP.
      expect(call("198.51.100.1").success).toBe(true)
      expect(call("198.51.100.1").success).toBe(true)
      expect(call("198.51.100.1").success).toBe(false)

      // A different visitor must be unaffected. Pre-fix both shared
      // `test:independent_budgets:user:anonymous`, so this was `false`.
      const other = call("198.51.100.2")
      expect(other.success).toBe(true)
      expect(other.key).toBe("test:independent_budgets:user:anonymous:ip:198.51.100.2")
    })

    it("treats a blank sleeperUsername as no user key", () => {
      const rl = consumeRateLimit({
        scope: "test",
        action: "blank_user",
        sleeperUsername: "   ",
        ip: "203.0.113.7",
        maxRequests: 5,
        windowMs: WINDOW,
      })

      // `   ` normalises to '' — also a shared bucket, so the guard applies.
      expect(rl.key).toContain(":ip:203.0.113.7")
    })

    it("leaves a deliberate global bucket alone when no ip is passed", () => {
      const rl = consumeRateLimit({
        scope: "test",
        action: "intentional_global",
        maxRequests: 5,
        windowMs: WINDOW,
      })

      // No ip supplied => the caller wants a single shared ceiling. Untouched.
      expect(rl.key).toBe("test:intentional_global:user:anonymous")
    })

    it("warns outside production so the mistake is visible in dev", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      vi.stubEnv("NODE_ENV", "development")

      consumeRateLimit({
        scope: "test",
        action: "warns_in_dev",
        ip: "203.0.113.7",
        maxRequests: 5,
        windowMs: WINDOW,
      })

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain("test:warns_in_dev")
    })

    it("stays quiet in production", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      vi.stubEnv("NODE_ENV", "production")

      consumeRateLimit({
        scope: "test",
        action: "quiet_in_prod",
        ip: "203.0.113.7",
        maxRequests: 5,
        windowMs: WINDOW,
      })

      expect(warn).not.toHaveBeenCalled()
    })
  })
})
