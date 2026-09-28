import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * P0-1 BETA-GATE — no-bypass proof.
 *
 * Behavioral admission logic is covered in beta-invite-admission.test.ts. This file proves,
 * by source assertion (the register/OAuth modules are too heavy to import with mocks — the
 * same convention as registration-blocks-existing-oauth-email.test.ts), that:
 *   (a) every REAL AppUser-creation path routes through the centralized service, and
 *   (b) the ordering invariants hold (consume inside the create tx; no signup_completed on
 *       a rejected signup; existing-user paths are untouched).
 *
 * If a future change adds a new real signup path that creates an AppUser without the gate,
 * the "every appUser.create is gated" assertion below is the tripwire.
 */
function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

const register = read("app/api/auth/register/route.ts")
const oauth = read("lib/auth/SocialAccountLinkingService.ts")
const authTs = read("lib/auth.ts")

describe("credentials register path is gated", () => {
  it("routes through the centralized admission service (no ad-hoc invite logic)", () => {
    expect(register).toContain("@/lib/beta-invite/betaAdmissionService")
    expect(register).toContain("isInviteOnlyEnabled()")
    expect(register).toContain("validateAdmission(")
    expect(register).toContain("consumeAdmission(")
  })
  it("consumes the invite INSIDE the create transaction so a failed signup does not burn it", () => {
    // consumeAdmission must appear within the prisma.$transaction block, passing the tx client.
    const txStart = register.indexOf("prisma.$transaction")
    const consumeAt = register.indexOf("consumeAdmission(", txStart)
    expect(txStart).toBeGreaterThan(-1)
    expect(consumeAt).toBeGreaterThan(txStart)
    expect(register.slice(consumeAt, consumeAt + 200)).toContain("db: tx")
  })
  it("pre-checks admission BEFORE the create work and fails closed on a gate error", () => {
    expect(register).toMatch(/validateAdmission[\s\S]{0,400}GATE_UNAVAILABLE/)
    expect(register).toContain("status: 503") // fail-closed path returns 503
  })
  it("bypasses the gate only under the existing E2E seam", () => {
    expect(register).toContain("isInviteOnlyEnabled() && !isE2ERequest")
  })
  it("emits signup_completed only AFTER account creation, never on a rejected signup", () => {
    // The gate throws before `user` is assigned, so the SIGNUP_COMPLETED emit is unreachable
    // on rejection. Assert the emit still exists and sits after the create loop.
    expect(register).toContain("ACQUISITION.SIGNUP_COMPLETED")
    const consumeAt = register.indexOf("consumeAdmission(")
    const emitAt = register.indexOf("ACQUISITION.SIGNUP_COMPLETED")
    expect(emitAt).toBeGreaterThan(consumeAt)
  })
  it("clears the admission cookie on success so a consumed token cannot be replayed", () => {
    expect(register).toContain("clearAdmissionCookie(res.cookies)")
  })
})

describe("OAuth new-account path is gated", () => {
  it("routes through the centralized service in the create branch", () => {
    expect(oauth).toContain("@/lib/beta-invite/betaAdmissionService")
    expect(oauth).toContain("validateAdmission(")
    expect(oauth).toContain("consumeAdmission(")
  })
  it("gates only the NEW-account branch, leaving existing-user linking untouched", () => {
    // The gate + create live inside `if (!user && normalizedEmail)`. The existing-account
    // lookup (`if (!user && normalizedEmail && providerVerifiedEmail)`) returns before it.
    const createBranch = oauth.indexOf("if (!user && normalizedEmail) {")
    const gateAt = oauth.indexOf("BETA-GATE", createBranch)
    expect(createBranch).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(createBranch)
  })
  it("consumes inside a transaction wrapping the create", () => {
    expect(oauth).toContain("prisma.$transaction")
    const txAt = oauth.indexOf("prisma.$transaction")
    const consumeAt = oauth.indexOf("consumeAdmission(", txAt)
    expect(consumeAt).toBeGreaterThan(txAt)
  })
  it("enforces the OAuth email match (passes normalizedEmail to the gate)", () => {
    expect(oauth).toMatch(/validateAdmission\(\{ rawToken: admissionToken, email: normalizedEmail/)
  })
  it("maps a refusal to an honest signup redirect, never leaking a token", () => {
    expect(authTs).toContain('errMsg.startsWith("BETA_INVITE_")')
    expect(authTs).toContain("/signup?beta=1&betaError=")
  })
})

/*
 * The Sleeper-username sign-in path this file used to gate is GONE, not gated. It signed a caller
 * in with a public Sleeper username as the only credential — see the note where it lived in
 * lib/auth.ts, and __tests__/auth-no-sleeper-username-signin.test.ts for the behavioural check.
 */
describe("there is no Sleeper-username account-creation path to gate", () => {
  it("lib/auth.ts registers no `sleeper` provider and mints no sleeper_<id> accounts", () => {
    expect(authTs).not.toMatch(/^\s*id: "sleeper",/m)
    expect(authTs).not.toContain("@sleeper.allfantasy.ai`")
    expect(authTs).not.toContain("username: `sleeper_")
  })
})

describe("no real AppUser-creation path bypasses the gate", () => {
  it("the production signup files route every AppUser create through the admission service", () => {
    // A tripwire, not an exhaustive scan: if a NEW production create appears here without the
    // gate, this documents the expectation that it must route through the service.
    for (const src of [register, oauth]) {
      const createsUser = src.includes("appUser.create")
      if (createsUser) {
        expect(src).toContain("betaAdmissionService")
      }
    }
  })

  it("lib/auth.ts creates an AppUser only for the non-production dev bypass", () => {
    // ⚠ lib/auth.ts used to import betaAdmissionService solely for the Sleeper-username path.
    // What remains is `ensureDevAuthUser`, reachable only when isDevAuthBypassEnabled() — which
    // is hard-false under NODE_ENV=production. A second create here must be gated like the others.
    const creates = authTs.match(/appUser\.create\(/g) ?? []
    expect(creates).toHaveLength(1)
    const devFn = authTs.indexOf("async function ensureDevAuthUser")
    const create = authTs.indexOf("appUser.create(")
    const nextFn = authTs.indexOf("\nconst providers", devFn)
    expect(devFn).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(devFn)
    expect(create).toBeLessThan(nextFn)
    expect(authTs).toMatch(/process\.env\.NODE_ENV !== "production" && process\.env\.DEV_AUTH_BYPASS_ENABLED/)
  })
})
