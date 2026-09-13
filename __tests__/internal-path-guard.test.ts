import { describe, expect, it } from "vitest"

import {
  isSafeInternalPath,
  loginUrlWithIntent,
  safeInternalPathOr,
  safeRedirectPath,
} from "@/lib/auth/auth-intent-resolver"
import { relativeRedirect, relativeUrl } from "@/lib/http/relative-redirect"
import { canonicalizeProductRoute } from "@/lib/routing/canonicalizeProductRoute"
import { sanitizeYahooReturnTo } from "@/lib/yahoo/oauthConfig"

/*
 * Built from char codes so no quoting layer between here and the parser can flatten them — an
 * earlier probe of this exact bug read "/\evil" as "/evil" and reported the guard safe.
 */
const BACKSLASH = String.fromCharCode(92)
const TAB = String.fromCharCode(9)
const LF = String.fromCharCode(10)

/**
 * Every one of these begins with exactly one "/", so the previous guard
 * (`startsWith("/") && !startsWith("//")`) accepted all of them.
 */
const LEAVES_SITE: Array<[string, string]> = [
  ["backslash", `/${BACKSLASH}evil.example`],
  ["double backslash", `/${BACKSLASH}${BACKSLASH}evil.example`],
  ["backslash then slash", `/${BACKSLASH}/evil.example`],
  ["tab", `/${TAB}/evil.example`],
  ["newline", `/${LF}/evil.example`],
  ["dot segment", "/.//evil.example"],
  ["encoded dot segment", "/%2e//evil.example"],
  ["parent segment", "/core/..//evil.example"],
]

const STAYS_ON_SITE = [
  "/core",
  "/",
  "/invite/accept?code=TOKEN123",
  "/world-cup-intro?next=/brackets",
  "/leagues?error=yahoo_denied",
  "/brackets#top",
  "/signup?next=%2Fcore",
  "/a%20b",
]

const SITE = "https://allfantasy.example"
const previousGuard = (p: string) => p.trim().startsWith("/") && !p.trim().startsWith("//")

describe("the bypass table is a real positive control", () => {
  it.each(LEAVES_SITE)("%s: passed the previous guard", (_label, value) => {
    expect(value.charCodeAt(0)).toBe(47)
    expect(previousGuard(value)).toBe(true)
  })

  it.each(LEAVES_SITE)("%s: genuinely leaves the site, or normalises to //host", (_label, value) => {
    const resolved = new URL(value, SITE)
    expect(resolved.origin !== SITE || resolved.pathname.startsWith("//")).toBe(true)
  })
})

describe("isSafeInternalPath", () => {
  it.each(LEAVES_SITE)("rejects %s", (_label, value) => {
    expect(isSafeInternalPath(value)).toBe(false)
    expect(safeRedirectPath(value)).toBe("/core")
    expect(safeInternalPathOr(value, "/fallback")).toBe("/fallback")
  })

  it.each(["https://evil.example", "//evil.example", "javascript:alert(1)", "core", "", null, undefined, 42])(
    "rejects %s",
    (value) => {
      expect(isSafeInternalPath(value)).toBe(false)
    },
  )

  it.each(STAYS_ON_SITE)("keeps %s byte-for-byte", (value) => {
    expect(isSafeInternalPath(value)).toBe(true)
    expect(safeRedirectPath(value)).toBe(value)
  })

  it("returns the trimmed ORIGINAL, never a normalised pathname", () => {
    expect(safeRedirectPath("  /leagues/../core  ")).toBe("/leagues/../core")
  })

  it("keeps the intent round-trip the login links depend on", () => {
    expect(loginUrlWithIntent("/world-cup-intro?next=/brackets")).toBe(
      `/login?callbackUrl=${encodeURIComponent("/world-cup-intro?next=/brackets")}`,
    )
  })
})

describe("sinks that route through the guard", () => {
  it.each(LEAVES_SITE)("relativeUrl refuses %s", (_label, value) => {
    expect(() => relativeUrl(value)).toThrow()
    expect(() => relativeRedirect(value)).toThrow()
  })

  it("relativeRedirect refuses a URL whose pathname was edited to //host after parsing", () => {
    const target = relativeUrl("/import")
    target.pathname = "//evil.example"
    expect(() => relativeRedirect(target)).toThrow()
  })

  it.each(STAYS_ON_SITE)("relativeRedirect still emits %s", (value) => {
    expect(relativeRedirect(value).headers.get("location")).toBe(value)
  })

  it.each(LEAVES_SITE)("sanitizeYahooReturnTo falls back on %s", (_label, value) => {
    expect(sanitizeYahooReturnTo(value)).toBe("/import")
  })

  it.each(LEAVES_SITE)("canonicalizeProductRoute falls back on %s", (_label, value) => {
    expect(canonicalizeProductRoute(value)).toBe("/core")
  })
})
