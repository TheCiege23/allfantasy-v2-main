/**
 * READ-ONLY probe: run the real daily-sport points grade (loader + grader) against a database and print
 * the board it built and a few graded deals. Two locks, so a probe can never write:
 *   1. one direct connection with `default_transaction_read_only = on`, verified before anything runs;
 *   2. a client hook that throws on any operation that is not a read.
 *
 *   PROBE_ENV_FILE=<path to .env> node --require ./scripts/_audit-preload.cjs ./node_modules/tsx/dist/cli.mjs scripts/probe-sport-points-grades.ts
 */
import { readFileSync } from 'node:fs'

const envFile = process.env.PROBE_ENV_FILE ?? ''
const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!line) throw new Error('DATABASE_URL not found in PROBE_ENV_FILE')
const u = new URL(line.slice('DATABASE_URL='.length).replace(/^"|"$/g, ''))
u.host = u.host.replace('-pooler', '')
u.searchParams.set('connection_limit', '1')
u.searchParams.delete('pgbouncer')
console.log(`[probe] target host: ${u.host}`)

const READS = new Set(['findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])

async function main() {
  const { PrismaClient } = await import('@prisma/client')
  const base = new PrismaClient({ datasourceUrl: u.toString() })
  await base.$executeRawUnsafe('SET SESSION default_transaction_read_only = on')
  const [{ ro }] = await base.$queryRawUnsafe<Array<{ ro: string }>>("SELECT current_setting('default_transaction_read_only') AS ro")
  if (ro !== 'on') throw new Error(`session is not read-only (${ro}); refusing to run`)
  console.log(`[probe] default_transaction_read_only=${ro}`)
  const guarded = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!READS.has(operation)) throw new Error(`read-only probe refused ${model}.${operation}`)
          return query(args)
        },
      },
    },
  })
  ;(globalThis as unknown as { prisma: unknown }).prisma = guarded

  const { loadSportPointsBase } = await import('@/lib/decision-os/trade/sportPointsContext')
  const { gradeSportPointsDeal } = await import('@/lib/decision-os/trade/sportPointsValue')

  const deals: Record<string, Array<[string[], string[]]>> = {
    NBA: [
      [['Nikola Jokic'], ['Shai Gilgeous-Alexander']],
      [['Nikola Jokic'], ['Jalen Johnson', 'Tyrese Maxey']],
      [['Luka Doncic'], ['Victor Wembanyama']],
      [['Cade Cunningham'], ['Jalen Brunson']],
    ],
    NCAAB: [[['JT Toppin'], ['Boopie Miller']]],
    NHL: [[['Connor McDavid'], ['Nathan MacKinnon']]],
    // Needs #2192's rates on the board; until the projection writer has run with it, MLB refuses.
    MLB: [[['Aaron Judge'], ['Paul Skenes']], [['Tarik Skubal'], ['Juan Soto']], [['Shohei Ohtani'], ['Aaron Judge']]],
  }

  deals.NBA!.push([['Giannis Antetokounmpo'], ['Shai Gilgeous-Alexander']], [['Rudy Gobert'], ['Tyrese Haliburton']])
  const runs = [
    { sport: 'NBA', format: 'points' },
    { sport: 'NBA', format: 'nba_9cat' },
    { sport: 'NCAAB', format: 'points' },
    { sport: 'NHL', format: 'points' },
    { sport: 'MLB', format: 'points' },
    { sport: 'MLB', format: 'mlb_5x5' },
  ] as const
  for (const { sport, format } of runs) {
    const t0 = Date.now()
    const loaded = await loadSportPointsBase({ sport, league: null, format })
    console.log(`\n=== ${sport} · ${format} (${Date.now() - t0} ms)`)
    if (!loaded.ok) {
      console.log(`  not graded: ${loaded.reason}`)
      continue
    }
    const { ctx } = loaded
    const gated = ctx.board.filter((p) => p.sampleGames == null || p.sampleGames >= 10)
    console.log(`  board ${ctx.board.length} players (${gated.length} meet the sample bar), season ${ctx.window.seasonLabel}, ~${ctx.window.gamesRemaining} games left`)
    const top = format === 'points' ? 8 : 20
    console.log(`  top ${top} per game: ${gated.slice().sort((a, b) => b.perGame - a.perGame).slice(0, top).map((p) => `${p.name} ${p.position} ${p.perGame.toFixed(1)}`).join(' | ')}`)
    console.log(`  replacement: ${[...ctx.replacementByPosition].map(([pos, r]) => `${pos} ${r.name} ${r.perGame.toFixed(1)}`).join(' | ')}`)
    for (const [give, get] of deals[sport] ?? []) {
      const view = gradeSportPointsDeal({
        give: give.map((name) => ({ kind: 'player' as const, name })),
        get: get.map((name) => ({ kind: 'player' as const, name })),
        ctx,
      })
      const label = `${give.join(' + ')} -> ${get.join(' + ')}`
      if (view.graded) {
        console.log(`  ${label}: ${view.letter} (partner ${view.partnerLetter}), give ${view.giveValue} vs get ${view.getValue}, gap ${view.percentDiff}%`)
      } else {
        console.log(`  ${label}: not graded — ${view.reason}`)
      }
    }
  }
  await base.$disconnect()
  console.log('\nPROBE_DONE')
}

main().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e)
  process.exit(1)
})
