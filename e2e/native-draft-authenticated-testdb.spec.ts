import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { test, expect } from '@playwright/test'
import { prisma } from '../lib/prisma'

test('authenticated native draft uses real routes and finalizes drafted teams @db', async ({ page, request }) => {
  test.skip(process.env.AF_NATIVE_DRAFT_TEST_DB !== '1', 'Explicit guarded test database run required')
  test.setTimeout(900_000)
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  const marker = 'native-browser-' + randomUUID(), password = randomUUID()
  let userId: string | undefined, leagueId: string | undefined, contestId: string | undefined
  try {
    const user = await prisma.appUser.create({ data: { username: marker, email: marker + '@example.invalid', emailVerified: new Date(), passwordHash: await bcrypt.hash(password,6) } })
    userId = user.id
    expect((await request.post('/api/leagues', { data: {} })).status()).toBe(401)
    console.log('Native draft auth: anonymous creation refused')
    const csrf = await (await page.request.get('/api/auth/csrf')).json()
    await page.request.post('/api/auth/callback/credentials?json=true', { form: { csrfToken: csrf.csrfToken, login: user.email!, password, json: 'true' } })
    expect((await (await page.request.get('/api/auth/session')).json()).user.id).toBe(userId)
    console.log('Native draft auth: cookie login verified')
    const created = await page.request.post('/api/leagues', { data: { concept:'best_ball',sport:'NFL',teamCount:4,draftType:'snake',scoringPreset:'fb_ppr',leagueName:marker,timezone:'America/Chicago',conceptSetup:{bestBall:{contestStructure:'tournament',regularSeasonLength:2,tournamentAdvancementRounds:1,podSize:4,advancersPerPod:2,playoffTeams:0}} } })
    expect(created.status()).toBeLessThan(400)
    leagueId = (await created.json()).league.id
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
    contestId = league.bbContestId!
    expect(contestId).toBeTruthy()
    console.log('Native draft auth: canonical tournament created')
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    // Short fixture draft; full-size persisted season simulation is covered separately.
    await prisma.draftSession.update({ where: { id:draft.id }, data:{ rounds:1, timerSeconds:3600 } })
    await prisma.bestBallContest.update({where:{id:contestId},data:{rosterSize:1}})
    execFileSync(process.execPath, ['--conditions=react-server','--import','tsx',resolve(__dirname,'../scripts/seed-native-draft-cache-testdb.ts'),leagueId!], { env:process.env,stdio:'pipe',timeout:120000 })
    console.log('Native draft auth: persisted pool fixture ready')
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.abort()
    })
    const start = await page.request.post('/api/leagues/' + leagueId + '/draft/session',{ data:{action:'start'} })
    expect(start.status()).toBeLessThan(400)
    console.log('Native draft auth: real start route succeeded')
    for(let overall=1;overall<=4;overall++) {
      const pick = await page.request.post('/api/leagues/' + leagueId + '/draft/pick',{data:{playerName:'Fixture Receiver '+overall,position:'WR',playerId:marker+'-p'+overall,team:'BUF',source:'commissioner',expectedOverall:overall}})
      expect(pick.status()).toBeLessThan(400)
      console.log('Native draft auth: pick accepted',overall)
    }
    await expect.poll(async () => (await prisma.draftSession.findUniqueOrThrow({where:{id:draft.id}})).status,{timeout:30_000}).toBe('completed')
    await expect.poll(async () => prisma.bestBallEntry.count({where:{contestId}}),{timeout:30_000}).toBe(4)
    expect(await prisma.redraftRoster.count({where:{leagueId}})).toBe(4)
    expect(await prisma.redraftRosterPlayer.count({where:{roster:{leagueId}}})).toBe(4)
    console.log('Native draft auth: roster and contest entry finalization verified')
    page.on('pageerror',error=>console.log('Native draft page error:',error.message.slice(0,200)))
    const navigation=await page.goto('/drafts/'+draft.id,{waitUntil:'domcontentloaded'})
    console.log('Native draft navigation:',navigation?.status(),new URL(page.url()).pathname)
    const desktop = page.getByTestId('draft-desktop-layout')
    try { await expect(desktop).toBeVisible({timeout:120_000}) } catch(error) {
      console.log('Native draft render diagnostic:', await page.title(), (await page.locator('body').innerText().catch(()=>'' )).slice(0,400))
      throw error
    }
    await expect(desktop.getByTestId('draft-board-cell-1')).toContainText('Fixture Receiver 1',{timeout:30_000})
    await page.goto('/league/'+leagueId+'/draft',{waitUntil:'domcontentloaded'})
    await page.waitForURL('**/drafts/'+draft.id,{waitUntil:'domcontentloaded',timeout:120_000})
    await expect(desktop).toBeVisible({timeout:120_000})
    console.log('Native draft auth: native league draft link rendered completed board')
  } finally {
    if(leagueId) { await prisma.draftPoolCache.deleteMany({where:{leagueId}});await prisma.league.deleteMany({where:{id:leagueId}}) }
    if(contestId) await prisma.bestBallContest.deleteMany({where:{id:contestId}})
    if(userId) {await prisma.analyticsEvent.deleteMany({where:{userId}});await prisma.appUser.deleteMany({where:{id:userId}})}
    if(leagueId) expect(await prisma.league.count({where:{id:leagueId}})).toBe(0)
    if(contestId) expect(await prisma.bestBallContest.count({where:{id:contestId}})).toBe(0)
    if(userId) expect(await prisma.appUser.count({where:{id:userId}})).toBe(0)
    await prisma.$disconnect()
  }
})
