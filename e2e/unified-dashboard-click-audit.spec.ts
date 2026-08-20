import { expect, test } from "@playwright/test"

test.describe("@dashboard unified dashboard click audit", () => {
  test.describe.configure({ timeout: 210_000, mode: "serial" })

  test("audits commissioner Decision OS card framing", async ({ page }) => {
    await page.goto("/commissioner-hub")

    const pulse = page.getByTestId("league-pulse-card-commissioner")
    const manager = page.getByTestId("manager-dna-card-commissioner")
    const moves = page.getByTestId("decision-recommendations-card-commissioner")

    await expect(pulse).toBeVisible()
    await expect(manager).toBeVisible()
    await expect(moves).toBeVisible()

    await expect(pulse.getByText("Decision path")).toBeVisible()
    await expect(manager.getByText("Commissioner use")).toBeVisible()
    await expect(moves.getByText("No grounded moves are ready yet.", { exact: true })).toBeVisible()
    await expect(page.getByText(/without grounded data|unsupported claims|limited/i).first()).toBeVisible()
  })
})
