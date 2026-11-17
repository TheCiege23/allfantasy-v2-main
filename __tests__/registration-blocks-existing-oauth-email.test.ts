import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Confirms the "Facebook then email/password with the same email" scenario:
 * a credentials-based signup for an email that already belongs to an
 * OAuth-linked AppUser (e.g. created via linkSocialAccountToAppUser) is
 * blocked with a clear 409, not silently creating a second AppUser.
 * Source-assertion style, matching the existing convention in
 * login-identifier-auth.test.ts for this same route.
 */
describe("register route — blocks signup for an email that already has an account (OAuth or otherwise)", () => {
  const src = readFileSync(resolve(process.cwd(), "app/api/auth/register/route.ts"), "utf-8")

  it("looks up any existing AppUser by email (case-insensitive) before creating a new one", () => {
    // Only when an email was given: a phone sign-up may have none (2026-11-14).
    expect(src).toContain('...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])')
  })

  it("a phone sign-up whose number is already on an account gets a 409 pointing at text-code sign-in", () => {
    const block = src.match(/where: \{ phone: normalizedPhone \}[\s\S]{0,400}/)
    expect(block?.[0]).toContain("An account already uses this phone number. Sign in with a text code instead.")
    expect(block?.[0]).toContain("409")
  })

  it("email is optional ONLY for a phone sign-up", () => {
    expect(src).toContain('if (email ? !email.includes("@") : !isPhoneSignup) {')
  })

  it("rejects the signup with 409 when that email is already taken — never proceeds to create a duplicate AppUser", () => {
    const conflictBlock = src.match(/existing\?\.email[\s\S]{0,200}/)
    expect(conflictBlock).toBeTruthy()
    expect(conflictBlock?.[0]).toContain("An account with this email already exists.")
    expect(conflictBlock?.[0]).toContain("409")
  })
})
