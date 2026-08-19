import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 })

const HARNESS_PATH = '/e2e/g42-nfl-redraft-communication'

type NotificationRow = {
  id: string
  type: string
  title: string
  body: string | null
  product: string
  severity: string
  read: boolean
  createdAt: string
  meta: Record<string, unknown>
}

type FeedRow = {
  id: string
  type: string
  message: string
  title: string
  createdAt: string
}

type ChatRow = {
  id: string
  body: string
  senderName: string
  createdAt: string
}

async function routeCommunicationApis(page: Page) {
  let notifications: NotificationRow[] = [
    {
      id: 'g42-draft-started',
      type: 'draft_started',
      title: 'Draft started',
      body: 'The Guap Bowl draft is live.',
      product: 'app',
      severity: 'high',
      read: false,
      createdAt: '2026-07-02T12:00:00.000Z',
      meta: { leagueId: 'g42-browser-league', sport: 'NFL' },
    },
    {
      id: 'g42-waivers',
      type: 'waiver_processed',
      title: 'Waivers processed',
      body: 'Waivers processed for Week 4: 3 succeeded, 1 failed.',
      product: 'app',
      severity: 'medium',
      read: false,
      createdAt: '2026-07-02T12:05:00.000Z',
      meta: { leagueId: 'g42-browser-league', sport: 'NFL' },
    },
  ]
  const feedItems: FeedRow[] = [
    {
      id: 'feed-waivers',
      type: 'waiver_processed',
      title: 'Waivers processed',
      message: 'Waivers processed for Week 4: 3 succeeded, 1 failed.',
      createdAt: '2026-07-02T12:05:00.000Z',
    },
  ]
  const systemMessages: ChatRow[] = [
    {
      id: 'chat-system-waivers',
      body: 'Waivers processed for Week 4: 3 succeeded, 1 failed.',
      senderName: 'AllFantasy',
      createdAt: '2026-07-02T12:05:00.000Z',
    },
  ]

  await page.route('**/api/shared/notifications?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ notifications }),
    })
  })

  await page.route('**/api/shared/notifications/read-all?**', async (route) => {
    notifications = notifications.map((notification) => ({ ...notification, read: true }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route('**/api/redraft/communication/feed?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: feedItems, systemMessages }),
    })
  })

  await page.route('**/api/redraft/communication/announcements', async (route) => {
    const payload = route.request().postDataJSON() as { body?: string }
    systemMessages.unshift({
      id: `chat-announcement-${systemMessages.length}`,
      body: payload.body ?? 'Commissioner announcement',
      senderName: 'Commissioner',
      createdAt: '2026-07-02T12:10:00.000Z',
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.route('**/api/redraft/communication/chat', async (route) => {
    const payload = route.request().postDataJSON() as { body?: string }
    systemMessages.unshift({
      id: `chat-user-${systemMessages.length}`,
      body: payload.body ?? 'League chat message',
      senderName: 'Manager',
      createdAt: '2026-07-02T12:12:00.000Z',
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: systemMessages[0] }),
    })
  })
}

async function gotoHarness(page: Page) {
  await routeCommunicationApis(page)
  await page.goto(HARNESS_PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('g42-browser-harness').waitFor({ state: 'visible', timeout: 120_000 })
}

test.describe('@g42 @nfl-redraft communication browser proof', () => {
  test('loads notifications, marks unread rows read, posts announcements, and mirrors chat feed', async ({ page }) => {
    await gotoHarness(page)

    await expect(page.getByTestId('g42-communication-panel')).toBeVisible()
    await expect(page.getByTestId('g42-unread-badge')).toContainText('2 unread')
    await expect(page.getByTestId('g42-notification-row').first()).toContainText('Draft started')
    await expect(page.getByTestId('g42-chat-system-message').first()).toContainText('Waivers processed')

    await page.getByTestId('g42-mark-all-read').click()
    await expect(page.getByTestId('g42-unread-badge')).toHaveCount(0)

    await page.getByTestId('g42-announcement-input').fill('Lineups lock at 1 PM ET.')
    await page.getByTestId('g42-announcement-send').click()
    await expect(page.getByTestId('g42-chat-system-message').first()).toContainText('Lineups lock at 1 PM ET.')

    await page.getByTestId('g42-chat-input').fill('Good luck this week.')
    await page.getByTestId('g42-chat-send').click()
    await expect(page.getByTestId('g42-chat-system-message').first()).toContainText('Good luck this week.')

    await page.getByRole('button', { name: 'Open' }).click()
    await expect(page.getByTestId('g42-active-tab')).toContainText('league_chat')
  })

  test('keeps the communication panel usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHarness(page)

    await expect(page.getByTestId('g42-mobile-layout')).toBeVisible()
    await expect(page.getByTestId('g42-unread-badge')).toContainText('2 unread')
    await expect(page.getByTestId('g42-announcement-input')).toBeVisible()
    await expect(page.getByTestId('g42-chat-input')).toBeVisible()

    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)
    expect(noHorizontalOverflow).toBeTruthy()
  })
})
