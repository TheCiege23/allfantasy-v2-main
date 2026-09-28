/** Bounded read-only cache media samples; verifies browser decoding, not identity certification. */
const { Client } = require('pg')
const { chromium } = require('@playwright/test')
const sports = ['NFL','NBA','NHL','MLB','NCAAF','NCAAB','SOCCER']
const allowedHosts = new Set(['a.espncdn.com','a2.espncdn.com','media.api-sports.io','r2.thesportsdb.com','www.thesportsdb.com','sleepercdn.com','cdn.collegefootballdata.com'])
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000 })
  const samples = []
  try {
    await db.connect(); await db.query('BEGIN READ ONLY'); await db.query("SET LOCAL statement_timeout='20s'")
    if ((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') throw new Error('READ_ONLY_REQUIRED')
    for (const sport of sports) {
      const players = (await db.query('SELECT id,name,team,source,"imageUrl" AS url FROM "SportsPlayer" WHERE sport=$1 AND "expiresAt">now() AND NULLIF("imageUrl",\'\') IS NOT NULL ORDER BY "updatedAt" DESC LIMIT 2',[sport])).rows
      const teams = (await db.query('SELECT id,name,source,logo AS url FROM "SportsTeam" WHERE sport=$1 AND NULLIF(logo,\'\') IS NOT NULL ORDER BY "updatedAt" DESC LIMIT 1',[sport])).rows
      for (const row of players) samples.push({ sport,kind:'headshot',...row })
      for (const row of teams) samples.push({ sport,kind:'logo',...row })
    }
    await db.query('ROLLBACK')
  } finally { await db.end() }
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const sample of samples) {
      const url = new URL(sample.url)
      const metadata = { sport: sample.sport, kind: sample.kind, name: sample.name, team: sample.team ?? null, source: sample.source, host: url.hostname }
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) { results.push({ ...metadata, decoded: false, reason:'unreviewed_media_host' }); continue }
      const page = await browser.newPage()
      await page.route('**/*', route => { const request = new URL(route.request().url()); return request.protocol === 'https:' && allowedHosts.has(request.hostname) ? route.continue() : route.abort() })
      try {
        await page.goto('about:blank')
        const decoded = await page.evaluate(async url => { const image = new Image(); return await new Promise(resolve => { const timer = setTimeout(() => resolve(false),15000); image.onload = () => { clearTimeout(timer); resolve(image.naturalWidth > 0) }; image.onerror = () => { clearTimeout(timer); resolve(false) }; image.src = url }) }, sample.url)
        results.push({ ...metadata, decoded })
      } catch { results.push({ ...metadata, decoded:false, reason:'browser_error' }) }
      finally { await page.close() }
    }
  } finally { await browser.close() }
  console.log(JSON.stringify({ asOf:new Date().toISOString(), transactionReadOnly:true, scope:'Latest stored samples, browser decode only. No provider API calls, writes or complete pool identity certification.', missingSports:sports.filter(sport => !samples.some(sample => sample.sport === sport)), results },null,2))
}
main().catch(error => { console.error('Read-only media check failed:',error.code ?? error.name); process.exitCode=1 })
