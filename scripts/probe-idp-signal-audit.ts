/**
 * READ-ONLY audit: which richer IDP signals does this codebase actually hold? Never writes.
 *
 * Asked for: coaching ideology, defensive scheme, blitz rate, snap count, and run-only /
 * pass-only / third-down role splits. Every one of those is a real predictor. The question is
 * not whether they would help — it is whether a single row of any of them exists here, and
 * the honest answer has to come from the database rather than from optimism.
 */
import { PrismaClient } from '@prisma/client'

import { isIdpPosition } from '../lib/core-app/scoringNotes'

const prisma = new PrismaClient()

function heading(s: string) {
  console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`)
}

async function statVocabulary() {
  heading('1. Every key a DEFENDER carries in PlayerGameStat.normalizedStatMap')

  const players = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', position: { in: ['LB', 'DE', 'DT', 'DB', 'CB', 'S', 'DL'] } },
    select: { sleeperId: true },
    take: 3000,
  })
  const ids = [...new Set(players.map((p) => p.sleeperId).filter((x): x is string => !!x))]
  const rows = await prisma.playerGameStat.findMany({
    where: { sportType: 'NFL', playerId: { in: ids } },
    select: { normalizedStatMap: true, statPayload: true },
    take: 3000,
  })

  const norm = new Map<string, number>()
  const payload = new Map<string, number>()
  for (const r of rows) {
    for (const k of Object.keys((r.normalizedStatMap ?? {}) as object)) {
      norm.set(k, (norm.get(k) ?? 0) + 1)
    }
    for (const k of Object.keys((r.statPayload ?? {}) as object)) {
      payload.set(k, (payload.get(k) ?? 0) + 1)
    }
  }
  console.log(`sampled ${rows.length} defender game rows`)
  console.log('\nnormalizedStatMap keys:')
  for (const [k, c] of [...norm].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${c}`)
  }
  console.log('\nstatPayload keys (the raw provider row):')
  for (const [k, c] of [...payload].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`  ${k.padEnd(24)} ${c}`)
  }

  const SNAP = ['def_snp', 'tm_def_snp', 'snaps', 'defensive_snaps', 'snap_pct', 'off_snp']
  console.log('\nSNAP-COUNT keys specifically:')
  for (const k of SNAP) {
    console.log(`  ${k.padEnd(20)} normalized=${norm.get(k) ?? 0}  payload=${payload.get(k) ?? 0}`)
  }
}

async function coaching() {
  heading('2. Coaching: who, and do we know anything about HOW they play?')
  const coaches = await prisma.coach.count()
  const stints = await prisma.coachStint.count()
  console.log(`Coach rows:      ${coaches}`)
  console.log(`CoachStint rows: ${stints}`)
  if (stints > 0) {
    const byRole = await prisma.coachStint.groupBy({
      by: ['role'],
      _count: { _all: true },
      orderBy: { _count: { role: 'desc' } },
    })
    console.log('\nstints by role:')
    for (const r of byRole) console.log(`  ${r.role.padEnd(20)} ${r._count._all}`)

    const dc = await prisma.coachStint.groupBy({
      by: ['season'],
      where: { role: 'DC' },
      _count: { _all: true },
      orderBy: { season: 'desc' },
      take: 6,
    })
    console.log('\ndefensive coordinators by season:')
    for (const r of dc) console.log(`  ${r.season}: ${r._count._all}`)
  }
  console.log(
    '\nNOTE: CoachStint carries identity and role only — there is no scheme, ' +
      'aggression, or ideology attribute anywhere on it.',
  )
}

async function tendencies() {
  heading('3. TeamTendencySeason — offensive only?')
  const total = await prisma.teamTendencySeason.count()
  console.log(`rows: ${total}`)
  const sample = await prisma.teamTendencySeason.findFirst({ orderBy: { season: 'desc' } })
  if (sample) {
    console.log('columns actually populated on the newest row:')
    for (const [k, v] of Object.entries(sample)) {
      if (v == null) continue
      console.log(`  ${k.padEnd(18)} ${String(v).slice(0, 40)}`)
    }
  }
  const seasons = await prisma.teamTendencySeason.groupBy({
    by: ['season'],
    _count: { _all: true },
    orderBy: { season: 'desc' },
    take: 4,
  })
  console.log('\nby season:')
  for (const s of seasons) console.log(`  ${s.season}: ${s._count._all}`)
  console.log(
    '\nNOTE: every metric here (proe, shotgun, no-huddle, play-action, motion, rpo, screen, ' +
      'sec/play) describes an OFFENSE. There is no defensive counterpart table.',
  )
}

async function depth() {
  heading('4. DepthChart — is there a defensive role signal?')
  const total = await prisma.depthChart.count()
  console.log(`rows: ${total}`)
  const positions = await prisma.depthChart.groupBy({
    by: ['position'],
    _count: { _all: true },
    orderBy: { _count: { position: 'desc' } },
    take: 30,
  })
  console.log('\npositions carried:')
  for (const p of positions) {
    const mark = isIdpPosition(p.position) ? ' <= IDP' : ''
    console.log(`  ${p.position.padEnd(10)} ${String(p._count._all).padStart(5)}${mark}`)
  }
  const one = await prisma.depthChart.findFirst({
    where: { position: { in: ['LB', 'DL', 'DB', 'CB', 'S', 'DE', 'DT'] } },
    select: { team: true, position: true, players: true, source: true, season: true },
  })
  console.log('\nsample defensive depth row:')
  console.log(one ? JSON.stringify(one).slice(0, 500) : '  NONE — no defensive depth chart rows exist')
}

async function main() {
  await statVocabulary()
  await coaching()
  await tendencies()
  await depth()
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e))
  .finally(() => prisma.$disconnect())
