const { spawnSync } = require('node:child_process')
const { Client } = require('pg')

async function main() {
  if (!process.env.TOURNAMENT_PILOT_DATABASE_URL) throw new Error('Set TOURNAMENT_PILOT_DATABASE_URL to the isolated pilot project connection string')
  const url = new URL(process.env.TOURNAMENT_PILOT_DATABASE_URL)
  if (url.pathname !== '/tournament_pilot' || !url.hostname.endsWith('.c-13.us-east-1.aws.neon.tech') ||
    !url.hostname.startsWith('ep-billowing-dream-b7cf9pxk')) throw new Error('Refusing a non-pilot database')
  const direct = new URL(url)
  direct.hostname = direct.hostname.replace('-pooler.', '.')
  const client = new Client({ connectionString: direct.toString(), connectionTimeoutMillis: 10000 })
  await client.connect()
  try {
    const result = await client.query("SELECT current_database() AS db, (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS tables")
    if (result.rows[0]?.db !== 'tournament_pilot') throw new Error('Pilot database identity changed')
    process.stdout.write(JSON.stringify({ target: 'isolated_nba_pilot', tables: result.rows[0].tables }) + '\n')
  } finally { await client.end() }
  const action = process.argv[2]
  if (action !== 'push' && action !== 'test') return
  const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: direct.toString(), ALLOW_UNKNOWN_DB_TARGET: '1' }
  if (action === 'test') { env.COMMISH_TENANT_ID = 'tournament-pilot'; env.TOURNAMENT_PILOT_DB = '1'; env.COMMISH_APP_URL = url.toString() }
  const args = action === 'push' ? ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'] : ['node_modules/vitest/vitest.mjs', 'run', '__tests__/tournament-season-pilot-postgres.test.ts', '--environment=node', '--maxWorkers=1']
  const result = spawnSync(process.execPath, args,
    { env, stdio: 'inherit', cwd: process.cwd(), shell: false })
  process.exitCode = result.status ?? 1
}

main().catch(error => { process.stderr.write(`Pilot staging command failed (${String(error?.code ?? 'check')}).\n`); process.exitCode = 1 })
