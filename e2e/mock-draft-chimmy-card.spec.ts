import { expect, test, type Page, type Request } from '@playwright/test'
import { answerCspReportsInBrowser } from './helpers/csp-report-sink'

/*
 * Chimmy in the /mock-draft room — stage 3 of drafts (2026-11-16). The room sends its board with every
 * question, and a queue change Chimmy proposes is applied to the room's queue ONLY when Confirm is
 * tapped. Chimmy is stubbed; the board the room actually posts is read back from the request.
 */

test.beforeEach(async ({ context }) => {
  await answerCspReportsInBrowser(context)
})

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima']

/** The `mockDraftBoard` field out of the multipart body the room posts. */
function postedBoard(request: Request): { queue: Array<{ id: string }>; available: Array<{ id: string; name: string }>; userSlot: number } | null {
  const body = request.postData() ?? ''
  const m = body.match(/name="mockDraftBoard"\r\n\r\n([\s\S]*?)\r\n--/)
  return m ? JSON.parse(m[1]!) : null
}

async function openRoom(page: Page, meta: (board: NonNullable<ReturnType<typeof postedBoard>>) => Record<string, unknown>) {
  const boards: Array<NonNullable<ReturnType<typeof postedBoard>>> = []
  await page.route('**/api/league/list', (route) => route.fulfill({ json: { leagues: [] } }))
  await page.route('**/api/mock-draft/adp?**', (route) =>
    route.fulfill({
      json: { entries: NAMES.map((name, index) => ({ playerId: name, name, position: index % 2 ? 'SG' : 'PG', team: 'LAL', adp: index + 1, value: 100 })) },
    }),
  )
  await page.route('**/api/chat/chimmy', async (route) => {
    const board = postedBoard(route.request())
    if (!board) return route.fulfill({ status: 400, json: { error: 'no board' } })
    boards.push(board)
    await route.fulfill({ json: { response: 'Queue Charlie at the top — he will not make it back to you.', meta: meta(board) } })
  })
  await page.goto('/e2e/mock-draft-production')
  await page.getByTestId('mock-draft-entry-open').click()
  await page.getByTestId('mock-draft-open-sport-NBA').click()
  await page.getByTestId('mock-draft-open-teams-8').click()
  await page.getByTestId('mock-draft-open-speed-30').click()
  await page.getByTestId('mock-draft-open-start').click()
  await expect(page.getByTestId('mock-draft-current-pick')).toContainText('Pick #1')
  await page.getByTestId('mock-draft-pause').click()
  return boards
}

const proposalFor = (board: NonNullable<ReturnType<typeof postedBoard>>) => ({
  mockQueueProposals: [
    {
      id: 'card-1',
      add: [{ id: 'Charlie', name: 'Charlie', position: 'PG', team: 'LAL' }],
      addAt: 'top',
      remove: [],
      baseQueueIds: board.queue.map((p) => p.id),
      resultingTop: ['Charlie', ...board.queue.map((p) => board.available.find((a) => a.id === p.id)?.name ?? p.id)],
    },
  ],
})

test.describe('@mock-draft-room Chimmy queue card', () => {
  test('desktop: the board rides with the question; Confirm changes the queue, Dismiss does not', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const boards = await openRoom(page, proposalFor)
    await page.getByRole('button', { name: 'Queue Bravo', exact: true }).first().click()

    await page.getByTestId('mock-draft-chat-input').fill('Queue Charlie at the top')
    await page.getByTestId('mock-draft-chat-send').click()
    const card = page.getByTestId('mock-draft-queue-card').last()
    await expect(card).toContainText('Add to the top: Charlie (PG)')
    await expect(card).toContainText('Nothing changes until you tap Confirm')

    expect(boards[0]!.queue.map((p) => p.id)).toEqual(['Bravo'])
    expect(boards[0]!.available.length).toBeGreaterThan(0)
    // Nothing changed before Confirm.
    let state = await page.evaluate(() => JSON.parse(localStorage.getItem('af:mock-draft:v1:e2e-mobile-viewer:open') ?? '{}'))
    expect(state.queue).toEqual(['Bravo'])
    // The chat follows the newest message: Confirm is in view without scrolling the chat log by hand.
    await page.getByTestId('mock-draft-chat-input').scrollIntoViewIfNeeded()
    await expect(card.getByTestId('mock-draft-queue-confirm')).toBeInViewport()
    const column = page.locator('[data-mock-chat-log]').locator('xpath=../..')
    await column.screenshot({ path: testInfo.outputPath('desktop-queue-card.png') })
    await page.screenshot({ path: testInfo.outputPath('desktop-room.png') })

    await card.getByTestId('mock-draft-queue-confirm').click()
    await expect(card.getByTestId('mock-draft-queue-card-state')).toContainText('Done — your queue is updated.')
    await expect.poll(async () => {
      state = await page.evaluate(() => JSON.parse(localStorage.getItem('af:mock-draft:v1:e2e-mobile-viewer:open') ?? '{}'))
      return state.queue
    }).toEqual(['Charlie', 'Bravo'])
    await column.screenshot({ path: testInfo.outputPath('desktop-queue-card-confirmed.png') })

    // A second card, then Dismiss: the queue stays as it is.
    await page.getByTestId('mock-draft-chat-input').fill('again')
    await page.getByTestId('mock-draft-chat-send').click()
    const second = page.getByTestId('mock-draft-queue-card').last()
    await second.getByTestId('mock-draft-queue-dismiss').click()
    await expect(second.getByTestId('mock-draft-queue-card-state')).toContainText('Dismissed')
    state = await page.evaluate(() => JSON.parse(localStorage.getItem('af:mock-draft:v1:e2e-mobile-viewer:open') ?? '{}'))
    expect(state.queue).toEqual(['Charlie', 'Bravo'])
  })

  test('a card made against an older queue is refused, not applied', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openRoom(page, proposalFor)
    await page.getByTestId('mock-draft-chat-input').fill('Queue Charlie')
    await page.getByTestId('mock-draft-chat-send').click()
    const card = page.getByTestId('mock-draft-queue-card').last()
    await expect(card).toBeVisible()
    await page.getByRole('button', { name: 'Queue Delta', exact: true }).first().click()
    await card.getByTestId('mock-draft-queue-confirm').click()
    await expect(card.getByTestId('mock-draft-queue-card-state')).toContainText('Your queue changed after this card was made')
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('af:mock-draft:v1:e2e-mobile-viewer:open') ?? '{}'))
    expect(state.queue).toEqual(['Delta'])
  })

  test('phone: the card and the AF Pro line in the Chat tray', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openRoom(page, (board) => ({ ...proposalFor(board), proUpsell: ['get_draft_pick_outlook'] }))
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Draft Chat', exact: true })
    await panel.getByTestId('mock-draft-chat-input').fill('Will Charlie make it back to me?')
    await panel.getByTestId('mock-draft-chat-send').click()
    await expect(panel.getByTestId('mock-draft-queue-card')).toBeVisible()
    await expect(panel.getByTestId('mock-draft-pro-upsell')).toContainText("AF Pro adds who's likely gone before your pick.")
    // The Chat tab is the chat alone now (Roster has its own tab), and Confirm is in view.
    await expect(panel.getByText('Your Roster', { exact: true })).toHaveCount(0)
    await expect(panel.getByTestId('mock-draft-queue-confirm')).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('phone-queue-card.png') })
    await panel.getByTestId('mock-draft-queue-confirm').click()
    await expect(panel.getByTestId('mock-draft-queue-card-state')).toContainText('Done — your queue is updated.')
    await page.screenshot({ path: testInfo.outputPath('phone-queue-card-confirmed.png') })
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Roster', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Current Roster', exact: true }).getByTestId('mock-draft-chat-input')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})
