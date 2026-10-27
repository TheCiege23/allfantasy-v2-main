/** Playwright phone viewport pass for the real PirateHome React component. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium, webkit, devices } = require('playwright')

async function main() {
  const useWebkit = process.env.PIRATE_BROWSER === 'webkit'
  const browser = await (useWebkit ? webkit : chromium).launch({ headless: true })
  const results = []
  try {
    for (const [deviceName, device] of (useWebkit
      ? [['ios-webkit', devices['iPhone 13']]]
      : [['android', devices['Pixel 7']], ['ios', devices['iPhone 13']]])) {
      assert(device, `${deviceName} descriptor unavailable`)
      const context = await browser.newContext(device)
      const page = await context.newPage()
      await page.route('http://pirate.test/images/league-types/pirate-hero.png', (route) => route.fulfill({
        contentType: 'image/png', body: fs.readFileSync('public/images/league-types/pirate-hero.png'),
      }))
      await page.setContent('<html><head><base href="http://pirate.test/"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;background:#03101e"><div id="root"></div></body></html>')
      await page.addStyleTag({ path: 'tmp/pirate-mobile.css' })
      const hero = fs.readFileSync('public/images/league-types/pirate-hero.png').toString('base64')
      await page.addStyleTag({ content: `[class*="pirate-hero.png"]{background-image:url("data:image/png;base64,${hero}")!important}` })
      await page.addScriptTag({ path: 'tmp/pirate-mobile.js' })
      await page.getByText('The claim board').waitFor({ timeout: 60000 })
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }))
      assert(overflow.content <= overflow.viewport + 2, `${deviceName}: horizontal overflow ${JSON.stringify(overflow)}`)
      const lock = page.getByRole('button', { name: /First Player/ })
      assert.equal(await lock.getAttribute('aria-pressed'), 'false')
      await lock.tap()
      assert.equal(await lock.getAttribute('aria-pressed'), 'true')
      assert(await page.getByRole('button', { name: 'Save protection locks' }).isVisible())
      assert(await page.getByRole('button', { name: 'Send claim' }).isVisible())
      await page.waitForLoadState('networkidle')
      const screenshot = `docs/pirate-validation/mobile-${deviceName}.png`
      await page.screenshot({ path: screenshot, fullPage: true })
      results.push({ device: deviceName, ...overflow, protectionTapWorks: true, claimActionVisible: true, screenshot })
      console.log(`${deviceName}: Pirate Deck viewport passed`)
      await context.close()
    }
    fs.writeFileSync(useWebkit ? 'docs/pirate-validation/mobile-results-webkit.json' : 'docs/pirate-validation/mobile-results.json', JSON.stringify({
      method: `Playwright ${useWebkit ? 'WebKit' : 'Chromium'} with phone device descriptors against the PirateHome React component`, results,
    }, null, 2))
  } finally { await browser.close() }
}
main().catch((error) => { console.error('Pirate mobile viewport failed:', error.message); process.exitCode = 1 })
