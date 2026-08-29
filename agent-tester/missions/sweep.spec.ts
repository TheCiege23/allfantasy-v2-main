/**
 * Broad exploratory sweep.
 *
 * No goal beyond "wander and report". This is the mission that finds unknowns —
 * the dead button on a page nobody wrote a spec for, the 500 on a route that
 * only appears in a dropdown, the tap target that is 28px on a phone.
 *
 * Crucially this file does NOT require writes, so it is the one suite that runs
 * safely even when the preflight has locked the run to read-only. If you only
 * ever run one thing against an unfamiliar deploy, run this.
 */

import { test } from "@playwright/test"
import { ARCHETYPES } from "../archetypes"
import { Explorer, type Mission, type RunResult } from "../explorer"
import { printSummary, writeReport } from "../reporter"

const baseURL = () => process.env.AGENT_TESTER_RESOLVED_BASE_URL ?? ""

/**
 * Entry points worth wandering from. Public surfaces first — these are what an
 * unauthenticated visitor can reach, and therefore what a broken one costs most.
 */
const ENTRY_POINTS = [
  { path: "/", label: "landing page" },
  { path: "/pricing", label: "pricing" },
  { path: "/find-league", label: "league discovery" },
  { path: "/players", label: "player browser" },
  { path: "/tools-hub", label: "tools hub" },
]

function sweepMission(path: string, label: string): Mission {
  return {
    id: `sweep-${label.replace(/\s+/g, "-")}`,
    goal: `Look around the ${label} and see if anything is broken`,
    startPath: path,
    // No success condition — the sweep runs to its step budget by design. The
    // output is the findings, not a pass/fail on reaching a destination.
    success: {},
    requiresWrites: false,
  }
}

test.describe("exploratory sweep", () => {
  for (const entry of ENTRY_POINTS) {
    test(`casual returner sweeps the ${entry.label} @agent @sweep`, async ({ page }) => {
      const explorer = new Explorer(page, ARCHETYPES.casualReturner, baseURL())
      explorer.attachListeners()

      const result = await explorer.run(sweepMission(entry.path, entry.label))

      writeReport([result], { baseURL: baseURL() })
      printSummary([result])

      // A sweep does not fail the build on blockers — it is a discovery pass and
      // an unauthenticated 500 on an obscure route should not block a deploy.
      // Read the report. The targeted missions are the ones that gate.
    })
  }

  test("anxious first-timer sweeps the landing page on a phone @agent @sweep", async ({ page }) => {
    // Mobile persona on the highest-traffic page: this is where tap-target and
    // slow-network findings concentrate.
    const explorer = new Explorer(page, ARCHETYPES.anxiousFirstTimer, baseURL())
    explorer.attachListeners()

    const result: RunResult = await explorer.run(sweepMission("/", "landing page on mobile"))

    writeReport([result], { baseURL: baseURL() })
    printSummary([result])
  })
})
