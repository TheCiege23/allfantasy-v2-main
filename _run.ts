import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }); dotenv.config({ path: '.env' })
import path from 'node:path'; import Module from 'node:module'
const stub = path.resolve('./_s.js')
const M = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string }
const o = M._resolveFilename
M._resolveFilename = function (r: string, ...rest: unknown[]) { return r === 'server-only' ? stub : o.call(this, r, ...rest) }
async function main() {
  const t0 = Date.now()
  const { ingestFantraxPlayerIdentities } = await import('./lib/devy/ingestFantraxPlayerIdentities')
  const out = await ingestFantraxPlayerIdentities({ force: true })
  const secs = Math.round((Date.now() - t0) / 1000)
  console.log(`\ndone in ${secs}s`)
  console.log(JSON.stringify(out, null, 1))
  const { prisma } = await import('./lib/prisma')
  const linked = await prisma.playerIdentityMap.count({ where: { fantraxId: { not: null } } })
  console.log(`\nPlayerIdentityMap rows now carrying a fantraxId: ${linked}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
