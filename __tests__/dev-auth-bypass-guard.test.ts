import { createRequire } from "module"

import { describe, expect, it, vi } from "vitest"

const requireCjs = createRequire(import.meta.url)
const { applyDevAuthBypassGuard } = requireCjs("../scripts/dev-auth-bypass-guard.cjs")

/*
 * The dev sign-in bypass was gated on NODE_ENV alone, and the primary checkout's `.env.local` sets
 * it while pointing DATABASE_URL at production — so a local `next dev` was a signed-in production
 * session. Measured 2026-10-01: production's only co-commissioner row was `local-dev-user`.
 *
 * No URL below is ever connected to; the guard only parses them. Hosts end in `.invalid`.
 */
const PROD = "postgresql://u:p@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.invalid/neondb?sslmode=require"
const PROD_SHADOW = "postgresql://u:p@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.invalid/mydb_shadow"
const TEST_DB = "postgresql://u:p@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.invalid/neondb"
const LOCAL = "postgresql://u:p@localhost:5432/allfantasy"
const UNKNOWN_BRANCH = "postgresql://u:p@ep-spring-forest-ad1r31s9-pooler.c-2.us-east-1.aws.invalid/neondb"

const bypassOn = (DATABASE_URL: string | undefined, extra: Record<string, string> = {}) => ({
  NODE_ENV: "development",
  DEV_AUTH_BYPASS_ENABLED: "true",
  NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED: "true",
  ...(DATABASE_URL === undefined ? {} : { DATABASE_URL }),
  ...extra,
})

describe("applyDevAuthBypassGuard", () => {
  it("🛑 turns BOTH flags off when the database is production, and says why", () => {
    const env: Record<string, string> = bypassOn(PROD)
    const warn = vi.fn()
    expect(applyDevAuthBypassGuard(env, warn)).toBe("refused")
    expect(env.DEV_AUTH_BYPASS_ENABLED).toBe("false")
    expect(env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED).toBe("false")
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain("PRODUCTION")
  })

  it("never puts the connection string's credentials in the warning", () => {
    const warn = vi.fn()
    applyDevAuthBypassGuard(bypassOn(PROD), warn)
    expect(warn.mock.calls[0][0]).not.toContain("u:p@")
  })

  it("fails CLOSED on a target it does not recognise, and on no URL at all", () => {
    const quiet = () => {}
    const branch: Record<string, string> = bypassOn(UNKNOWN_BRANCH)
    expect(applyDevAuthBypassGuard(branch, quiet)).toBe("refused")
    expect(branch.DEV_AUTH_BYPASS_ENABLED).toBe("false")
    const unset: Record<string, string> = bypassOn(undefined)
    expect(applyDevAuthBypassGuard(unset, quiet)).toBe("refused")
    expect(unset.DEV_AUTH_BYPASS_ENABLED).toBe("false")
  })

  it("keeps the bypass on a database known to be safe", () => {
    for (const url of [LOCAL, TEST_DB, PROD_SHADOW]) {
      const env: Record<string, string> = bypassOn(url)
      const warn = vi.fn()
      expect(applyDevAuthBypassGuard(env, warn)).toBe("allowed")
      expect(env.DEV_AUTH_BYPASS_ENABLED).toBe("true")
      expect(env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED).toBe("true")
      expect(warn).not.toHaveBeenCalled()
    }
  })

  it("acts when only the client flag is set, so no button offers a sign-in the server refuses", () => {
    const env: Record<string, string> = { NODE_ENV: "development", NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED: "true", DATABASE_URL: PROD }
    expect(applyDevAuthBypassGuard(env, () => {})).toBe("refused")
    expect(env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED).toBe("false")
  })

  it("does nothing, and reads nothing, in a production build or when the bypass is off", () => {
    const prod: Record<string, string> = { NODE_ENV: "production", DEV_AUTH_BYPASS_ENABLED: "true", DATABASE_URL: PROD }
    expect(applyDevAuthBypassGuard(prod, () => {})).toBe("production-build")
    expect(prod.DEV_AUTH_BYPASS_ENABLED).toBe("true")
    const off: Record<string, string> = { NODE_ENV: "development", DATABASE_URL: PROD }
    const warn = vi.fn()
    expect(applyDevAuthBypassGuard(off, warn)).toBe("off")
    expect(off).not.toHaveProperty("DEV_AUTH_BYPASS_ENABLED")
    expect(warn).not.toHaveBeenCalled()
  })
})
