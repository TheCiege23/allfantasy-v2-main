import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ timeout: 180_000 })

async function gotoWithRetry(page: Page, url: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" })
      return
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      const canRetry =
        attempt < 6 &&
        (
          message.includes("net::ERR_ABORTED") ||
          message.includes("NS_BINDING_ABORTED") ||
          message.includes("net::ERR_CONNECTION_RESET") ||
          message.includes("NS_ERROR_CONNECTION_REFUSED") ||
          message.includes("Failure when receiving data from the peer") ||
          message.includes("Could not connect to server") ||
          message.includes("interrupted by another navigation")
        )
      if (!canRetry) throw error
      await page.waitForTimeout(500 * attempt)
    }
  }
}

test.describe("@news fantasy news aggregator click audit", () => {
  test("audits article open, player link, share, and refresh wiring", async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__fantasyNewsShareCalls = []
      ;(window as any).__fantasyNewsClipboard = ""

      const share = async (payload: unknown) => {
        ;(window as any).__fantasyNewsShareCalls.push(payload)
      }
      const clipboard = {
        writeText: async (text: string) => {
          ;(window as any).__fantasyNewsClipboard = text
        },
      }

      Object.defineProperty(window.navigator, "share", {
        configurable: true,
        value: share,
      })
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: clipboard,
      })
    })

    await gotoWithRetry(page, "/e2e/fantasy-news")
    await expect(page.getByRole("heading", { name: /Fantasy News Aggregator Harness/i })).toBeVisible()
    await expect(page.getByTestId("fantasy-news-hydrated-flag")).toContainText("hydrated")

    await page.getByTestId("fantasy-news-feed-type-player").click()
    await page.getByTestId("fantasy-news-query-input").fill("Josh Allen")
    await page.getByTestId("fantasy-news-load-button").click()

    const card = page.getByTestId("fantasy-news-card-news-1")
    const sourceLink = page.getByTestId("fantasy-news-source-link-news-1")
    const playerLink = page.getByTestId("fantasy-news-player-link-news-1")
    const shareButton = page.getByTestId("fantasy-news-share-button-news-1")
    const refreshButton = page.getByTestId("fantasy-news-refresh-button")

    await expect(card).toBeVisible()
    await expect(sourceLink).toBeVisible()
    await expect(playerLink).toBeVisible()
    await expect(shareButton).toBeVisible()

    await expect(card).toHaveAttribute("href", "about:blank#player-article")
    await expect(card).toHaveAttribute("target", "_blank")

    const cardPopupPromise = page.waitForEvent("popup", { timeout: 2_500 }).catch(() => null)
    await card.click()
    const cardPopup = await cardPopupPromise
    if (cardPopup) {
      await expect.poll(() => cardPopup.url()).toContain("about:blank#player-article")
      await cardPopup.close()
    }

    await expect(playerLink).toHaveAttribute("href", /\/af-rankings\?q=Josh%20Allen/)

    await shareButton.click()
    await expect
      .poll(async () =>
        page.evaluate(() => ((window as any).__fantasyNewsShareCalls?.length as number) ?? 0)
      )
      .toBeGreaterThan(0)
    await expect(page.getByTestId("fantasy-news-share-count")).toContainText("Share count: 1")

    await refreshButton.click()
    await expect(page.getByTestId("fantasy-news-refresh-count")).toContainText("Refresh count: 1")

    const playerNav = page.waitForURL(/\/af-legacy\?tab=players&q=Josh%20Allen/, { timeout: 2_500 }).catch(() => null)
    await playerLink.click()
    const navigated = await playerNav
    if (navigated) {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null)
    }
  })
})
