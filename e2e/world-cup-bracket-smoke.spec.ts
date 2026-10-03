import { expect, test } from "@playwright/test"

test.describe("World Cup bracket smoke", () => {
  /*
   * ⚠ RETIRED: THE BRACKET CARD IS PARKED, NOT DELETED.
   *
   * /brackets exists and loads. What it no longer renders is the card this asserts:
   * world-cup-bracket-card survives only in app/brackets/_page-full.tsx.bak, the
   * shelved full version of the page. A .bak is not compiled and not routed, so
   * the id is absent from the running app -- measured, this test fails on its one
   * assertion at line 6.
   *
   * That backup is the reason this is skipped rather than deleted. Whoever
   * restores the full bracket page brings this test's target back with it, and a
   * deleted spec would not be there to notice.
   *
   * ⚠ WHAT THIS COSTS: nothing checks that /brackets offers a World Cup entry
   * point. The route itself is still covered elsewhere.
   *
   * ⚠ AND SINCE 2026-10-01 THERE SHOULD BE NONE. The owner switched the World
   * Cup off as a destination once the tournament ended; the hub now leads with
   * MLB/NHL playoff pools (__tests__/brackets-hub-restore.test.ts pins that).
   * Do not un-skip this to "restore coverage" — it would assert the opposite of
   * the decision. Restore it only alongside the next World Cup.
   */
  test.skip("shows the World Cup bracket entry point", async ({ page }) => {
    await page.goto("/brackets")
    await expect(page.getByTestId("world-cup-bracket-card")).toBeVisible()
  })
})
