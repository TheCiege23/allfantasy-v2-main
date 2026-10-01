import { expect, test, type Page, type Route } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

test.describe.configure({ timeout: 180_000 })

async function fulfillInviteStats(route: Route, fetchCount: number) {
  const statsByFetch = [
    {
      ok: true,
      stats: {
        totalCreated: 1,
        totalAccepted: 1,
        totalViews: 3,
        totalShares: 0,
        activeLinks: 1,
        expiredLinks: 0,
        revokedLinks: 0,
        maxUsedLinks: 0,
        conversionRate: 0.333,
        byType: { league: 1 },
        byChannel: {},
        recentEvents: [],
        topInvites: [],
        referredSignups: 1,
      },
    },
    {
      ok: true,
      stats: {
        totalCreated: 2,
        totalAccepted: 1,
        totalViews: 3,
        totalShares: 0,
        activeLinks: 2,
        expiredLinks: 0,
        revokedLinks: 0,
        maxUsedLinks: 0,
        conversionRate: 0.333,
        byType: { league: 2 },
        byChannel: {},
        recentEvents: [],
        topInvites: [],
        referredSignups: 1,
      },
    },
    {
      ok: true,
      stats: {
        totalCreated: 2,
        totalAccepted: 1,
        totalViews: 4,
        totalShares: 1,
        activeLinks: 2,
        expiredLinks: 0,
        revokedLinks: 0,
        maxUsedLinks: 0,
        conversionRate: 0.25,
        byType: { league: 2 },
        byChannel: { copy_link: 1 },
        recentEvents: [
          {
            eventType: 'shared',
            channel: 'copy_link',
            type: 'league',
            createdAt: '2026-03-27T12:00:00.000Z',
          },
        ],
        topInvites: [
          {
            inviteLinkId: 'invite-created',
            token: 'VALID142',
            type: 'league',
            inviteUrl: 'http://127.0.0.1:3000/invite/accept?code=VALID142',
            destinationHref: '/leagues/league-a',
            viewCount: 4,
            shareCount: 1,
            acceptedCount: 1,
            conversionRate: 0.25,
          },
        ],
        referredSignups: 1,
      },
    },
  ]

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(statsByFetch[Math.min(fetchCount, statsByFetch.length - 1)]),
  })
}

async function mockAuthSession(page: Page) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'user-e2e',
          name: 'Invite Auditor',
          email: 'auditor@example.com',
        },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    })
  })
}

async function expectReferralMetric(
  page: Page,
  options: { testId: string; label: string; expectedValue: string }
) {
  const { testId, label, expectedValue } = options
  const metricByTestId = page.getByTestId(testId)

  try {
    await expect(metricByTestId).toHaveText(expectedValue, { timeout: 8_000 })
    return
  } catch {
    const metricCard = page.locator('div').filter({ hasText: label }).first()
    await expect(metricCard).toBeVisible({ timeout: 8_000 })
    await expect(metricCard).toContainText(expectedValue)
  }
}

async function gotoInviteAcceptAndWait(page: Page, code: string, heading: RegExp | string) {
  const headingLocator = page.getByRole('heading', { name: heading })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/invite/accept?code=${code}`, { waitUntil: 'domcontentloaded' })
    if (await headingLocator.isVisible().catch(() => false)) return
    await page.waitForTimeout(300 * (attempt + 1))
  }
  await expect(headingLocator).toBeVisible({ timeout: 15_000 })
}

test.describe('@growth viral invite engine click audit', () => {
  test('generate, copy, share actions, preview link, and referral stat refresh are wired', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    let statsFetchCount = 0
    const shareChannels: string[] = []

    await mockAuthSession(page)

    await page.route('**/api/referral/link', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          code: 'REF142',
          link: 'http://127.0.0.1:3000/?ref=REF142',
        }),
      })
    })

    await page.route('**/api/referral/referred', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          referred: [
            {
              referredUserId: 'referred-1',
              displayName: 'League Friend',
              createdAt: '2026-03-27T10:00:00.000Z',
            },
          ],
        }),
      })
    })

    await page.route('**/api/invite/stats', async (route) => {
      await fulfillInviteStats(route, statsFetchCount)
      statsFetchCount += 1
    })

    await page.route('**/api/invite/list**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          links: [
            {
              id: 'existing-invite',
              type: 'league',
              token: 'PREVIEW142',
              targetId: 'league-a',
              status: 'active',
              useCount: 1,
              maxUses: 0,
              expiresAt: '2026-04-01T12:00:00.000Z',
              createdAt: '2026-03-27T09:00:00.000Z',
              inviteUrl: 'http://127.0.0.1:3000/invite/accept?code=PREVIEW142',
              destinationHref: '/leagues/league-a',
              destinationLabel: 'Open league',
              viewCount: 8,
              shareCount: 2,
              acceptedCount: 1,
            },
          ],
        }),
      })
    })

    await page.route('**/api/invite/generate', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      expect(body.type).toBe('league')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          inviteLink: {
            id: 'invite-created',
            token: 'VALID142',
            inviteUrl: 'http://127.0.0.1:3000/invite/accept?code=VALID142',
            previewUrl: 'http://127.0.0.1:3000/invite/accept?code=VALID142',
            deepLinkUrl: 'allfantasy://invite/accept?code=VALID142',
            destinationHref: '/leagues/league-a',
          },
        }),
      })
    })

    await page.route('**/api/invite/share', async (route) => {
      const body = route.request().postDataJSON() as { channel?: string }
      shareChannels.push(body.channel ?? 'unknown')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto('/e2e/viral-league-invite?leagueId=league-a', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: 'Invite and referral stats' })).toBeVisible({ timeout: 15_000 })
    await expectReferralMetric(page, {
      testId: 'referral-total-created',
      label: 'Links created',
      expectedValue: '1',
    })
    await expect(page.getByTestId('open-invite-modal')).toBeVisible()

    await page.getByTestId('open-invite-modal').click()
    await expect(page.getByTestId('invite-modal-generate')).toBeVisible()
    await page.getByTestId('invite-modal-generate').click()

    await expectReferralMetric(page, {
      testId: 'referral-total-created',
      label: 'Links created',
      expectedValue: '2',
    })
    await expect(page.getByTestId('invite-share-copy_link')).toBeVisible()

    await page.getByTestId('invite-share-copy_link').click()
    await expectReferralMetric(page, {
      testId: 'referral-total-shares',
      label: 'Shares',
      expectedValue: '1',
    })

    const smsHref = await page.getByTestId('invite-share-sms').getAttribute('href')
    const emailHref = await page.getByTestId('invite-share-email').getAttribute('href')
    const xHref = await page.getByTestId('invite-share-twitter').getAttribute('href')
    const redditHref = await page.getByTestId('invite-share-reddit').getAttribute('href')
    const whatsappHref = await page.getByTestId('invite-share-whatsapp').getAttribute('href')

    expect(smsHref ?? '').toContain('sms:?body=')
    expect(emailHref ?? '').toContain('mailto:?subject=')
    expect(xHref ?? '').toContain('twitter.com/intent/tweet')
    expect(redditHref ?? '').toContain('reddit.com/submit')
    expect(whatsappHref ?? '').toContain('wa.me')

    await page.getByTestId('invite-share-discord').click()
    await expect(page.getByTestId('last-share-channel')).toContainText('discord')
    expect(shareChannels).toEqual(expect.arrayContaining(['copy_link', 'discord']))

    await expect(page.getByTestId('invite-management-preview-existing-invite')).toBeVisible()
  })

  test('preview loads, accept works, and expired invites show a safe state', async ({ page }) => {
    /*
     * /invite/accept sends a signed-out visitor to /login on "Accept invite". The root layout
     * preloads the server session into next-auth's SessionProvider, so with no cookie the client
     * never requests /api/auth/session and `mockAuthSession` is never consulted. It worked before
     * the Next 15.5 / React 19.3 upgrade only because the dev server ran the provider's mount
     * effect twice and the second pass refetched. A real signed cookie is what the other
     * session-gated specs use; the harness test above stays anonymous on purpose.
     */
    await signInAs(page, { id: 'user-e2e', name: 'Invite Auditor', email: 'auditor@example.com' })

    await page.route('**/api/invite/preview**', async (route) => {
      const url = new URL(route.request().url())
      const code = url.searchParams.get('code')

      if (code === 'VALID142') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            preview: {
              inviteType: 'league',
              token: 'VALID142',
              title: 'Invite Audit League',
              description: 'Join the audited league on AllFantasy.',
              targetId: 'league-a',
              targetName: 'Invite Audit League',
              sport: 'NFL',
              memberCount: 7,
              maxMembers: 12,
              isFull: false,
              expired: false,
              expiresAt: '2026-04-01T12:00:00.000Z',
              status: 'valid',
              statusReason: 'Shared by Invite Auditor.',
              destinationHref: '/e2e/viral-league-invite?joined=1',
              destinationLabel: 'Open league',
              createdByLabel: 'Invite Auditor',
            },
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          preview: {
            inviteType: 'league',
            token: 'EXPIRED142',
            title: 'Expired Invite Audit League',
            description: 'This invite expired.',
            targetId: 'league-b',
            targetName: 'Expired Invite Audit League',
            sport: 'NFL',
            memberCount: 12,
            maxMembers: 12,
            isFull: true,
            expired: true,
            expiresAt: '2026-03-01T12:00:00.000Z',
            status: 'expired',
            statusReason: 'This invite has expired.',
            destinationHref: '/leagues/league-b',
            destinationLabel: 'Open league',
            createdByLabel: 'Invite Auditor',
          },
        }),
      })
    })

    await page.route('**/api/invite/accept', async (route) => {
      const body = route.request().postDataJSON() as { code?: string }
      if (body.code === 'VALID142') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            inviteType: 'league',
            targetId: 'league-a',
            alreadyMember: false,
            destinationHref: '/e2e/viral-league-invite?joined=1',
          }),
        })
        return
      }

      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invite expired' }),
      })
    })

    await gotoInviteAcceptAndWait(page, 'VALID142', 'Invite Audit League')
    await page.getByRole('button', { name: 'Accept invite' }).click()
    await expect(page.getByRole('heading', { name: 'Viral Invite Engine Harness' })).toBeVisible({
      timeout: 15_000,
    })

    await gotoInviteAcceptAndWait(page, 'EXPIRED142', 'Expired Invite Audit League')
    await expect(page.getByTestId('invite-expired-state')).toContainText(/expired/i)
  })
})
