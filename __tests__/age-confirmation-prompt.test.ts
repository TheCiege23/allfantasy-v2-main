/**
 * One-time age-confirmation prompt for accounts with no confirmation recorded.
 *
 * OAuth signups created accounts with `ageConfirmedAt` null because the /signup checkbox
 * was never passed to the provider buttons. Those users cannot be repaired by a backfill —
 * someone who ticked the box is indistinguishable from someone who never did, so stamping
 * them all would fabricate a legal attestation. They have to be asked once.
 *
 * The invariants worth locking are all about restraint: never ask a signed-out visitor,
 * never ask on the auth pages, never guess on a failed read, and never trap the user.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

const route = read("app/api/auth/confirm-age/route.ts")
const prompt = read("components/legal/AgeConfirmationPrompt.tsx")
const chrome = read("components/shell/SafeGlobalChrome.tsx")

describe("status endpoint is folded onto the EXISTING route", () => {
  it("adds GET beside the existing POST — no new route", () => {
    // The repo sits at Vercel's hard 2048-route ceiling; a new route breaks the build.
    expect(route).toMatch(/export async function GET\(/)
    expect(route).toMatch(/export async function POST\(/)
  })

  it("reports confirmed for signed-out callers so anonymous visitors are never nagged", () => {
    expect(route).toMatch(/if \(!session\?\.user\?\.id\)[\s\S]{0,160}confirmed: true/)
  })

  it("fails QUIET on a read error rather than showing a legal modal to everyone", () => {
    expect(route).toMatch(/catch[\s\S]{0,300}confirmed: true[\s\S]{0,80}degraded: true/)
  })
})

describe("the prompt only asks when it should", () => {
  it("asks only authenticated users", () => {
    expect(prompt).toMatch(/status !== "authenticated"/)
  })

  it("renders ONLY on an explicit confirmed:false — never on a malformed response", () => {
    expect(prompt).toMatch(/data\?\.confirmed === false/)
  })

  it("returns null when there is nothing to ask", () => {
    expect(prompt).toMatch(/if \(!needsConfirm\) return null/)
  })

  it("is not a trap — a dismissal path exists", () => {
    // The real feature gates still protect restricted surfaces, so this prompt does not
    // need to hold the app hostage to do its job.
    expect(prompt).toMatch(/Not now/)
    expect(prompt).toMatch(/sessionStorage/)
  })

  it("dismissal is session-scoped, so it returns next session until confirmed", () => {
    expect(prompt).toContain("sessionStorage")
    expect(prompt).not.toContain("localStorage")
  })

  it("POSTs to the existing confirm-age endpoint", () => {
    expect(prompt).toMatch(/fetch\("\/api\/auth\/confirm-age", \{ method: "POST" \}\)/)
  })
})

describe("mounting", () => {
  it("is excluded from the auth routes", () => {
    // Asking someone to confirm their age on top of the signup form they are already
    // filling in would be both confusing and redundant.
    expect(chrome).toMatch(/isAuthPath\(pathname\) \? null : <AgeConfirmationPrompt \/>/)
  })
})
