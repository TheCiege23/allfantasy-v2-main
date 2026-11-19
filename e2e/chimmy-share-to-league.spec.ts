import { expect, test } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

/*
 * "Share with league" under a private @chimmy answer (2026-11-16): the real league chat stack
 * (LeagueChatSurface → LeagueConversation → ChatMessageList) on the DB-free redraft chat page, with a
 * private Chimmy question and answer in the transcript (?share=1). The answer stays private until the
 * tap; then the question and the answer appear in the league chat, credited to the asker.
 */

test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`${viewport.name}: a private Chimmy answer is shared with the league on a tap`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/e2e/redraft-league/chat?sport=NFL&score=0&share=1')
    const button = page.getByTestId('chimmy-share-button')
    await expect(button).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('chimmy-share-note')).toHaveText('Only you see this until you share it.')
    // Chimmy's Markdown is drawn, not printed: bold labels, a list, and no stray ** (found live 2026-11-17).
    const answer = page.locator('.af-cm-chimmy-text', { hasText: 'Start Puka Nacua.' }).first()
    await expect(answer.locator('strong')).toHaveText(['Start Puka Nacua.', 'Volume:', 'Matchup:'])
    await expect(answer).not.toContainText('**')
    await button.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-share-button.png`) })

    await button.click()
    await expect(page.getByTestId('chimmy-share-done')).toHaveText('Shared with your league')
    await expect(page.getByText('Fourth & Long asked Chimmy: "who should I start at flex, Puka Nacua or Drake London?"')).toBeVisible()
    await page.getByText('Fourth & Long asked Chimmy').scrollIntoViewIfNeeded()
    // The shared copy is the bubble's only child; it must keep the bubble's padding, unlike a lone GIF.
    const shared = page.locator('.af-cm-bubble', { has: page.locator('.af-cm-chimmy-text', { hasText: 'asked Chimmy' }) }).last()
    expect(await shared.evaluate((el) => getComputedStyle(el).paddingLeft)).not.toBe('0px')
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-shared.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
