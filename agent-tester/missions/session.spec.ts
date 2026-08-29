/**
 * Auth and session edge cases.
 *
 * The interrupted-user archetype exists for this file. Its quirks — idle mid
 * flow, reload, second tab, Back button — are the behaviours that expose session
 * handling, and they are precisely what a scripted suite never does, because a
 * script has no reason to interrupt its own happy path.
 *
 * The idle period is configurable via AGENT_TESTER_IDLE_MS. Raise it above your
 * real token lifetime for a true expiry test; the 45s default just catches the
 * app dropping sessions far too eagerly.
 */

import { test } from "@playwright/test"
import { ARCHETYPES } from "../archetypes"
import { Explorer, assertNoBlockers, type Mission } from "../explorer"
import { printSummary, writeReport } from "../reporter"

const writesAllowed = () => process.env.AGENT_TESTER_WRITES_ALLOWED === "1"
const baseURL = () => process.env.AGENT_TESTER_RESOLVED_BASE_URL ?? ""

const RESUME_AFTER_INTERRUPTION: Mission = {
  id: "resume-after-interruption",
  goal: "Start setting things up, get pulled away, come back and carry on where I left off",
  startPath: "/signup",
  success: {
    urlPattern: /\/(dashboard|onboarding|choose-username)/,
  },
  requiresWrites: true,
}

const RECOVER_ACCOUNT: Mission = {
  id: "recover-my-account",
  goal: "I forgot my password. Get back into my account.",
  startPath: "/signin",
  success: {
    textPattern: /check your (email|inbox)|reset link sent|we've sent/i,
  },
  // Password reset sends mail on the real path; the e2e bypass does not cover
  // the reset route, so this stays read-only-safe by only reaching the request
  // screen. Marked as requiring writes so it is skipped unless staging is live.
  requiresWrites: true,
}

test.describe("auth + session", () => {
  test.skip(
    () => !writesAllowed(),
    "Preflight put this run in read-only mode — session missions need a writable staging target."
  )

  test("interrupted user does not lose their session or their work @agent", async ({ page }) => {
    const explorer = new Explorer(page, ARCHETYPES.interruptedUser, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(RESUME_AFTER_INTERRUPTION)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })

  test("casual returner can recover a forgotten password @agent", async ({ page }) => {
    const explorer = new Explorer(page, ARCHETYPES.casualReturner, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(RECOVER_ACCOUNT)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })
})
