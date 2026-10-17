import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { getLeagueDraftTemplatePayload } from '@/lib/league/league-draft-template-payload'

const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const
const FORMATS = ['redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine'] as const

test.describe.configure({ mode: 'default' })

for (const concept of FORMATS) {
  for (const sport of SPORTS) {
    if (!LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedSportsByConcept[concept].includes(sport)) continue

    test(`${concept}/${sport}: native draft completes and materializes rosters @local-staging`, async ({ page }) => {
      test.skip(process.env.AF_LOCAL_LEAGUE_RUNTIME !== '1', 'Explicit local staging run required')
      test.setTimeout(900_000)
      const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
      if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '54327' ||
          databaseUrl.pathname !== '/allfantasy_staging') {
        throw new Error('ISOLATED_LOCAL_STAGING_DATABASE_REQUIRED')
      }

      const marker = `seven-sport-browser-${concept}-${sport}-${randomUUID()}`
      const password = randomUUID()
      let userId: string | undefined
      let leagueId: string | undefined
      try {
        const user = await prisma.appUser.create({
          data: { username: marker, email: `${marker}@example.invalid`, emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 6) },
        })
        userId = user.id
        const csrf = await (await page.request.get('/api/auth/csrf')).json()
        await page.request.post('/api/auth/callback/credentials?json=true', {
          form: { csrfToken: csrf.csrfToken, login: user.email!, password, json: 'true' },
        })
        expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(userId)

        const scoringPreset = LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport[concept][sport]?.[0]
        const teamCount = LEAGUE_CREATE_OPTIONS_CATALOG_V1.teamCountOptionsByConceptSport[concept][sport]?.find((n) => n >= 4)
        expect(scoringPreset).toBeTruthy()
        expect(teamCount).toBeTruthy()
        const created = await page.request.post('/api/leagues', {
          data: { concept, sport, teamCount, draftType: 'snake', scoringPreset, leagueName: marker },
          timeout: 90_000,
        })
        expect(created.status(), await created.text()).toBe(200)
        leagueId = (await created.json()).league.id as string
        const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
        const rosterTemplate = await getLeagueDraftTemplatePayload(leagueId)
        expect(draft.rounds, `${concept}/${sport} roster capacity ${rosterTemplate.totalRosterSlots}: ${JSON.stringify({ templateId: rosterTemplate.template.templateId, formatType: rosterTemplate.formatType, slots: rosterTemplate.template.slots.map((s) => [s.slotName, s.starterCount, s.benchCount, s.reserveCount]) })}`)
          .toBeLessThanOrEqual(rosterTemplate.totalRosterSlots)
        const rounds = process.env.AF_FORMAT_DRAFT_FULL_DEPTH === '1' ? draft.rounds : 1
        const totalPicks = rounds * draft.teamCount
        await prisma.draftSession.update({ where: { id: draft.id }, data: { rounds, timerSeconds: 3600 } })

        const { stdout } = await promisify(execFile)(process.execPath,
          ['--conditions=react-server', '--import', 'tsx', resolve(__dirname, '../scripts/seed-seven-sport-draft-cache-testdb.ts'), leagueId],
          { env: process.env, encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' })
        const seed = JSON.parse(stdout) as { entries: Array<{ playerId: string; name: string; position: string; team: string }> }
        const start = await page.request.post(`/api/leagues/${leagueId}/draft/session`, { data: { action: 'start' } })
        expect(start.status(), `${concept}/${sport} start: ${await start.text()}`).toBe(200)
        for (let overall = 1; overall <= totalPicks; overall++) {
          const player = seed.entries[overall - 1]!
          const picked = await page.request.post(`/api/leagues/${leagueId}/draft/pick`, {
            data: { playerName: player.name, position: player.position, playerId: player.playerId,
              team: player.team, source: 'commissioner', expectedOverall: overall },
            timeout: 90_000,
          })
          expect(picked.status(), `${concept}/${sport} pick ${overall}: ${await picked.text()}`).toBe(200)
        }
        await expect.poll(async () => (await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('completed')
        expect(await prisma.draftPick.count({ where: { sessionId: draft.id } })).toBe(totalPicks)
        expect(await prisma.redraftRosterPlayer.count({ where: { roster: { leagueId } } })).toBe(totalPicks)
      } finally {
        if (leagueId) {
          await prisma.draftPoolCache.deleteMany({ where: { leagueId } })
          await prisma.league.deleteMany({ where: { id: leagueId } })
        }
        if (userId) {
          await prisma.analyticsEvent.deleteMany({ where: { userId } })
          await prisma.appUser.deleteMany({ where: { id: userId } })
        }
      }
    })
  }
}
