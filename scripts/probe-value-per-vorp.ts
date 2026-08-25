/**
 * READ-ONLY. What is one point of value-over-replacement worth in market units? Never writes.
 *
 * The Player Value Ledger's model is
 *   value(player, league, counterparty) = market_baseline x league_fit x ...
 * and for an individual defender the market baseline does not exist — FantasyCalc prices no
 * IDP. So an IDP value has no anchor, and any scale invented for it is exactly the kind of
 * made-up number the rest of this build refuses.
 *
 * Offensive players have BOTH: a FantasyCalc price and, through the same replacement-level
 * machinery, a value over replacement measured in this league's own points. That pair is an
 * exchange rate. This measures its shape so the functional form is chosen from data rather
 * than assumed to be linear.
 */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring, isIdpPosition } from '../lib/core-app/scoringNotes'
import { computeLeagueProjectedPoints, extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()

/** Which offensive groups can fill a slot. Mirrors the IDP eligibility map's intent. */
const OFF_SLOT: Record<string, readonly string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  WRRB_WRT: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
}

function rosterSlots(settings: unknown): string[] {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw =
    (s.roster_positions as unknown) ??
    (s.rosterPositions as unknown) ??
    ((s.rosterSettings as Record<string, unknown> | undefined)?.roster_positions as unknown)
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : []
}

/** Replacement level for offensive groups, by the same simulated draft the IDP module uses. */
function offensiveReplacement(
  players: Array<{ id: string; group: string; points: number }>,
  slots: string[],
  numTeams: number,
): Record<string, number | null> {
  const groups = ['QB', 'RB', 'WR', 'TE']
  const byGroup: Record<string, Array<{ id: string; points: number }>> = {
    QB: [], RB: [], WR: [], TE: [],
  }
  for (const p of players) {
    if (byGroup[p.group]) byGroup[p.group].push({ id: p.id, points: p.points })
  }
  for (const g of groups) byGroup[g].sort((a, b) => b.points - a.points)

  const taken: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  let flexSlots: string[][] = []
  for (const raw of slots) {
    const elig = OFF_SLOT[raw]
    if (!elig) continue
    if (elig.length === 1) taken[elig[0]] += numTeams
    else flexSlots.push([...elig])
  }
  for (const g of groups) taken[g] = Math.min(byGroup[g].length, taken[g])

  for (const elig of flexSlots) {
    for (let i = 0; i < numTeams; i++) {
      let best: string | null = null
      let bestPts = -Infinity
      for (const g of elig) {
        const next = byGroup[g][taken[g]]
        if (next && next.points > bestPts) {
          bestPts = next.points
          best = g
        }
      }
      if (!best) break
      taken[best]++
    }
  }

  const out: Record<string, number | null> = {}
  for (const g of groups) out[g] = byGroup[g][taken[g]]?.points ?? null
  return out
}

async function main() {
  const at = await prisma.fantasyProjection.findFirst({
    where: { source: { not: 'allfantasy' } },
    orderBy: [{ season: 'desc' }, { week: 'desc' }],
    select: { season: true, week: true },
  })
  if (!at) return console.log('no vendor projections')
  console.log(`projection feed ${at.season} wk${at.week}`)

  const leagues = (
    await prisma.league.findMany({ select: { id: true, name: true, settings: true } })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))

  /** Every (vorp, fcValue) pair we can observe, pooled across leagues. */
  const pairs: Array<{ league: string; group: string; vorp: number; value: number; name: string }> = []

  for (const league of leagues) {
    const scoring = extractScoringSettings(league.settings)!
    const slots = rosterSlots(league.settings)
    const isSuperflex = slots.some((s) => s === 'SUPER_FLEX' || s === 'SUPERFLEX' || s === 'QB2')

    const rosters = await prisma.roster.findMany({
      where: { leagueId: league.id },
      select: { playerData: true },
    })
    const numTeams = rosters.length
    if (numTeams === 0) continue

    const ids = new Set<string>()
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      for (const k of ['starters', 'players']) {
        const arr = pd[k]
        if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v !== '0') ids.add(v)
      }
    }

    const rows = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: [...ids] } },
      select: { sleeperId: true, name: true, position: true },
    })
    const seen = new Set<string>()
    const roster: Array<{ id: string; name: string; pos: string }> = []
    for (const p of rows) {
      if (!p.sleeperId || seen.has(p.sleeperId) || !p.position) continue
      seen.add(p.sleeperId)
      roster.push({ id: p.sleeperId, name: p.name, pos: p.position.toUpperCase() })
    }

    const projRows = await prisma.fantasyProjection.findMany({
      where: {
        playerId: { in: roster.map((r) => r.id) },
        season: at.season,
        week: at.week,
        source: { not: 'allfantasy' },
      },
      select: { playerId: true, stats: true },
    })
    const ppgById = new Map<string, number>()
    for (const r of projRows) {
      const outer = (r.stats ?? {}) as Record<string, unknown>
      const inner = outer.stats
      if (!inner || typeof inner !== 'object') continue
      const scored = computeLeagueProjectedPoints(inner as Record<string, unknown>, scoring)
      if (scored) ppgById.set(r.playerId, scored.points)
    }

    const offensive = roster
      .filter((r) => ['QB', 'RB', 'WR', 'TE'].includes(r.pos) && !isIdpPosition(r.pos))
      .map((r) => ({ id: r.id, group: r.pos, points: ppgById.get(r.id) ?? NaN }))
      .filter((r) => Number.isFinite(r.points))
    if (offensive.length < 40) continue

    const replacement = offensiveReplacement(offensive, slots, numTeams)

    const fc = await prisma.playerValueSnapshot.findMany({
      where: {
        sleeperId: { in: offensive.map((o) => o.id) },
        source: 'FANTASYCALC',
        format: 'REDRAFT',
        qbFormat: isSuperflex ? 'SUPERFLEX' : 'ONE_QB',
      },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, value: true, capturedAt: true },
    })
    const valueById = new Map<string, number>()
    for (const v of fc) if (!valueById.has(v.sleeperId)) valueById.set(v.sleeperId, v.value)

    const nameOf = new Map(roster.map((r) => [r.id, r.name]))
    for (const o of offensive) {
      const rep = replacement[o.group]
      const val = valueById.get(o.id)
      if (rep == null || val == null) continue
      const vorp = o.points - rep
      if (vorp <= 0) continue
      pairs.push({
        league: league.name ?? league.id,
        group: o.group,
        vorp,
        value: val,
        name: nameOf.get(o.id) ?? o.id,
      })
    }
  }

  console.log(`\npositive-VORP offensive observations with a FantasyCalc price: ${pairs.length}`)
  if (pairs.length < 30) return console.log('too few to fit')

  // ── ratio, and how stable it is ────────────────────────────────────────────────────
  const ratios = pairs.map((p) => p.value / p.vorp).sort((a, b) => a - b)
  const q = (f: number) => ratios[Math.floor(f * (ratios.length - 1))]
  console.log(`value per point of VORP — median ${q(0.5).toFixed(0)}, IQR ${q(0.25).toFixed(0)}..${q(0.75).toFixed(0)}`)

  // ── power fit in log space: value = a * vorp^b ─────────────────────────────────────
  const xs = pairs.map((p) => Math.log(p.vorp))
  const ys = pairs.map((p) => Math.log(p.value))
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const b = sxy / sxx
  const a = Math.exp(my - b * mx)
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const pred = Math.log(a) + b * xs[i]
    ssRes += (ys[i] - pred) ** 2
    ssTot += (ys[i] - my) ** 2
  }
  console.log(`power fit: value = ${a.toFixed(1)} * vorp^${b.toFixed(3)}   R2(log) = ${(1 - ssRes / ssTot).toFixed(3)}`)

  // Linear-through-origin, for comparison.
  let num = 0
  let den = 0
  for (const p of pairs) {
    num += p.value * p.vorp
    den += p.vorp * p.vorp
  }
  console.log(`linear through origin: value = ${(num / den).toFixed(0)} * vorp`)

  console.log('\nby position group (median value per VORP point):')
  for (const g of ['QB', 'RB', 'WR', 'TE']) {
    const sub = pairs.filter((p) => p.group === g).map((p) => p.value / p.vorp).sort((x, y) => x - y)
    if (sub.length < 5) continue
    console.log(`  ${g}  n=${String(sub.length).padStart(4)}  median ${sub[Math.floor(sub.length / 2)].toFixed(0)}`)
  }

  /* Per position, and de-duplicated to one observation per player: the pooled fit above
   * mixes positions whose medians differ by 2.4x and counts a player once per league he is
   * rostered in, both of which distort it. */
  console.log('')
  console.log('per-position fit, one observation per player (best VORP kept):')
  for (const g of ['QB', 'RB', 'WR', 'TE']) {
    const byPlayer = new Map<string, { vorp: number; value: number }>()
    for (const pr of pairs) {
      if (pr.group !== g) continue
      const cur = byPlayer.get(pr.name)
      if (!cur || pr.vorp > cur.vorp) byPlayer.set(pr.name, { vorp: pr.vorp, value: pr.value })
    }
    const obs = [...byPlayer.values()]
    if (obs.length < 15) continue
    const lx = obs.map((o) => Math.log(o.vorp))
    const ly = obs.map((o) => Math.log(o.value))
    const k = obs.length
    const ax = lx.reduce((t, v) => t + v, 0) / k
    const ay = ly.reduce((t, v) => t + v, 0) / k
    let sxy2 = 0, sxx2 = 0, syy2 = 0
    for (let i = 0; i < k; i++) {
      sxy2 += (lx[i] - ax) * (ly[i] - ay)
      sxx2 += (lx[i] - ax) ** 2
      syy2 += (ly[i] - ay) ** 2
    }
    const rr = sxy2 / Math.sqrt(sxx2 * syy2)
    const rank = (arr: number[]) => {
      const idx = arr.map((v, i) => [v, i] as const).slice().sort((m, n2) => m[0] - n2[0])
      const o2: number[] = new Array(arr.length)
      idx.forEach(([, i], j) => (o2[i] = j))
      return o2
    }
    const rx = rank(obs.map((o) => o.vorp))
    const ry = rank(obs.map((o) => o.value))
    const mr = (k - 1) / 2
    let cs = 0, vx = 0, vy = 0
    for (let i = 0; i < k; i++) {
      cs += (rx[i] - mr) * (ry[i] - mr)
      vx += (rx[i] - mr) ** 2
      vy += (ry[i] - mr) ** 2
    }
    const rho = cs / Math.sqrt(vx * vy)
    console.log(`  ${g}  n=${String(k).padStart(4)}  R2(log)=${(rr * rr).toFixed(3)}  spearman=${rho.toFixed(3)}`)
  }

  console.log('\nspot checks (highest VORP):')
  for (const p of pairs.slice().sort((x, y) => y.vorp - x.vorp).slice(0, 8)) {
    console.log(
      `  ${p.group} ${p.name.padEnd(22)} vorp ${p.vorp.toFixed(2).padStart(6)}  fc ${String(p.value).padStart(6)}  ` +
        `implied ${(a * Math.pow(p.vorp, b)).toFixed(0)}`,
    )
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
