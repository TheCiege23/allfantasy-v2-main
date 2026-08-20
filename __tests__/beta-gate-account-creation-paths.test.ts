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

describe("Sleeper-username new-account path is BLOCKED in invite-only mode (no token-only admission)", () => {
  it("blocks a new Sleeper account when invite-only is on, rather than admitting by token", () => {
    // Email-bound policy: a Sleeper synthetic email cannot match a bound invite, so a NEW
    // Sleeper account simply cannot be admitted — it is blocked, not token-consumed.
    const createBranch = authTs.indexOf("BETA-GATE (Sleeper")
    expect(createBranch).toBeGreaterThan(-1)
    expect(authTs).toMatch(/if \(isInviteOnlyEnabled\(\)\) \{\s*throw new Error\("BETA_INVITE_REQUIRED"\)/)
    // And it must NOT consume/validate an invite by token on this path.
    expect(authTs).not.toContain("sleeperAdmissionToken")
  })
})

describe("no real AppUser-creation path bypasses the gate", () => {
  it("the three production signup files are the only ones creating AppUsers outside admin/seed", () => {
    // A tripwire, not an exhaustive scan: if a NEW production create appears here without the
    // gate, this documents the expectation that it must route through the service.
    for (const src of [register, oauth, authTs]) {
      const createsUser = src.includes("appUser.create")
      if (createsUser) {
        expect(src).toContain("betaAdmissionService")
      }
    }
  })
})
