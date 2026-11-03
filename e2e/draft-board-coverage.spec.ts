import { expect, test } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

const sports = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']

test('@draft-room shared live and mock boards fit all sports and narrow docks', async ({ page, context }) => {
  test.setTimeout(240_000)
  await answerCspReportsInBrowser(context)
  await page.goto('/e2e/draft-board-coverage')
  await expect(page.getByTestId('coverage-NFL')).toBeVisible()
  for (const width of [390, 1024, 1580]) {
    await page.setViewportSize({ width, height: 900 })
    for (const mode of ['live', 'mock', 'linear', 'auction']) {
      await page.getByLabel('Board renderer').selectOption(mode)
      for (const sport of sports) {
        const board = page.getByTestId(`coverage-${sport}`)
        const cell = board.getByTestId('draft-board-cell-1')
        await expect(cell).toContainText('Example Player 1')
        await expect(cell).toHaveCSS('height', '50px')
        expect(await cell.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
        const bounds = await board.boundingBox()
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        if (mode !== 'auction') {
          await expect(board.getByTestId('draft-board-cell-15')).toHaveAttribute('data-current', 'true')
          await expect(board.getByTestId('draft-board-round-2-direction')).toHaveAttribute('data-direction', mode === 'linear' ? 'forward' : 'reverse')
        }
      }
      if (mode === 'mock') {
        await page.getByTestId('coverage-NFL').screenshot({ path: test.info().outputPath(`mock-nfl-${width}.png`) })
        if (width === 1580) await page.getByTestId('coverage-NBA').screenshot({ path: test.info().outputPath('mock-nba-desktop.png') })
      }
    }
  }
  const dock = page.getByTestId('coverage-narrow-dock')
  await dock.scrollIntoViewIfNeeded()
  const search = dock.getByTestId('draft-queue-search')
  const sort = dock.getByTestId('draft-queue-sort')
  expect((await search.boundingBox())!.width).toBeGreaterThan(120)
  expect((await sort.boundingBox())!.width).toBeGreaterThan(120)
  const tabs = dock.getByRole('tablist')
  expect(await tabs.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await tabs.getByRole('tab', { name: /Queue/ }).focus()
  await page.keyboard.press('End')
  await expect(tabs.getByRole('tab', { name: 'Activity', exact: true })).toBeFocused()
  await expect(tabs.getByRole('tab', { name: 'Activity', exact: true })).toBeInViewport()
  await page.keyboard.press('Home')
  await expect(search).toBeVisible()

  // Below 1280px the dock is the center tab bar (~300px at a 768 screen, ~400 at 1024). It used to be
  // an equal-width grid whose labels wrapped and overflowed; every label must stay whole on one line.
  for (const width of [240, 300, 400]) {
    const bar = page.getByTestId(`coverage-mid-dock-${width}`).getByTestId('draft-bottom-dock-tabbar')
    await bar.scrollIntoViewIfNeeded()
    const tabsAt = await bar.evaluate(el => [...el.querySelectorAll('button')].map(b => ({
      label: b.textContent, overflow: b.scrollWidth - b.clientWidth, height: b.getBoundingClientRect().height,
    })))
    expect(tabsAt.map(t => t.label)).toEqual(['Queue', 'Intel', 'Chat', 'AF Legacy', 'Commish Edit'])
    for (const t of tabsAt) {
      expect(t.overflow, `${width}px ${t.label}`).toBeLessThanOrEqual(0)
      expect(t.height, `${width}px ${t.label}`).toBeLessThan(40)
    }
    if (width === 400) expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await bar.getByRole('tab', { name: 'Commish Edit' }).click()
    await expect(bar.getByRole('tab', { name: 'Commish Edit' })).toHaveAttribute('aria-selected', 'true')
  }
})
