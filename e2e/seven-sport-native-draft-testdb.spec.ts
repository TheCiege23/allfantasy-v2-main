import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { test, expect } from '@playwright/test'
import { getScoringPresetOptionsForSelection } from '../lib/create-league-v2/rules-engine'
import { prisma } from '../lib/prisma'

test.describe.configure({ mode: 'serial' })

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
      expect((await request.post('/api/leagues', { data: {} })).status()).toBe(401)
      const csrf = await (await page.request.get('/api/auth/csrf')).json()
      await page.request.post('/api/auth/callback/credentials?json=true', { form: { csrfToken: csrf.csrfToken, login: user.email!, password, json: 'true' } })
      expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(userId)
      if (uiJourney) {
        expect((await (await page.request.get('/api/auth/confirm-age')).json()).confirmed).toBe(false)
        await page.goto('/create-league', { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('g30-create-league-wizard')).toBeVisible({ timeout: 120000 })
        const confirmation = page.getByRole('dialog', { name: 'Quick confirmation' })
        await expect(confirmation).toBeVisible({ timeout: 300000 })
        await confirmation.getByRole('button', { name: 'I' + String.fromCharCode(39) + 'm 18+ and agree', exact: true }).click()
        await expect(confirmation).toBeHidden({ timeout: 120000 })
        await page.getByTestId('g30-sport-' + sport).click()
        await page.getByTestId('g30-step-basics').click()
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
      } else {
      const created = await page.request.post('/api/leagues', { data: { concept: 'redraft', sport, ...(sport === 'SOCCER' ? { soccerPipeline: 'euro' } : {}), scoringPreset: getScoringPresetOptionsForSelection({ leagueType: 'redraft', sport, idpSelected: false })[0]!.id, teamCount: 4, draftType: 'snake', leagueName: marker, timezone: 'America/Chicago' } })
      expect(created.status(), await created.text()).toBeLessThan(400)
      leagueId = (await created.json()).league.id
      }
      expect((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).sport).toBe(sport)
      const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
      // Full-depth runs preserve the default rounds; ordinary runs use one round.
      const rounds = fullDepth ? draft.rounds : 1
      const totalPicks = rounds * draft.teamCount
      await prisma.draftSession.update({ where: { id: draft.id }, data: { rounds, timerSeconds: 3600 } })
      const seed = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', resolve(__dirname, '../scripts/seed-seven-sport-draft-cache-testdb.ts'), leagueId!], { env: process.env, encoding: 'utf8', timeout: 300000 })) as { entries: { playerId: string; name: string; position: string; team: string }[] }
      const queue = await page.request.put(`/api/leagues/${leagueId}/draft/queue`, { data: { queue: seed.entries.slice(0, 2).map(p => ({ playerName: p.name, position: p.position, team: p.team })) } })
      expect(queue.status()).toBeLessThan(400)
      expect((await (await page.request.get(`/api/leagues/${leagueId}/draft/queue`)).json()).queue).toHaveLength(2)
      expect((await page.request.post(`/api/leagues/${leagueId}/draft/session`, { data: { action: 'start' } })).status()).toBeLessThan(400)
      if (uiJourney) {
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
        await page.goto('/drafts/' + draft.id, { waitUntil: 'domcontentloaded' })
        const desktop = page.getByTestId('draft-desktop-layout')
        await expect(desktop).toBeVisible({ timeout: 120000 })
        await desktop.getByTestId('draft-right-dock-tab-chat').click()
        const chatPanel = desktop.getByTestId('draft-right-dock-panel-chat')
        await chatPanel.getByTestId('draft-chat-input').fill(marker + ' chat')
        await chatPanel.getByTestId('draft-chat-send').click()
        await expect.poll(() => prisma.leagueChatMessage.count({ where: { leagueId, userId } }), { timeout: 30000 }).toBeGreaterThan(0)
        await desktop.getByTestId('draft-pool-view-cards').click()
        await desktop.getByTestId('draft-player-search-input').fill('Fixture Player 1')
        await desktop.getByTestId('draft-pick-request-0').click()
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
