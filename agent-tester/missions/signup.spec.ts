/**
 * Signup and onboarding missions.
 *
 * This is the highest-value surface for AllFantasy specifically, because the
 * product is seasonal: a large share of traffic is people who have not touched
 * fantasy since last year, arriving with no memory of the flow. The existing
 * e2e/onboarding-funnel-click-audit.spec.ts proves the funnel *works*; these
 * missions ask whether a distracted human can actually get through it.
 *
 * All personas here need writes, so they are skipped automatically when the
 * preflight put the run in read-only mode.
 */

import { test } from "@playwright/test"
import { ARCHETYPES } from "../archetypes"
import { Explorer, assertNoBlockers, type Mission } from "../explorer"
import { printSummary, writeReport } from "../reporter"

const writesAllowed = () => process.env.AGENT_TESTER_WRITES_ALLOWED === "1"
const baseURL = () => process.env.AGENT_TESTER_RESOLVED_BASE_URL ?? ""

const CREATE_ACCOUNT: Mission = {
  id: "create-an-account",
  goal: "Create a new account and get to the point where I can actually use the app",
  startPath: "/signup",
  success: {
    urlPattern: /\/(dashboard|onboarding|choose-username)/,
  },
  requiresWrites: true,
}

const LANDING_TO_SIGNUP: Mission = {
  id: "landing-to-signup",
  goal: "I heard about this app. Figure out what it is and sign up.",
  startPath: "/",
  success: {
    urlPattern: /\/(dashboard|onboarding|choose-username)/,
  },
  requiresWrites: true,
}

test.describe("signup + onboarding", () => {
  test.skip(
    () => !writesAllowed(),
    "Preflight put this run in read-only mode — signup missions need a writable staging target."
  )

  test("anxious first-timer can create an account @agent", async ({ page }) => {
    const explorer = new Explorer(page, ARCHETYPES.anxiousFirstTimer, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(CREATE_ACCOUNT)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })

  test("casual returner can find their way from the landing page @agent", async ({ page }) => {
    const explorer = new Explorer(page, ARCHETYPES.casualReturner, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(LANDING_TO_SIGNUP)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })

  test("power user does not create duplicates by clicking fast @agent", async ({ page }) => {
    // The power-user profile double-clicks every primary action by design. On a
    // signup form that is the classic double-submit test: two accounts, or one
    // account and a confusing "email already exists" on the user's own click.
    const explorer = new Explorer(page, ARCHETYPES.powerUser, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(CREATE_ACCOUNT)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })
})
