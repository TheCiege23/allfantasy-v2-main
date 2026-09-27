import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { test, expect } from '@playwright/test'
import { getScoringPresetOptionsForSelection } from '../lib/create-league-v2/rules-engine'
import { prisma } from '../lib/prisma'

test.describe.configure({ mode: 'serial' })
test.use({ actionTimeout: 120000, navigationTimeout: 300000 })

for (const sport of ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const) {
  test(`${sport}: real login, creation, queue, chat, draft picks and finalization @db`, async ({ page, request }) => {
    test.skip(process.env.AF_SEVEN_SPORT_DRAFT_TEST_DB !== '1', 'Explicit guarded test database run required')
    test.setTimeout(1_800_000)
    const host = new URL(process.env.DATABASE_URL ?? '').hostname
    if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
    const marker = 'seven-sport-browser-' + randomUUID(), password = randomUUID()
    const fullDepth = process.env.AF_SEVEN_SPORT_FULL_DEPTH === '1'
    const uiJourney = process.env.AF_SEVEN_SPORT_UI_JOURNEY === '1'
    let userId: string | undefined, leagueId: string | undefined
    try {
      const user = await prisma.appUser.create({ data: { username: marker, email: marker + '@example.invalid', emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 6) } })
      userId = user.id
      if (uiJourney) await prisma.userProfile.upsert({ where: { userId }, update: { ageConfirmedAt: new Date() }, create: { userId, ageConfirmedAt: new Date() } })
      expect((await request.post('/api/leagues', { data: {} })).status()).toBe(401)
      const csrf = await (await page.request.get('/api/auth/csrf')).json()
      await page.request.post('/api/auth/callback/credentials?json=true', { form: { csrfToken: csrf.csrfToken, login: user.email!, password, json: 'true' } })
      expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(userId)
      if (uiJourney) {
        expect((await (await page.request.get('/api/auth/confirm-age')).json()).confirmed).toBe(true)
        await page.goto('/create-league', { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('g30-create-league-wizard')).toBeVisible({ timeout: 120000 })
        await page.getByTestId('g30-sport-' + sport).click()
        await page.getByTestId('g30-step-basics').click()
        await expect(page.getByTestId('g30-basics-step')).toBeVisible()
        await page.getByTestId('g30-league-type-redraft').click()
        await page.getByTestId('g30-league-name').fill(marker)
        await page.getByTestId('g30-team-count').fill('4')
        await page.getByTestId('g30-privacy-private').click()
        await page.getByTestId('g30-step-draft').click()
        await page.getByTestId('g30-draft-type').selectOption('snake')
        await page.getByTestId('g30-draft-date').fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
        await page.getByTestId('g30-draft-time').fill('20:00')
        await page.getByTestId('g30-timezone').selectOption('America/Chicago')
        await page.getByTestId('g30-step-review').click()
        await expect(page.getByTestId('g30-review-issues')).toHaveCount(0)
        const createdPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/leagues' && r.request().method() === 'POST')
        await page.getByTestId('g30-create-league-submit').click()
        const created = await createdPromise
        expect(created.status(), await created.text()).toBeLessThan(400)
        leagueId = (await created.json()).league.id
        // Stop the league dashboard's unrelated polling while arranging draft fixtures.
        await page.goto('about:blank')
      } else {
      const created = await page.request.post('/api/leagues', { data: { concept: 'redraft', sport, ...(sport === 'SOCCER' ? { soccerPipeline: 'euro' } : {}), scoringPreset: getScoringPresetOptionsForSelection({ leagueType: 'redraft', sport, idpSelected: false })[0]!.id, teamCount: 4, draftType: 'snake', leagueName: marker, timezone: 'America/Chicago' } })
      expect(created.status(), await created.text()).toBeLessThan(400)
      leagueId = (await created.json()).league.id
      }
      const persistedLeague = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
      expect(persistedLeague).toMatchObject({ sport, timezone: 'America/Chicago', leagueSize: 4, userId })
      const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
      // Full-depth runs preserve the default rounds; ordinary runs use one round.
      const rounds = fullDepth ? draft.rounds : 1
      const totalPicks = rounds * draft.teamCount
      await prisma.draftSession.update({ where: { id: draft.id }, data: { rounds, timerSeconds: 3600 } })
      await prisma.leagueSettings.updateMany({ where: { leagueId }, data: { pickTimerPreset: 'custom', pickTimerCustomValue: 3600 } })
      const { stdout } = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', resolve(__dirname, '../scripts/seed-seven-sport-draft-cache-testdb.ts'), leagueId!], { env: process.env, encoding: 'utf8', timeout: 300000, killSignal: 'SIGKILL' })
      const seed = JSON.parse(stdout) as { entries: { playerId: string; name: string; position: string; team: string }[] }
      const queue = await page.request.put(`/api/leagues/${leagueId}/draft/queue`, { data: { queue: seed.entries.slice(0, 2).map(p => ({ playerName: p.name, position: p.position, team: p.team })) } })
      expect(queue.status()).toBeLessThan(400)
      expect((await (await page.request.get(`/api/leagues/${leagueId}/draft/queue`)).json()).queue).toHaveLength(2)
      expect((await page.request.post(`/api/leagues/${leagueId}/draft/session`, { data: { action: 'start' } })).status()).toBeLessThan(400)
      if (uiJourney) {
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
        const introStatusPromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/leagues/${leagueId}/draft/${draft.id}/intro-status` && response.request().method() === 'GET', { timeout: 300000 })
        await page.goto('/drafts/' + draft.id, { waitUntil: 'domcontentloaded' })
        const introStatus = await introStatusPromise
        expect(introStatus.status()).toBe(200)
        const intro = await introStatus.json()
        if (intro.seen === false && intro.videoUrl) {
          // Playback can end or fail before the skip button is clicked.
          await page.getByTestId('draft-intro-skip').click({ timeout: 10000 }).catch(async error => {
            if (await page.getByTestId('draft-intro-overlay').isVisible()) throw error
          })
          await expect(page.getByTestId('draft-intro-overlay')).toBeHidden()
        }
        const desktop = page.getByTestId('draft-desktop-layout')
        await expect(desktop).toBeVisible({ timeout: 120000 })
        await desktop.getByTestId('draft-right-dock-tab-chat').click()
        const chatPanel = desktop.getByTestId('draft-right-dock-panel-chat')
        await chatPanel.getByTestId('draft-chat-view-draft').click()
        await chatPanel.getByTestId('draft-chat-input').fill(marker + ' chat')
        const sentPromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/leagues/${leagueId}/draft/chat` && response.request().method() === 'POST', { timeout: 300000 })
        await chatPanel.getByTestId('draft-chat-send').click()
        const sent = await sentPromise
        expect(sent.status(), await sent.text()).toBeLessThan(400)
        await expect.poll(() => prisma.leagueChatMessage.count({ where: { leagueId, userId } }), { timeout: 30000 }).toBeGreaterThan(0)
        await desktop.getByTestId('draft-pool-view-cards').click()
        await desktop.getByTestId('draft-player-search-input').fill('Fixture Player 1')
        const pickedPromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/leagues/${leagueId}/draft/pick` && response.request().method() === 'POST', { timeout: 300000 })
        await desktop.getByTestId('draft-player-button-0').click()
        const picked = await pickedPromise
        expect(picked.status(), await picked.text()).toBeLessThan(400)
        await expect.poll(() => prisma.draftPick.count({ where: { sessionId: draft.id } }), { timeout: 30000 }).toBe(1)
      } else {
        const chat = await page.request.post(`/api/leagues/${leagueId}/draft/chat`, { data: { text: marker + ' chat' } })
        expect(chat.status()).toBeLessThan(400)
        expect(await prisma.leagueChatMessage.count({ where: { leagueId, userId } })).toBeGreaterThan(0)
      }
      for (let overall = uiJourney ? 2 : 1; overall <= totalPicks; overall++) {
        const player = seed.entries[overall - 1]!
        expect((await page.request.post(`/api/leagues/${leagueId}/draft/pick`, { data: { playerName: player.name, position: player.position, playerId: player.playerId, team: player.team, source: 'commissioner', expectedOverall: overall } })).status()).toBeLessThan(400)
      }
      await expect.poll(async () => (await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status, { timeout: 30000 }).toBe('completed')
      expect(await prisma.redraftRoster.count({ where: { leagueId } })).toBe(4)
      expect(await prisma.redraftRosterPlayer.count({ where: { roster: { leagueId } } })).toBe(totalPicks)
      const finalRosters = await prisma.redraftRoster.findMany({ where: { leagueId }, include: { players: true } })
      expect(finalRosters.map(roster => roster.players.length)).toEqual(Array(draft.teamCount).fill(rounds))
      expect(await prisma.draftPick.count({ where: { sessionId: draft.id } })).toBe(totalPicks)
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
      await page.goto('/drafts/' + draft.id, { waitUntil: 'domcontentloaded' })
      const desktop = page.getByTestId('draft-desktop-layout')
      await expect(desktop).toBeVisible({ timeout: 120000 })
      await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Fixture Player 1')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Fixture Player 1', { timeout: 120000 })
    } finally {
      if (leagueId) { await prisma.draftPoolCache.deleteMany({ where: { leagueId } }); await prisma.leagueChatMessage.deleteMany({ where: { leagueId } }); await prisma.league.deleteMany({ where: { id: leagueId } }); expect(await prisma.league.count({ where: { id: leagueId } })).toBe(0) }
      if (userId) { await prisma.analyticsEvent.deleteMany({ where: { userId } }); await prisma.appUser.deleteMany({ where: { id: userId } }); expect(await prisma.appUser.count({ where: { id: userId } })).toBe(0) }
      await prisma.$disconnect()
    }
  })
}
