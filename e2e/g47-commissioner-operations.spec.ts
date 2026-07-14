import { expect, test } from '@playwright/test'

const PATH = '/e2e/g47-commissioner-operations'

async function gotoReady(page: import('@playwright/test').Page) {
  await page.goto(PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(page.getByTestId('g47-commissioner-harness')).toHaveAttribute('data-hydrated', 'true', { timeout: 120_000 })
}

test.describe.configure({ timeout: 180_000 })

test.describe('@g47 commissioner operations workspace', () => {
  test('desktop renders grouped operations and routes existing actions', async ({ page }) => {
    await gotoReady(page)
    await expect(page.getByTestId('commissioner-operations-workspace')).toBeVisible()
    await expect(page.getByTestId('commissioner-group-league-operations')).toBeVisible()
    await expect(page.getByTestId('commissioner-group-transactions')).toBeVisible()
    await expect(page.getByTestId('commissioner-group-communication')).toBeVisible()
    await page.getByTestId('commissioner-operation-schedule').click()
    await expect(page.getByTestId('g47-last-action')).toHaveText('tab:schedule')
    await page.getByTestId('commissioner-operation-league-controls').click()
    await expect(page.getByTestId('g47-last-action')).toHaveText('settings:commish-controls')
  })

  test('non-commissioner state hides all privileged actions', async ({ page }) => {
    await gotoReady(page)
    await page.getByTestId('g47-toggle-role').click()
    await expect(page.getByTestId('commissioner-operations-denied')).toBeVisible()
    await expect(page.getByTestId('commissioner-operations-workspace')).toHaveCount(0)
  })

  test('mobile cards stack with usable touch targets and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoReady(page)
    const workspace = page.getByTestId('commissioner-operations-workspace')
    await expect(workspace).toBeVisible()
    const schedule = page.getByTestId('commissioner-operation-schedule')
    await expect(schedule).toBeVisible()
    expect((await schedule.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    await schedule.click()
    await expect(page.getByTestId('g47-last-action')).toHaveText('tab:schedule')
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)
    expect(noOverflow).toBeTruthy()
  })
})
