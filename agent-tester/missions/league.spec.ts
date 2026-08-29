/**
 * League and draft missions.
 *
 * Core product value, and the most stateful surface in the app — which is
 * exactly why exploratory testing finds things here that click-audits do not.
 * A scripted draft spec drives a known sequence; a commissioner persona changes
 * a setting after the fact, reloads, opens a second tab, and finds out whether
 * the state machine survives being used the way people actually use it.
 */

import { test } from "@playwright/test"
import { ARCHETYPES } from "../archetypes"
import { Explorer, assertNoBlockers, type Mission } from "../explorer"
import { printSummary, writeReport } from "../reporter"

const writesAllowed = () => process.env.AGENT_TESTER_WRITES_ALLOWED === "1"
const baseURL = () => process.env.AGENT_TESTER_RESOLVED_BASE_URL ?? ""

const CREATE_LEAGUE: Mission = {
  id: "create-a-league",
  goal: "Set up a new fantasy league that my friends can join",
  startPath: "/create-league",
  success: {
    urlPattern: /\/(league|leagues|dashboard)\//,
    textPattern: /invite|share.*link|league created|your league/i,
  },
  requiresWrites: true,
}

const FIND_LEAGUE: Mission = {
  id: "find-a-league",
  goal: "Find a public league I can join",
  startPath: "/find-league",
  success: {
    textPattern: /joined|request sent|you're in|welcome to/i,
  },
  requiresWrites: true,
}

const REACH_DRAFT: Mission = {
  id: "reach-the-draft-room",
  goal: "Get into a draft room and make a pick",
  startPath: "/dashboard",
  success: {
    urlPattern: /\/draft/,
    textPattern: /on the clock|your pick|drafted/i,
  },
  requiresWrites: true,
}

test.describe("league + draft", () => {
  test.skip(
    () => !writesAllowed(),
    "Preflight put this run in read-only mode — league missions need a writable staging target."
  )

  test("commissioner can set up a league end to end @agent", async ({ page }) => {
    const explorer = new Explorer(page, ARCHETYPES.commissioner, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(CREATE_LEAGUE)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })

  test("casual returner can find and join a league @agent", async ({ page }) => {
    const explorer = new Explorer(page, ARCHETYPES.casualReturner, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(FIND_LEAGUE)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })

  test("power user can reach the draft room @agent", async ({ page }) => {
    const explorer = new Explorer(page, ARCHETYPES.powerUser, baseURL())
    explorer.attachListeners()

    const result = await explorer.run(REACH_DRAFT)

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
    assertNoBlockers(result)
  })
})
