import { expect, test, type Page, type Request } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

/*
 * Chimmy in the LEAGUE mock room (/draft/mock/[id]) — stage 4 of drafts (2026-11-16). A typed question
 * goes to Chimmy with the room's session (the server reads the board itself), and a queue change Chimmy
 * proposes changes the room's queue ONLY when Confirm is tapped, then is saved. Every draft API is stubbed.
 */

test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

const PLAYERS = Array.from({ length: 16 }, (_, i) => ({
  id: `s${i + 1}`,
  name: `Player ${String.fromCharCode(65 + i)}${i + 1}`,
  position: ['QB', 'RB', 'WR', 'TE'][i % 4]!,
  team: 'BUF',
  adp: i + 1,
  proj: null,
  bye: null,
  keyStat: '',
}))

const STATE = {
  id: 'mock:e2e-room',
  mode: 'mock',
  status: 'active',
  currentPick: 3,
  currentRound: 1,
  currentTeamIndex: 2,
  timerEndsAt: null,
  timerPaused: true,
  pickOrder: [
    { id: 'cpu-1', label: 'CPU 1', isCpu: true },
    { id: 'e2e-viewer', label: 'E2E Viewer', isCpu: false },
    { id: 'cpu-2', label: 'CPU 3', isCpu: true },
    { id: 'cpu-3', label: 'CPU 4', isCpu: true },
  ],
  leagueId: null,
  roomId: 'e2e-room',
  numTeams: 4,
  numRounds: 4,
  timerSeconds: 60,
  updatedAt: '2026-11-16T20:00:00.000Z',
}
const PICKS = [
  { id: 'k1', round: 1, pickNumber: 1, overallPick: 1, originalOwnerId: 'cpu-1', currentOwnerId: 'cpu-1', playerId: 's1', playerName: 'Player A1', position: 'QB', team: 'BUF', isTraded: false, autopicked: true, timestamp: '' },
  { id: 'k2', round: 1, pickNumber: 2, overallPick: 2, originalOwnerId: 'e2e-viewer', currentOwnerId: 'e2e-viewer', playerId: 's2', playerName: 'Player B2', position: 'RB', team: 'BUF', isTraded: false, autopicked: false, timestamp: '' },
]

/** A field out of the multipart body the room posts. */
function field(request: Request, name: string): string | null {
  const m = (request.postData() ?? '').match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`))
  return m ? m[1]! : null
}

async function openRoom(page: Page, extraMeta: Record<string, unknown> = {}, opts: { queueDelayMs?: number; tab?: 'ai' | 'queue' } = {}) {
  const asked: Array<{ source: string | null; session: string | null; queue: string[] }> = []
  const saved: string[][] = []
  await page.route('**/api/draft/**', (route) => route.fulfill({ json: {} }))
  await page.route('**/api/draft/room/state**', (route) => route.fulfill({ json: { state: STATE, picks: PICKS } }))
  await page.route('**/api/draft/queue/get**', async (route) => {
    if (opts.queueDelayMs) await new Promise((resolve) => setTimeout(resolve, opts.queueDelayMs))
    await route.fulfill({ json: { playerIds: ['s9'] } })
  })
  await page.route('**/api/draft/players**', (route) => route.fulfill({ json: { players: PLAYERS } }))
  await page.route('**/api/draft/chat/history**', (route) => route.fulfill({ json: { messages: [] } }))
  await page.route('**/api/draft/queue/update', async (route) => {
    saved.push((JSON.parse(route.request().postData() ?? '{}') as { playerIds: string[] }).playerIds)
    await route.fulfill({ json: { success: true } })
  })
  await page.route('**/api/chat/chimmy', async (route) => {
    const r = route.request()
    asked.push({ source: field(r, 'source'), session: field(r, 'mockSessionId'), queue: JSON.parse(field(r, 'mockQueueIds') ?? '[]') })
    await route.fulfill({
      json: {
        response: 'Queue Player L12 at the top — he will not last to your next pick.',
        meta: {
          mockQueueProposals: [
            { id: `card-${asked.length}`, add: [{ id: 's12', name: 'Player L12', position: 'TE', team: 'BUF' }], addAt: 'top', remove: [], baseQueueIds: ['s9'], resultingTop: ['Player L12', 'Player I9'] },
          ],
          ...extraMeta,
        },
      },
    })
  })
  await page.goto('/e2e/league-mock-room')
  await expect(page.getByTestId('draft-right-panel')).toBeVisible()
  if (opts.tab !== 'queue') await page.getByTestId('draft-right-tab-ai').click()
  return { asked, saved }
}

async function ask(page: Page, text: string) {
  await page.getByTestId('chimmy-input').fill(text)
  await page.getByTestId('chimmy-input').press('Enter')
}

test.describe('@mock-draft-room Chimmy in the league mock room', () => {
  test('desktop: asks with the room session; Confirm changes and saves the queue; an outdated card is refused', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const { asked, saved } = await openRoom(page)
    await ask(page, 'Who should I queue?')
    const card = page.getByTestId('mock-draft-queue-card').last()
    await expect(card).toContainText('Add to the top: Player L12 (TE)')
    await expect(card).toContainText('Nothing changes until you tap Confirm')
    expect(asked[0]).toEqual({ source: 'mock-draft-room', session: 'mock:e2e-room', queue: ['s9'] })
    // Nothing is saved before Confirm, and the queue just loaded is not saved back.
    expect(saved).toEqual([])
    await expect(card.getByTestId('mock-draft-queue-confirm')).toBeInViewport()
    await page.getByTestId('draft-right-panel').screenshot({ path: testInfo.outputPath('desktop-league-mock-card.png') })

    await card.getByTestId('mock-draft-queue-confirm').click()
    await expect(card.getByTestId('mock-draft-queue-card-state')).toContainText('Done — your queue is updated.')
    await expect.poll(() => saved.at(-1)).toEqual(['s12', 's9'])
    await page.getByTestId('draft-right-panel').screenshot({ path: testInfo.outputPath('desktop-league-mock-confirmed.png') })

    // The next question sends the new queue; a card built against the old one is refused.
    await ask(page, 'Anything else?')
    await expect(page.getByTestId('mock-draft-queue-card')).toHaveCount(2)
    expect(asked[1]!.queue).toEqual(['s12', 's9'])
    const second = page.getByTestId('mock-draft-queue-card').last()
    await second.getByTestId('mock-draft-queue-confirm').click()
    await expect(second.getByTestId('mock-draft-queue-card-state')).toContainText('Your queue changed after this card was made')
    expect(saved.at(-1)).toEqual(['s12', 's9'])

    await page.getByTestId('draft-right-tab-queue').click()
    await expect(page.getByTestId('draft-right-tab-content-queue')).toContainText('Player L12')
    await page.getByTestId('draft-right-panel').screenshot({ path: testInfo.outputPath('desktop-league-mock-queue.png') })
  })

  test('Dismiss changes nothing; a free user sees the AF Pro line', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const { saved } = await openRoom(page, { proUpsell: ['get_draft_pick_outlook'] })
    await ask(page, 'Will Player L12 make it back to me?')
    const card = page.getByTestId('mock-draft-queue-card').last()
    await expect(card).toBeVisible()
    await expect(page.getByTestId('mock-draft-pro-upsell')).toContainText("AF Pro adds who's likely gone before your pick.")
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('phone-league-mock-card.png') })
    await card.getByTestId('mock-draft-queue-dismiss').click()
    await expect(card.getByTestId('mock-draft-queue-card-state')).toContainText('Dismissed')
    // Nothing is saved before Confirm, and the queue just loaded is not saved back.
    expect(saved).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})

test.describe('@mock-draft-room the league mock room saves its queue', () => {
  test('a player queued from the list while another tab is open is saved', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const { saved } = await openRoom(page)
    await expect(page.getByTestId('chimmy-draft-chat')).toBeVisible()
    await page.getByRole('row', { name: /Player E5/ }).getByRole('button', { name: '+Q' }).click()
    await expect.poll(() => saved.at(-1)).toEqual(['s9', 's5'])
    await page.getByTestId('draft-right-tab-queue').click()
    await expect(page.getByTestId('draft-right-tab-content-queue')).toContainText('Player E5')
  })

  test('a slow saved queue is never overwritten with an empty one', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const { saved } = await openRoom(page, {}, { queueDelayMs: 2500, tab: 'queue' })
    await expect(page.getByTestId('draft-right-tab-content-queue')).toContainText('Player I9', { timeout: 15_000 })
    // Well past the half-second save: the empty starting list was never sent, and the loaded one is not sent back.
    await page.waitForTimeout(1500)
    expect(saved).toEqual([])
  })
})
