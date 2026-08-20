import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { resendSendError } from "@/lib/resend-client"

/**
 * Launch-hardening: Resend resolves { data, error } WITHOUT throwing on a provider rejection.
 * resendSendError is the shared, non-throwing check reused by sendEmail() and the two
 * verification-email routes. It must classify success vs failure and return only a sanitized,
 * log-safe provider string (message/name) — never a recipient, token, URL, or key.
 */
describe("resendSendError", () => {
  it("returns null for a successful send (error: null)", () => {
    expect(resendSendError({ data: { id: "e1" }, error: null } as never)).toBeNull()
    expect(resendSendError({})).toBeNull()
    expect(resendSendError(null)).toBeNull()
    expect(resendSendError(undefined)).toBeNull()
  })

  it("returns the provider message when the SDK reports { error } without throwing", () => {
    expect(resendSendError({ error: { name: "validation_error", message: "domain is not verified" } })).toBe(
      "domain is not verified",
    )
  })

  it("falls back to the provider error name, then a generic label", () => {
    expect(resendSendError({ error: { name: "rate_limit_exceeded" } })).toBe("rate_limit_exceeded")
    expect(resendSendError({ error: {} })).toBe("unknown provider error")
  })
})

/**
 * The register route is too heavy to import with mocks (same convention as
 * beta-gate-account-creation-paths.test.ts), so its send-failure contract is asserted at the
 * source level.
 */
function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

describe("register route — verification-email send is checked, sanitized, and non-destructive", () => {
  const src = read("app/api/auth/register/route.ts")

  it("captures and inspects the Resend result instead of ignoring it", () => {
    expect(src).toContain("const sendResult = await client.emails.send")
    expect(src).toContain("resendSendError(sendResult)")
  })

  it("marks emailVerificationPrepared=true only after the provider did not reject", () => {
    const checkAt = src.indexOf("resendSendError(sendResult)")
    const prepAt = src.indexOf("emailVerificationPrepared = true")
    expect(checkAt).toBeGreaterThan(-1)
    expect(prepAt).toBeGreaterThan(checkAt) // success flag is set after (and gated by) the check
  })

  it("removes the undelivered token when no email went out", () => {
    expect(src).toContain("emailVerifyToken.delete")
    expect(src).toMatch(/!emailVerificationPrepared && createdTokenId/)
  })

  it("does not roll back the created account on a send failure (account is created before the email block)", () => {
    expect(src.indexOf("createAccountOnce(username)")).toBeLessThan(src.indexOf("let emailVerificationPrepared"))
  })

  it("logs only a sanitized message — never the raw error object, token, URL, or recipient", () => {
    expect(src).toContain("emailErr instanceof Error ? emailErr.message")
    // the old unsanitized log (raw error object) is gone
    expect(src).not.toContain('"[register] Failed to create/send verification email (non-blocking):", emailErr')
    // no console.error in this file interpolates the verification URL or the raw token
    expect(src).not.toMatch(/console\.error\([^)]*verifyUrl/)
    expect(src).not.toMatch(/console\.error\([^)]*rawToken/)
  })
})
