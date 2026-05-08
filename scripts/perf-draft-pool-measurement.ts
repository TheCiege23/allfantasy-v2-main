/**
 * Phase 1 measurement harness for the DraftRoom player pool perf bug.
 *
 * Resolves the draft pool for one seeded league per sport and reports
 *   - per-step server timings (existing `AF_DRAFT_POOL_PERF=1` flag enables them)
 *   - total resolver wall-clock
 *   - entry count
 *   - JSON payload size
 *   - sample of `display.assets.headshotUrl` to flag image-eager rows
 *
 * Production complaint: player pool takes 2–4 minutes to appear after the room
 * loads. Measurement-first plan — find the bottleneck before changing code.
 *
 *   npm run perf:draft-pool                       # all 7 sports, default warm
 *   npm run perf:draft-pool -- --sport=NFL
 *   npm run perf:draft-pool -- --cold             # disable resolver memo
 */

process.env.AF_DRAFT_POOL_PERF = '1'

import { PrismaClient } from '@prisma/client'

interface CliOpts {
  sports: string[]
  cold: boolean
  iterations: number
}

function parseCli(argv: string[]): CliOpts {
  const out: CliOpts = {
    sports: ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'],
    cold: false,
    iterations: 1,
  }
  for (const a of argv) {
    if (a === '--cold') out.cold = true
    else if (a.startsWith('--sport=')) out.sports = [a.slice('--sport='.length).toUpperCase()]
    else if (a.startsWith('--sports=')) out.sports = a.slice('--sports='.length).split(',').map((s) => s.trim().toUpperCase())
    else if (a.startsWith('--iterations=')) {
      const n = Number(a.slice('--iterations='.length))
      if (Number.isFinite(n) && n > 0) out.iterations = n
    }
  }
  return out
}

async function run() {
  const opts = parseCli(process.argv.slice(2))
  // Lazy-import the resolver after AF_DRAFT_POOL_PERF is set so the module
  // captures the env at import time.
  const { getResolvedDraftPoolForLeague } = await import('@/lib/draft-room/getResolvedDraftPoolForLeague')
  const { clearEffectiveLeagueRosterTemplateCache } = await import('@/lib/league/getEffectiveLeagueRosterTemplate')
  const prisma = new PrismaClient()

  const findings: Array<{
    sport: string
    iteration: number
    leagueId: string | null
    totalMs: number
    entryCount: number
    payloadBytes: number
    sampleHeadshotUrls: number
    sampleHeadshotUrl: string | null
    error?: string
  }> = []

  for (const sport of opts.sports) {
    const league = await prisma.league.findFirst({
      where: { sport: sport as any, season: 2026, platform: 'allfantasy_test_adp_seed' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!league) {
      findings.push({ sport, iteration: 0, leagueId: null, totalMs: 0, entryCount: 0, payloadBytes: 0, sampleHeadshotUrls: 0, sampleHeadshotUrl: null, error: 'no seeded league' })
      continue
    }

    for (let i = 0; i < opts.iterations; i++) {
      console.log(`\n=== ${sport} iter ${i + 1} (leagueId=${league.id.slice(0, 8)})${opts.cold ? ' COLD' : ''} ===`)
      if (opts.cold) clearEffectiveLeagueRosterTemplateCache(league.id)
      const t0 = Date.now()
      try {
        const result = await getResolvedDraftPoolForLeague(league.id, { limit: 500 })
        const totalMs = Date.now() - t0
        const entries = (result.entries ?? []) as any[]
        const payload = JSON.stringify(result)
        let withHeadshot = 0
        let sampleHeadshot: string | null = null
        for (const e of entries) {
          const url = e?.display?.assets?.headshotUrl ?? null
          if (url) {
            withHeadshot++
            if (!sampleHeadshot) sampleHeadshot = url
          }
        }
        findings.push({
          sport,
          iteration: i + 1,
          leagueId: league.id,
          totalMs,
          entryCount: entries.length,
          payloadBytes: payload.length,
          sampleHeadshotUrls: withHeadshot,
          sampleHeadshotUrl: sampleHeadshot,
        })
      } catch (err) {
        findings.push({
          sport,
          iteration: i + 1,
          leagueId: league.id,
          totalMs: Date.now() - t0,
          entryCount: 0,
          payloadBytes: 0,
          sampleHeadshotUrls: 0,
          sampleHeadshotUrl: null,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  console.log('\n\n========== SUMMARY ==========')
  console.log('sport      iter   total       entries   payloadKB   headshots   sampleUrl')
  console.log('----------------------------------------------------------------------------')
  for (const f of findings) {
    const kb = (f.payloadBytes / 1024).toFixed(1)
    const sample = f.sampleHeadshotUrl ? f.sampleHeadshotUrl.slice(0, 50) + (f.sampleHeadshotUrl.length > 50 ? '…' : '') : '—'
    const note = f.error ? ` ERROR: ${f.error}` : ''
    console.log(
      `${f.sport.padEnd(9)} ${String(f.iteration).padEnd(6)} ${(f.totalMs + 'ms').padEnd(10)}  ${String(f.entryCount).padEnd(8)} ${kb.padStart(8)}KB   ${String(f.sampleHeadshotUrls).padEnd(10)} ${sample}${note}`,
    )
  }
  console.log('============================\n')

  await prisma.$disconnect()
}

run().catch((e) => { console.error(e); process.exit(1) })
