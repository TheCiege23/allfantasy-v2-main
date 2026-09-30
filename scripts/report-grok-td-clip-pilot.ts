/**
 * READ-ONLY report for the Grok touchdown-clip pilot (`lib/live/grokTdClipPilot.ts`).
 *
 * Answers the pilot's questions from what it logged to `SportsDataCache`: how
 * often a clip was found, on which attempt, how long after the play it was
 * posted, what it cost, and which teams never produced a hit (a likely wrong
 * handle in `NFL_X_HANDLES`). It then lists every accepted link, because the one
 * thing no code here can check is whether the post really shows that play —
 * open them.
 *
 * 🛑 THIS REPO'S `.env` POINTS AT PRODUCTION. The script refuses to connect unless
 * you name the host you mean with `--db-host=<host or unique part of it>` and it
 * matches `DATABASE_URL`'s host. It runs one SELECT and writes nothing.
 *
 * Usage:
 *   DATABASE_URL=<url> npx tsx scripts/report-grok-td-clip-pilot.ts --db-host=<host> [--json]
 */
import { PrismaClient } from '@prisma/client'

import { summarizeClipPilot, type ClipPilotRecord } from '../lib/live/tdClipMatch'

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

async function main() {
  const wanted = arg('db-host')
  const host = hostOf(process.env.DATABASE_URL)
  if (!wanted || !host || !host.includes(wanted)) {
    console.error(
      `Refusing to connect: pass --db-host=<part of the host> matching DATABASE_URL (currently ${host ?? 'unset'}).`,
    )
    process.exit(2)
  }

  const prisma = new PrismaClient()
  try {
    const rows = await prisma.sportsDataCache.findMany({
      where: { cacheKey: { startsWith: 'grok-clip-pilot:NFL:' } },
      select: { data: true },
    })
    const records = rows.map((r) => r.data as unknown as ClipPilotRecord)
    const s = summarizeClipPilot(records)

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(s, null, 2))
      return
    }

    const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`)
    console.log(`Touchdowns searched   ${s.touchdowns}  (${s.searches} searches, ${s.failedSearches} failed outright)`)
    console.log(`Clip found            ${s.found}  ${pct(s.found, s.touchdowns)} of touchdowns`)
    console.log(`  on first attempt    ${s.foundOnFirstAttempt}   (5 min after the play)`)
    console.log(`  on the retry        ${s.foundOnRetry}   (30 min after)`)
    console.log(`Post lag after play   median ${s.lagSecondsMedian ?? '—'}s, p90 ${s.lagSecondsP90 ?? '—'}s`)
    console.log(`Search latency        median ${s.latencyMsMedian ?? '—'}ms`)
    console.log(`Cost                  ${s.costTicksTotal} xAI cost ticks total (usage.cost_in_usd_ticks)`)
    console.log(`Model picks refused   ${s.picksRejected}  (uncited, or failed the handle/time check)`)
    console.log(`Accepted, no handle   ${s.acceptedWithoutHandle}  (x.com/i/status links — account not re-checkable)`)
    console.log(`Rejected citations    ${JSON.stringify(s.rejectedByReason)}`)
    console.log('\nBy team (searched / found) — a team stuck at 0 found suggests a wrong handle:')
    for (const [team, t] of Object.entries(s.byTeam).sort((a, b) => b[1].searched - a[1].searched)) {
      console.log(`  ${team.padEnd(8)} ${String(t.searched).padStart(3)} / ${t.found}`)
    }
    console.log('\nAccepted links — open each and confirm it shows that play:')
    for (const l of s.foundLinks) {
      console.log(`  [attempt ${l.attempt}, +${l.lagSeconds}s] ${l.playerName} — ${l.headline}\n      ${l.url}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
