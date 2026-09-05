import { expect, test } from "@playwright/test"

test.describe("@dashboard unified dashboard click audit", () => {
  test.describe.configure({ timeout: 210_000, mode: "serial" })

  /*
   * ⚠ TWO OF THE THREE CARDS THIS USED TO ASSERT ARE NOT ON THIS PAGE FOR THIS VISITOR,
   * AND THAT IS THE DESIGN, NOT A BUG.
   *
   * `manager-dna-card-commissioner` and `decision-recommendations-card-commissioner` live
   * inside the League Focus section, which CommissionerHubPageClient gates behind
   * `representativeLeagueId` — an EXPLICIT league selection, since Phase OS-B1 replaced the
   * old automatic "first commissioner league" default. The switcher that sets it is fed
   * from `leagues.filter(l => l.isCommissioner)`, and an anonymous visitor has none, so
   * `league-switcher-empty` renders and there is nothing to select. No amount of waiting
   * makes those two cards appear here; the spec was asserting a state this page cannot
   * reach without an authenticated commissioner and seeded leagues.
   *
   * So the framing assertions move to the card that IS on this surface, and the gate
   * itself becomes a positive assertion — if League Focus ever renders unselected again,
   * this test says so instead of quietly passing.
   */
  test("audits commissioner Decision OS card framing", async ({ page }) => {
    await page.goto("/commissioner-hub")

    const pulse = page.getByTestId("league-pulse-card-commissioner")

    await expect(pulse).toBeVisible()
    await expect(pulse.getByText("Decision path")).toBeVisible()
    await expect(page.getByText(/without grounded data|unsupported claims|limited/i).first()).toBeVisible()
  })

  test("League Focus stays closed until a league is chosen", async ({ page }) => {
    await page.goto("/commissioner-hub")

    // The overview is the landing view; nothing is auto-selected.
    await expect(page.getByTestId("league-pulse-card-commissioner")).toBeVisible()
    await expect(page.getByTestId("league-focus-back-to-overview")).toHaveCount(0)
    await expect(page.getByTestId("manager-dna-card-commissioner")).toHaveCount(0)
    await expect(page.getByTestId("decision-recommendations-card-commissioner")).toHaveCount(0)

    /*
     * ⚠ `league-switcher-empty` CANNOT RENDER, SO THIS ASSERTED UNREACHABLE CODE.
     * CommissionerCommandCenterSection returns EARLY when there are no leagues
     * (`if (demoMode || !hasLeagues) return <DecisionOsEmptyState .../>`, line ~128),
     * and <CommissionerLeagueSwitcher> is mounted further down at line ~203 — inside the
     * branch that only runs when hasLeagues is TRUE. The switcher's own
     * `leagues.length === 0` arm is therefore dead from its single call site: it is
     * reachable only when the caller has already proved the list is non-empty.
     *
     * So the empty message the user actually sees belongs to the SECTION, not the
     * switcher, and it says more than the switcher's line did. Asserting the real one
     * keeps the intent of this test — nothing is auto-selected, and the page says why —
     * against markup that exists.
     *
     * The dead arm in CommissionerLeagueSwitcher.tsx is left in place deliberately:
     * removing it is a product decision, not something a failing e2e assertion should
     * force, and it is harmless where it sits.
     */
    await expect(page.getByTestId("commissioner-command-center-section")).toContainText(
      /multi-league overview will appear here/i
    )
  })
})
