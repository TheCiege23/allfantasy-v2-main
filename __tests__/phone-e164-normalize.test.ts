import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { normalizePhoneE164 } from "@/lib/phone/e164"

describe("normalizePhoneE164 — the one stored phone key", () => {
  it("does not double the US country code on an 11-digit number that already starts with 1", () => {
    // The field report, 2026-10-01: verification stored "+112014176692" for this entry, and the
    // forgot-password lookup for "+12014176692" then found no verified phone.
    expect(normalizePhoneE164("12014176692")).toBe("+12014176692")
  })

  it("maps every common way of typing one US number to the same key", () => {
    const forms = [
      "2014176692",
      "12014176692",
      "+12014176692",
      "(201) 417-6692",
      "1 (201) 417-6692",
      "+1 201 417 6692",
      "201.417.6692",
    ]
    expect(new Set(forms.map(normalizePhoneE164))).toEqual(new Set(["+12014176692"]))
  })

  it("leaves an explicit international number alone and returns empty for empty input", () => {
    expect(normalizePhoneE164("+447700900123")).toBe("+447700900123")
    expect(normalizePhoneE164("   ")).toBe("")
  })
})

describe("no private phone normalizer survives", () => {
  // Every copy that read `startsWith("+") ? s : "+1" + s` produced the doubled key above. This
  // fails if one comes back. SignupFlowController is exempt: it is country-code aware and handles
  // the 11-digit case itself.
  const ALLOWED = new Set(["lib/phone/e164.ts", "lib/signup/SignupFlowController.ts"])
  // `"+1" + x` or `+1${x}` — the two spellings the eleven removed copies used.
  const PATTERN = '"\\+1" \\+ |`\\+1\\$\\{'

  /** git grep: 0 = matches, 1 = none, anything else is not a verdict. */
  function grep(args: string[]): string[] {
    const r = spawnSync("git", ["grep", "-nE", PATTERN, ...args], { encoding: "utf8" })
    if (r.status === 1) return []
    if (r.status !== 0) throw new Error(`git grep exited ${r.status}: ${r.stderr}`)
    return r.stdout.split("\n").filter(Boolean)
  }

  it("finds no '+1' prefixing outside the shared module", () => {
    const offenders = grep(["--", "app", "lib", "components"]).filter(
      (line) => !ALLOWED.has(line.split(":")[0]),
    )
    expect(offenders).toEqual([])
  })

  it("[control] the same grep does see a real occurrence — the allowlist is what passes it", () => {
    // SignupFlowController genuinely contains `+1${digits}`; if the pattern ever stops matching it,
    // the check above has gone blind rather than clean.
    expect(grep(["--", "lib/signup/SignupFlowController.ts"]).length).toBeGreaterThan(0)
  })
})
