// @vitest-environment node
/**
 * Every social sign-in UI must be hidden inside the iOS app (App Store guideline
 * 4.8: third-party sign-in needs Sign in with Apple beside it, and Google refuses
 * OAuth in an embedded WebView). The hiding is `data-hide-in-ios-app` +
 * `html[data-ios-app]` in globals.css.
 *
 * WHY THIS IS A SOURCE SCAN: it guards against the failure that actually shipped —
 * /login and /signup moved to a NEW screen (AuthV4) with its own provider grid,
 * the attribute lived only on the two older components, and App Review's recording
 * showed Google, Spotify and Discord in the app. A new sign-in screen CALLS
 * isSocialProviderEnabled( to decide its buttons; that call is the tripwire (a
 * comment naming it has no parenthesis, and imports span lines, so neither is used).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"

function filesImportingSocialResolver(): string[] {
  const out = execSync(
    `git grep -l -F "isSocialProviderEnabled(" -- app components`,
    { encoding: "utf8" },
  )
  return out.split("\n").map((s) => s.trim()).filter(Boolean)
}

describe("social sign-in is hidden inside the iOS app", () => {
  const files = filesImportingSocialResolver()

  it("finds the sign-in grids (positive control: the scan is not empty)", () => {
    expect(files).toEqual(expect.arrayContaining(["components/core-app/screens/AuthV4.tsx", "components/auth/OAuthButtonRow.tsx"]))
  })

  it("every UI that decides social buttons marks them data-hide-in-ios-app", () => {
    const unmarked = files.filter((f) => !readFileSync(f, "utf8").includes("data-hide-in-ios-app"))
    expect(unmarked).toEqual([])
  })

  it("the stylesheet actually hides the marker inside the app", () => {
    const css = readFileSync("app/globals.css", "utf8")
    expect(css).toMatch(/html\[data-ios-app\] \[data-hide-in-ios-app\][\s\S]{0,800}display:\s*none !important/)
  })
})
