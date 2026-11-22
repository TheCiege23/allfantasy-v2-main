/**
 * Simulate full snake drafts with every team drafting through the ONE draft engine, once per
 * replacement-value mode (DRAFT_VORP_MODE off | observe | active), and print how the drafts come out.
 *
 *   npx tsx scripts/simulate-draft-vorp-modes.ts            # 12 teams, 14 rounds, PPR-shaped roster
 *   npx tsx scripts/simulate-draft-vorp-modes.ts --teams=16 --rounds=11
 *   npx tsx scripts/simulate-draft-vorp-modes.ts --synthetic-projections
 *
 * --synthetic-projections gives every player a season projection from a per-position curve over his
 * rank WITHIN the position (QB 380−6r, RB 300−7r, WR 290−5r, TE 220−8r, K 150−2r, floored), so the
 * projection half of replacement value runs too. The curve is a stand-in shaped like a PPR season,
 * not data; it checks that the projection path does not break roster construction.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT. Real ADP (the Sleeper column of
 * data/nfl-adp-multiplatform.csv) with NO projections — so only the tier-cliff half of replacement
 * value is exercised, which is the half every surface without projections uses (the Decision OS card,
 * Chimmy). It is a SANITY check: does active mode build complete, sane rosters without wild reaches?
 * It cannot say active mode picks BETTER — that needs real outcomes (lib/shared-services/draft/backtest).
 * No database, no network.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeDraftRecommendation, type RecommendationPlayer, type VorpMode } from '../lib/draft-helper/RecommendationEngine'

type Args = { teams: number; rounds: number; projections: boolean }
function parseArgs(): Args {
  const get = (k: string, d: number) => {
    const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
    const n = hit ? Number(hit.split('=')[1]) : d
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return { teams: get('teams', 12), rounds: get('rounds', 14), projections: process.argv.includes('--synthetic-projections') }
}

const STARTERS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K']
const FLEX_OK = new Set(['RB', 'WR', 'TE'])

const CURVE: Record<string, [number, number]> = { QB: [380, 6], RB: [300, 7], WR: [290, 5], TE: [220, 8], K: [150, 2] }

function withSyntheticProjections(pool: RecommendationPlayer[]): RecommendationPlayer[] {
  const rank: Record<string, number> = {}
  return pool.map((p) => {
    const r = (rank[p.position] = (rank[p.position] ?? 0) + 1)
    const [base, step] = CURVE[p.position] ?? [100, 2]
    return { ...p, projectedPoints: Math.max(40, base - step * (r - 1)) }
  })
}

function loadPool(): RecommendationPlayer[] {
  const raw = readFileSync(join(process.cwd(), 'data/nfl-adp-multiplatform.csv'), 'utf8').replace(/^﻿/, '')
  const rows = raw.split(/\r?\n/).slice(2)
  const out: RecommendationPlayer[] = []
  for (const line of rows) {
    const c = line.split(',')
    const position = c[3]?.trim()
    const adp = Number(c[5])
    if (!c[1] || !position || !['QB', 'RB', 'WR', 'TE', 'K'].includes(position) || !Number.isFinite(adp) || adp <= 0) continue
    out.push({ name: c[1].trim(), team: c[2]?.trim() || null, position, adp })
  }
  return out.sort((a, b) => (a.adp as number) - (b.adp as number)).slice(0, 400)
}

/** Fill the starting lineup greedily from a roster's positions; returns how many starter slots stay empty. */
function emptyStarters(positions: string[]): number {
  const left = [...positions]
  let empty = 0
  for (const slot of STARTERS) {
    const idx = slot === 'FLEX' ? left.findIndex((p) => FLEX_OK.has(p)) : left.indexOf(slot)
    if (idx === -1) empty++
    else left.splice(idx, 1)
  }
  return empty
}

function simulate(mode: VorpMode, args: Args) {
  const pool = args.projections ? withSyntheticProjections(loadPool()) : loadPool()
  const available = [...pool]
  const rosters: Array<Array<{ position: string; team: string | null; adp: number; pick: number }>> = Array.from(
    { length: args.teams },
    () => [],
  )
  for (let overall = 1; overall <= args.teams * args.rounds; overall++) {
    const round = Math.ceil(overall / args.teams)
    const inRound = ((overall - 1) % args.teams) + 1
    const team = round % 2 === 1 ? inRound - 1 : args.teams - inRound
    const result = computeDraftRecommendation({
      available,
      teamRoster: rosters[team]!.map((p) => ({ position: p.position, team: p.team })),
      rosterSlots: STARTERS,
      round,
      pick: inRound,
      totalTeams: args.teams,
      sport: 'NFL',
      scoringFormat: 'ppr',
      mode: 'needs',
      vorpMode: mode,
    })
    const chosen = result.recommendation?.player ?? available[0]!
    const idx = available.indexOf(chosen)
    available.splice(idx === -1 ? 0 : idx, 1)
    rosters[team]!.push({ position: chosen.position, team: chosen.team ?? null, adp: Number(chosen.adp), pick: overall })
  }

  const all = rosters.flat()
  const reach = all.map((p) => p.pick - p.adp) // negative = taken before ADP
  const bigReaches = reach.filter((d) => d < -24).length
  const meanAbs = reach.reduce((s, d) => s + Math.abs(d), 0) / all.length
  const incomplete = rosters.filter((r) => emptyStarters(r.map((p) => p.position)) > 0).length
  const earlyK = all.filter((p) => p.position === 'K' && p.pick <= args.teams * (args.rounds - 3)).length
  // Value proxy only for comparing modes against each other: the ADP rank of each team's starters.
  const starterAdp = rosters.map((r) => {
    const sorted = [...r].sort((a, b) => a.adp - b.adp)
    const left = [...sorted]
    let sum = 0
    for (const slot of STARTERS) {
      const i = slot === 'FLEX' ? left.findIndex((p) => FLEX_OK.has(p.position)) : left.findIndex((p) => p.position === slot)
      if (i === -1) {
        sum += 400
        continue
      }
      sum += left[i]!.adp
      left.splice(i, 1)
    }
    return sum
  })
  const posMix = ['QB', 'RB', 'WR', 'TE', 'K'].map((pos) => `${pos} ${all.filter((p) => p.position === pos).length}`).join(' · ')
  return {
    mode,
    incompleteLineups: `${incomplete}/${args.teams}`,
    meanAbsPickMinusAdp: Number(meanAbs.toFixed(1)),
    reachesOver24: bigReaches,
    kickersBeforeLast3Rounds: earlyK,
    meanStarterAdpSum: Number((starterAdp.reduce((a, b) => a + b, 0) / starterAdp.length).toFixed(1)),
    worstStarterAdpSum: Math.max(...starterAdp),
    positionMix: posMix,
  }
}

const args = parseArgs()
const results = (['off', 'observe', 'active'] as VorpMode[]).map((m) => simulate(m, args))
console.log(`Simulated ${args.teams}-team, ${args.rounds}-round snake drafts (real ADP, ${args.projections ? 'SYNTHETIC projections' : 'no projections'}):`)
console.table(results)
console.log(JSON.stringify(results))
