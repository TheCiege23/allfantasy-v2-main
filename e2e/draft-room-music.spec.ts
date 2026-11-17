import { expect, test, type Page } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

/*
 * The draft room's music bar (2026-11-17) in a real browser, against a stand-in music engine that records what it
 * was asked to do. Nothing plays before a tap; the commissioner's playlist is offered to members, set only with
 * AF Commissioner / AF Supreme, and stops when the draft finishes.
 */

test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

const GAME_DAY = { stationId: 'game-day', label: 'Game day hype', channel: 'Stadium anthems' }

async function stubPlaylist(page: Page, info: Record<string, unknown>) {
  const puts: unknown[] = []
  await page.route('**/api/leagues/e2e-league/draft/playlist', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { stationId: string | null }
      puts.push(body)
      return route.fulfill({ json: { playlist: body.stationId === 'game-day' ? GAME_DAY : null } })
    }
    return route.fulfill({ json: info })
  })
  return puts
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`${viewport.name}: a member is offered the commissioner's playlist, one tap, and it ends with the draft`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: GAME_DAY, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Draft playlist: Game day hype')
    await bar.getByTestId('draft-room-music-more').click()
    await expect(bar.locator('#draft-room-music-station')).toBeVisible()
    await expect(bar.getByTestId('draft-room-music-editor')).toHaveCount(0)
    await expect(bar.getByTestId('draft-room-music-locked')).toHaveCount(0)
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-member-offered.png`), fullPage: true })

    await bar.getByTestId('draft-room-music-play-playlist').click()
    await expect(bar.getByTestId('draft-room-music-sub')).toHaveText('Playing Game day hype · draft playlist. Only you hear it.')
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-member-playing.png`), fullPage: true })
    await page.getByTestId('harness-complete').click()
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveText([
      'play draft-playlist:game-day — Game day hype · draft playlist',
      'stop',
    ])
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Music for the draft')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test(`${viewport.name}: the player never sits over the board`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: null, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    await bar.getByTestId('draft-room-music-play-station').click()
    const player = page.getByTestId('stand-in-player')
    await expect(player).toBeVisible()

    if (viewport.name === 'phone') {
      // In the music row, laid exactly over its 200×200 slot, and above the board rather than on it.
      await expect(player).toHaveAttribute('data-where', 'slot')
      const slot = await bar.getByTestId('draft-room-music-slot').boundingBox()
      const box = await player.boundingBox()
      const board = await page.getByTestId('harness-board').boundingBox()
      expect(slot && box && board).toBeTruthy()
      expect(Math.abs(box!.x - slot!.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(box!.y - slot!.y)).toBeLessThanOrEqual(1)
      expect(box!.width).toBeGreaterThanOrEqual(200)
      expect(box!.height).toBeGreaterThanOrEqual(200)
      expect(box!.y + box!.height).toBeLessThanOrEqual(board!.y)
      await expect(bar.getByTestId('draft-room-music-stop')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    } else {
      // Wide screens keep the corner box; the row stays one line.
      await expect(player).toHaveAttribute('data-where', 'corner')
      await expect(bar.getByTestId('draft-room-music-slot')).toHaveCount(0)
    }
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-player-placed.png`), fullPage: false })

    await bar.getByTestId('draft-room-music-stop').click()
    await expect(player).toHaveCount(0)
    await expect(bar.getByTestId('draft-room-music-slot')).toHaveCount(0)
  })

  test(`${viewport.name}: music a member chose keeps playing when the draft finishes`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: null, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Music for the draft')
    await bar.getByTestId('draft-room-music-more').click()
    await bar.locator('#draft-room-music-station').selectOption('ff-podcast')
    await bar.getByTestId('draft-room-music-play-pick').click()
    await page.getByTestId('harness-complete').click()
    await expect(page.getByTestId('harness-status')).toHaveText('completed')
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveText(['play ff-podcast — Football podcast'])
  })

  test(`${viewport.name}: a paying commissioner sets the playlist; one without the plan is told which plans have it`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const puts = await stubPlaylist(page, { playlist: null, isCommissioner: true, canSet: true, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    await bar.getByTestId('draft-room-music-more').click()
    await bar.locator('#draft-room-music-playlist').selectOption('game-day')
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-commissioner-editor.png`), fullPage: true })
    await bar.getByTestId('draft-room-music-save').click()
    await expect(bar.getByTestId('draft-room-music-note')).toHaveText('Draft playlist set to Game day hype.')
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Draft playlist: Game day hype')
    expect(puts).toEqual([{ stationId: 'game-day' }])
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-commissioner-saved.png`), fullPage: true })

    await page.unrouteAll()
    await stubPlaylist(page, { playlist: null, isCommissioner: true, canSet: false, planRequired: true })
    await page.reload()
    await bar.getByTestId('draft-room-music-more').click()
    await expect(bar.getByTestId('draft-room-music-locked')).toContainText('A draft playlist for the whole room comes with AF Commissioner or AF Supreme.')
    await expect(bar.getByTestId('draft-room-music-save')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-commissioner-locked.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
