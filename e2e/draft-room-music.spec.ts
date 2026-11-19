import { expect, test, type Page } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

/*
 * The draft room's music bar (2026-11-17) in a real browser, against a stand-in music engine that records what it
 * was asked to do. The commissioner's playlist (set only with AF Commissioner / AF Supreme) plays by itself for
 * members — at once if they have tapped the page, else on their first tap — never replaces their own music, stays
 * off once they stop it, and stops when the draft finishes. Playwright starts every page untapped, like a fresh load.
 */

test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
  /*
   * ⚠ Playwright's Chromium reports every page as already tapped (navigator.userActivation.hasBeenActive is true
   * straight after goto — measured), so a fresh, untapped visit cannot happen here on its own. This puts the browser's
   * real rule back: untapped until a click or a key, and untapped again after a reload.
   */
  await context.addInitScript(() => {
    let tapped = false
    const mark = () => {
      tapped = true
    }
    document.addEventListener('click', mark, true)
    document.addEventListener('keydown', mark, true)
    Object.defineProperty(Navigator.prototype, 'userActivation', {
      configurable: true,
      get: () => ({ get hasBeenActive() { return tapped }, get isActive() { return false } }),
    })
  })
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
  test(`${viewport.name}: the commissioner's playlist starts on a member's first tap, and ends with the draft`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: GAME_DAY, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Draft playlist: Game day hype')
    // A fresh page has not been tapped, so the browser allows no sound yet: it waits, and says so.
    await expect(bar.getByTestId('draft-room-music-sub')).toHaveText('Picked by your commissioner. It starts when you tap anywhere in the room.')
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-member-offered.png`), fullPage: true })

    // Any tap in the room starts it — here on the board, not on a music button.
    await page.getByTestId('harness-board').click()
    await expect(bar.getByTestId('draft-room-music-sub')).toHaveText('Playing Game day hype · draft playlist. Only you hear it.')
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveCount(1)
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

    // At every width: in the music row, laid exactly over its 200×200 slot, and above the board rather than on it.
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // Stop and More: stacked beside the slot on a phone, side by side where there is room.
    const stop = await bar.getByTestId('draft-room-music-stop').boundingBox()
    const more = await bar.getByTestId('draft-room-music-more').boundingBox()
    expect(stop && more).toBeTruthy()
    if (viewport.name === 'phone') expect(more!.y).toBeGreaterThan(stop!.y + stop!.height - 1)
    else expect(Math.abs(more!.y - stop!.y)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-player-placed.png`), fullPage: false })

    await bar.getByTestId('draft-room-music-stop').click()
    await expect(player).toHaveCount(0)
    await expect(bar.getByTestId('draft-room-music-slot')).toHaveCount(0)
  })

  test(`${viewport.name}: a commissioner's change reaches a member already playing the playlist`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: GAME_DAY, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    const log = page.getByTestId('music-engine-log').locator('li')
    // Tapping Play is also the first tap: it must start the playlist once, not twice.
    await bar.getByTestId('draft-room-music-play-playlist').click()
    await expect(log).toHaveText(['play draft-playlist:game-day — Game day hype · draft playlist'])

    await page.getByTestId('harness-live-change').click()
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Draft playlist: Football podcast')
    await expect(bar.getByTestId('draft-room-music-note')).toHaveText('The draft playlist is now Football podcast.')
    await expect(log).toHaveText([
      'play draft-playlist:game-day — Game day hype · draft playlist',
      'play draft-playlist:ff-podcast — Football podcast · draft playlist',
    ])
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-live-switched.png`), fullPage: false })

    await page.getByTestId('harness-live-remove').click()
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Music for the draft')
    await expect(bar.getByTestId('draft-room-music-note')).toHaveText('The draft playlist was turned off.')
    await expect(log).toHaveCount(3)
    await expect(log.nth(2)).toHaveText('stop')
  })

  test(`${viewport.name}: a playlist set while a member who has tapped sits in a quiet room starts at once`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: null, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    const log = page.getByTestId('music-engine-log').locator('li')
    await page.getByTestId('harness-board').click()
    await expect(log).toHaveCount(0)

    await page.getByTestId('harness-live-change').click()
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Draft playlist: Football podcast')
    await expect(log).toHaveText(['play draft-playlist:ff-podcast — Football podcast · draft playlist'])
  })

  test(`${viewport.name}: 🛑 the playlist never replaces music a member chose`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: null, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    const log = page.getByTestId('music-engine-log').locator('li')

    await bar.getByTestId('draft-room-music-more').click()
    await bar.locator('#draft-room-music-station').selectOption('game-day')
    await bar.getByTestId('draft-room-music-play-pick').click()
    await page.getByTestId('harness-live-change').click()
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Draft playlist: Football podcast')
    await page.getByTestId('harness-board').click()
    await expect(log).toHaveText(['play game-day — Game day hype'])
    await page.getByTestId('harness-live-remove').click()
    await expect(bar.getByTestId('draft-room-music-title')).toHaveText('Music for the draft')
    await expect(log).toHaveText(['play game-day — Game day hype'])
    await expect(bar.getByTestId('draft-room-music-stop')).toBeVisible()
  })

  test(`${viewport.name}: 🛑 once a member stops it, it stays stopped — across a reload — until they tap Play`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubPlaylist(page, { playlist: GAME_DAY, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    const log = page.getByTestId('music-engine-log').locator('li')
    const stopped = 'Picked by your commissioner. You stopped it — tap Play to turn it back on.'

    await page.getByTestId('harness-board').click()
    await expect(log).toHaveCount(1)
    await bar.getByTestId('draft-room-music-stop').click()
    await expect(bar.getByTestId('draft-room-music-sub')).toHaveText(stopped)
    await page.getByTestId('harness-board').click()
    await expect(log).toHaveText(['play draft-playlist:game-day — Game day hype · draft playlist', 'stop'])
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-stopped.png`), fullPage: false })

    await page.reload()
    await expect(bar.getByTestId('draft-room-music-sub')).toHaveText(stopped)
    await page.getByTestId('harness-board').click()
    await expect(log).toHaveCount(0)

    await bar.getByTestId('draft-room-music-play-playlist').click()
    await expect(log).toHaveText(['play draft-playlist:game-day — Game day hype · draft playlist'])
    await page.reload()
    await expect(bar.getByTestId('draft-room-music-sub')).toHaveText('Picked by your commissioner. It starts when you tap anywhere in the room.')
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
    // The commissioner is a member too, and has tapped: their own room starts it straight away.
    await expect(page.getByTestId('music-engine-log').locator('li')).toHaveText(['play draft-playlist:game-day — Game day hype · draft playlist'])
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

test.describe('on an iPhone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  })

  test('the playing line says to tap the video if there is no sound', async ({ page }, testInfo) => {
    await stubPlaylist(page, { playlist: GAME_DAY, isCommissioner: false, canSet: false, planRequired: false })
    await page.goto('/e2e/draft-room-music')
    const bar = page.getByTestId('draft-room-music')
    await page.getByTestId('harness-board').click()
    // iOS can hold back the sound until the person taps the player itself, and the page cannot tell — so it says so.
    await expect(bar.getByTestId('draft-room-music-sub')).toHaveText('Playing Game day hype · draft playlist. No sound? Tap the video once.')
    await page.screenshot({ path: testInfo.outputPath('iphone-hint.png'), fullPage: false })
  })
})
