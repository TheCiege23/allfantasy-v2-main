// @vitest-environment node
/**
 * The iOS app launches at bare `/core`. Signed out, that used to bounce to /login,
 * so a first-time user's first screen was a sign-in form with nothing saying what
 * the app is. `iosAppSignedOutDestination` sends exactly that launch URL to the
 * landing page instead — and nothing else.
 *
 * Each "goes to the landing" case has a control beside it that must NOT, so a
 * helper that returned "/" for everything cannot pass.
 */

import { describe, expect, it } from "vitest"

import { iosAppSignedOutDestination } from "@/lib/platform/iosApp"

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.0"
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

describe("iosAppSignedOutDestination", () => {
  it("sends the app's launch URL (bare /core) to the landing page", () => {
    expect(iosAppSignedOutDestination(IOS_UA, "", "")).toBe("/")
  })

  it("leaves the website alone — the same URL in Safari still goes to sign-in", () => {
    expect(iosAppSignedOutDestination(SAFARI_UA, "", "")).toBeNull()
    expect(iosAppSignedOutDestination(null, "", "")).toBeNull()
    expect(iosAppSignedOutDestination(undefined, "", "")).toBeNull()
  })

  it("keeps an in-app deep link going to sign-in, so the destination survives", () => {
    expect(iosAppSignedOutDestination(IOS_UA, "trades", "")).toBeNull()
    expect(iosAppSignedOutDestination(IOS_UA, "", "league=abc")).toBeNull()
    expect(iosAppSignedOutDestination(IOS_UA, "my-team", "league=abc")).toBeNull()
  })
})
