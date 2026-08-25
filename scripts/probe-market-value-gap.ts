/**
 * READ-ONLY. How many trade assets would gain a value if `valueFormat` were supplied?
 *
 * `canonicalShadow` never passes it, so `resolveTradeEnrichment` warns
 * `market_value_format_unknown` and `fantasyCalcValue` is null for every Decision OS trade.
 * `normalizedPlayerValue` only consults market value when there is NO usable projection, so
 * the fix can only move assets that currently price at zero — this counts them before the
 * change rather than after.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function slots(settings: unknown): string[] {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions as unknown) ?? (s.rosterPositions as unknown)
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : []
}
function qbFormat(starters: string[]): 'ONE_QB' | 'SUPERFLEX' {
  if (starters.some((s) => s.includes('SUPER_FLEX') || s === 'SUPERFLEX' || s === 'SF')) return 'SUPERFLEX'
  return starters.filter((s) => s === 'QB').length > 1 ? 'SUPERFLEX' : 'ONE_QB'
}

async function main() {
  const at = await prisma.fantasyProjection.findFirst({
    where: { source: { not: 'allfantasy' } },
    orderBy: [{ season: 'desc' }, { week: 'desc' }],
    select: { season: true, week: true },
  })
  if (!at) return console.log('no projections')
  console.log(`projection anchor ${at.season} wk${at.week}\n`)

  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, settings: true, leagueType: true },
  })

  let rostered = 0
  let noProjection = 0
  let wouldGain = 0
  let stillZero = 0
  const examples: string[] = []
  let leaguesSeen = 0

  for (const l of leagues) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId: l.id },
      select: { playerData: true },
    })
    if (rosters.length === 0) continue
    leaguesSeen++
    const ids = new Set<string>()
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      for (const k of ['starters', 'players']) {
        const arr = pd[k]
        if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v !== '0') ids.add(v)
      }
    }
    if (ids.size === 0) continue

    const idList = [...ids]
    const projRows = await prisma.fantasyProjection.findMany({
      where: { playerId: { in: idList }, season: at.season, week: at.week, source: { not: 'allfantasy' } },
      select: { playerId: true, projectedPoints: true },
    })
    const hasProj = new Set(
      projRows.filter((r) => Number(r.projectedPoints) > 0).map((r) => r.playerId),
    )

    const starters = slots(l.settings)
    const fmt = (l.leagueType ?? '').toLowerCase().includes('dynasty') ? 'DYNASTY' : 'REDRAFT'
    const fc = await prisma.playerValueSnapshot.findMany({
      where: {
        sleeperId: { in: idList },
        source: 'FANTASYCALC',
        format: fmt,
        qbFormat: qbFormat(starters),
      },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, value: true, name: true },
    })
    const valueOf = new Map<string, { v: number; n: string }>()
    for (const r of fc) if (!valueOf.has(r.sleeperId)) valueOf.set(r.sleeperId, { v: r.value, n: r.name })

    for (const id of idList) {
      rostered++
      if (hasProj.has(id)) continue
      noProjection++
      const hit = valueOf.get(id)
      if (hit && hit.v > 0) {
        wouldGain++
        if (examples.length < 12) examples.push(`${hit.n} -> ${hit.v}`)
      } else {
        stillZero++
      }
    }
  }

  const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`)
  console.log(`leagues with rosters: ${leaguesSeen}`)
  console.log(`rostered asset slots:            ${rostered}`)
  console.log(`  no usable projection today:    ${noProjection} (${pct(noProjection, rostered)})`)
  console.log(`  WOULD GAIN a market value:     ${wouldGain} (${pct(wouldGain, rostered)} of all, ${pct(wouldGain, noProjection)} of the unprojected)`)
  console.log(`  still zero after the fix:      ${stillZero}`)
  console.log('\nexamples of assets currently priced at 0:')
  for (const e of examples) console.log(`   ${e}`)
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e))
  .finally(() => prisma.$disconnect())
