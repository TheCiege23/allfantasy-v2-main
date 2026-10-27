/** Android and iOS viewport smoke test of the staging-backed Pirate Deck. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { randomBytes } = require('node:crypto')
const dotenv = require('dotenv')
const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { chromium, devices, request } = require('playwright')

const stage = dotenv.parse(fs.readFileSync('.env.staging'))
const production = dotenv.parse(fs.readFileSync('.env'))
assert.notEqual(new URL(stage.DATABASE_URL).hostname.replace('-pooler', ''), new URL(production.DATABASE_URL).hostname.replace('-pooler', ''))
const evidence = JSON.parse(fs.readFileSync('docs/pirate-validation/staging-lifecycle.json', 'utf8'))
assert.equal(evidence.databaseHost, new URL(stage.DATABASE_URL).hostname)
const leagueId = evidence.results.find((row) => row.sport === 'NFL').leagueId
const userId = `${evidence.tag}-owner-0`
const base = 'http://127.0.0.1:3010'
const db = new PrismaClient({ datasources: { db: { url: stage.DATABASE_URL } } })

async function main() {
  const user = await db.appUser.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, passwordHash: true } })
  assert(user.email.includes(evidence.tag) && user.email.endsWith('@example.invalid'), 'Only the isolated QA account may change')
  const password = randomBytes(18).toString('base64url')
  await db.appUser.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10) } })
  let browser
  try {
    const auth = await request.newContext({ baseURL: base, timeout: 300000 })
    const csrf = await (await auth.get('/api/auth/csrf')).json()
    const response = await auth.post('/api/auth/callback/credentials?json=true', { form: {
      csrfToken: csrf.csrfToken, login: user.email, password, json: 'true', callbackUrl: `${base}/league/${leagueId}`,
    } })
    assert(response.ok(), `Staging login returned ${response.status()}`)
    const storageState = await auth.storageState()
    await auth.dispose()
    browser = await chromium.launch({ headless: true })
    const results = []
    for (const [name, device] of [['android', devices['Pixel 7']], ['ios', devices['iPhone 13']]]) {
      const context = await browser.newContext({ ...device, storageState })
      const page = await context.newPage()
      await page.goto(`${base}/league/${leagueId}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
      await page.getByText('The weekly hunt').first().waitFor({ timeout: 180000 })
      await page.getByText('The claim board').first().waitFor({ timeout: 30000 })
      const measure = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
        claimBoardVisible: [...document.querySelectorAll('h3')].some((item) => item.textContent?.includes('The claim board')),
      }))
      assert(measure.claimBoardVisible, 'Claim board is missing')
      assert(measure.content <= measure.viewport + 2, `${name} has horizontal overflow: ${JSON.stringify(measure)}`)
      const path = `docs/pirate-validation/mobile-${name}.png`
      await page.screenshot({ path, fullPage: true })
      results.push({ device: name, viewport: measure.viewport, content: measure.content, screenshot: path, passed: true })
      console.log(`${name}: Pirate Deck mobile viewport passed`)
      await context.close()
    }
    fs.writeFileSync('docs/pirate-validation/mobile-results.json', JSON.stringify({ leagueId, results }, null, 2))
  } finally {
    await browser?.close()
    await db.appUser.update({ where: { id: user.id }, data: { passwordHash: user.passwordHash } })
    await db.$disconnect()
  }
}
main().catch((error) => { console.error('Pirate mobile check failed:', error.message); process.exitCode = 1 })
