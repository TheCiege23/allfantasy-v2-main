/** Local Pirate QA server against the verified staging database. */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const dotenv = require('dotenv')
const read = (file) => fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}
const stage = read('.env.staging')
const production = read('.env')
if (!stage.DATABASE_URL || !production.DATABASE_URL ||
  new URL(stage.DATABASE_URL).hostname.replace('-pooler', '') === new URL(production.DATABASE_URL).hostname.replace('-pooler', '')) {
  throw Error('Verified separate staging database required')
}
const env = { ...process.env }
for (const file of ['.env', '.env.local', '.env.production', '.env.development', '.env.development.local']) {
  for (const key of Object.keys(read(file))) env[key] = ''
}
Object.assign(env, stage, {
  DATABASE_URL: stage.DATABASE_URL, DIRECT_URL: stage.DATABASE_URL,
  NODE_ENV: 'development', AF_NEXT_DIST_DIR: '.next-pirate-qa',
  NEXTAUTH_URL: 'http://127.0.0.1:3010', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3010',
  DEV_AUTH_BYPASS_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1',
  AF_USE_DB_CACHE_ONLY: 'true', AF_DISABLE_LIVE_API_ON_PAGE_LOAD: 'true',
  AF_DISABLE_ADP_LIVE_MERGE_ON_PAGE_LOAD: 'true', AF_DISABLE_STATS_LIVE_MERGE_ON_PAGE_LOAD: 'true',
})
if (!env.NEXTAUTH_SECRET && !env.AUTH_SECRET) throw Error('Staging auth secret is required')
const child = spawn(process.execPath, ['--require', path.resolve('scripts/win-exfat-readlink-shim.cjs'),
  path.resolve('node_modules/next/dist/bin/next'), 'dev', '-p', '3010', '--hostname', '127.0.0.1'],
  { cwd: process.cwd(), env, stdio: 'inherit', windowsHide: true })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
process.on('SIGTERM', () => child.kill())
process.on('SIGINT', () => child.kill())
