import { expect, type Page } from '@playwright/test'

const preview = '/dev/tournament-invite-readiness'

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

export async function auditTournamentInvite(page: Page) {
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/tournament/season-registration', async route => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ json: { status: 'registered' } })
  })
  await page.goto(preview + '?view=invite')
  await expect(page.getByRole('note')).toContainText('Synthetic browser preview')
  const join = page.getByRole('button', { name: 'Join tournament' })
  await expect(join).toBeDisabled()
  await page.getByLabel('I accept this published tournament rule version').check()
  await join.click()
  await expect.poll(() => submitted).toMatchObject({ action: 'join', publicationId: 'synthetic-publication', acceptedHash: 'synthetic-rule-version', acceptedRules: true })
  await fitsViewport(page)
}

export async function auditTournamentAssignment(page: Page) {
  await page.goto(preview + '?view=assigned')
  await expect(page.getByRole('link', { name: 'Open my draft room' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reveal my league' }).click()
  const link = page.getByRole('link', { name: 'Open my draft room' })
  await expect(link).toHaveAttribute('href', '/drafts/synthetic-draft')
  const box = await link.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  await fitsViewport(page)
}

export async function auditTournamentCommissioner(page: Page) {
  let released = false
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/tournament/season-setup*', async route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON()
      released = true
      await route.fulfill({ json: { released: true } })
      return
    }
    const league = (key: string, name: string, isReleased: boolean) => ({
      key, name, art: { sideId: 'gold', emblemId: 'basketball' }, division: 'Gold', slots: 8,
      state: 'created', leagueId: 'native-' + key, draftReleased: isReleased, draftId: isReleased ? 'draft-' + key : null,
    })
    await route.fulfill({ json: { setup: {
      freezeId: 'synthetic-freeze', launchReady: false, draftReleaseEnabled: true, scoringSource: null, scoringPeriods: [],
      leagues: [league('one', 'Opening One', true), league('two', 'Opening League with a Very Long Name for Phone Width', released)],
    } } })
  })
  await page.goto(preview + '?view=commissioner')
  await expect(page.getByRole('heading', { name: 'Create opening leagues and drafts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open draft room' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Release opening draft' }).click()
  await expect.poll(() => submitted).toMatchObject({ action: 'release_draft', tournamentId: 'synthetic-tournament', freezeId: 'synthetic-freeze', key: 'two' })
  await expect(page.getByRole('link', { name: 'Open draft room' })).toHaveCount(2)
  await fitsViewport(page)
}
