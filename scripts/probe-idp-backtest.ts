/**
 * READ-ONLY walk-forward backtest of the IDP projector. Never writes.
 *
 * Three anecdotes are not a calibration. This projects each defender's week W using ONLY
 * games strictly before W, scores both the projection and what actually happened under one
 * fixed reference rulebook, and reports the error. Because the week being scored is never in
 * the training window, the number means something.
 *
 * It also sweeps the model's constants. Every one of them — the volume half-life, the rate
 * half-life, the shrinkage strength, whether to use snaps at all — was originally chosen by
 * argument. A half-life picked because it "feels right" is exactly the kind of invented number
 * the rest of this build refuses to ship, so they are measured against real outcomes here.
 */
import { PrismaClient } from '@prisma/client'

import { deriveCohortPriors } from '../lib/idp-projections/cohortPriors'
import { projectIdpStatLine } from '../lib/idp-projections/projectIdpStatLine'
import { isIdpPosition } from '../lib/core-app/scoringNotes'
import { computeLeagueProjectedPoints } from '../lib/projections/leagueScoring'
import type { IdpGameObservation } from '../lib/idp-projections/types'

const prisma = new PrismaClient()

/**
 * A representative tackle-heavy IDP rulebook, used ONLY as a common yardstick so every config
 * is measured identically. It is not any one league's settings.
 */
const REFERENCE_SCORING = {
  idp_tkl_solo: 2,
  idp_tkl_ast: 1,
  idp_sack: 6,
  idp_int: 6,
  idp_ff: 3,
  idp_fum_rec: 3,
  idp_pass_def: 3,
  idp_tkl_loss: 2,
  idp_qb_hit: 1,
  idp_def_td: 6,
}

const SEASON = 2025
const FIRST_WEEK = 8
const LAST_WEEK = 18

const CONFIGS: Array<{ label: string } & Record<string, unknown>> = [
  { label: 'snap rate17 k8 hl4', useSnapBasis: true },
  { label: 'game rate17 k8 hl4', useSnapBasis: false },
  { label: 'snap rate8  k8 hl4', useSnapBasis: true, rateHalfLifeWeeks: 8 },
  { label: 'snap rate34 k8 hl4', useSnapBasis: true, rateHalfLifeWeeks: 34 },
  { label: 'snap rate17 k4 hl4', useSnapBasis: true, regressionPriorGames: 4 },
  { label: 'snap rate17 k16 hl4', useSnapBasis: true, regressionPriorGames: 16 },
  { label: 'snap rate17 k8 hl3', useSnapBasis: true, halfLifeWeeks: 3 },
  { label: 'snap rate17 k8 hl6', useSnapBasis: true, halfLifeWeeks: 6 },
  { label: 'snap rate17 k8 hl10', useSnapBasis: true, halfLifeWeeks: 10 },
]

function score(line: Record<string, number> | null): number | null {
  if (!line) return null
  const r = computeLeagueProjectedPoints(line, REFERENCE_SCORING)
  return r ? r.points : null
}

function actualLine(statMap: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(statMap)) {
    if (k.startsWith('idp_') && typeof v === 'number') out[k] = v
  }
  return out
}

async function main() {
  const players = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', position: { in: ['LB', 'DE', 'DT', 'DB', 'CB', 'S', 'DL'] } },
    select: { sleeperId: true, position: true },
  })
  const posOf = new Map<string, string>()
  for (const p of players) {
    if (p.sleeperId && p.position && !posOf.has(p.sleeperId)) posOf.set(p.sleeperId, p.position)
  }
  const ids = [...posOf.keys()]
  console.log(`defender universe: ${ids.length}`)

  const games = await prisma.playerGameStat.findMany({
    where: { sportType: 'NFL', season: { in: [SEASON - 1, SEASON] }, playerId: { in: ids } },
    select: { playerId: true, season: true, weekOrRound: true, normalizedStatMap: true },
  })
  console.log(`game rows loaded: ${games.length}`)

  const byPlayer = new Map<string, IdpGameObservation[]>()
  for (const g of games) {
    const arr = byPlayer.get(g.playerId) ?? []
    arr.push({
      season: g.season,
      week: g.weekOrRound,
      opponent: null,
      statMap: g.normalizedStatMap as Record<string, unknown>,
    })
    byPlayer.set(g.playerId, arr)
  }
  for (const arr of byPlayer.values()) {
    arr.sort((a, b) => (a.season !== b.season ? a.season - b.season : a.week - b.week))
  }

  const priorsByPos = new Map<string, ReturnType<typeof deriveCohortPriors>>()
  for (const pos of new Set(posOf.values())) {
    const members = [...byPlayer.entries()]
      .filter(([id]) => posOf.get(id) === pos)
      .map(([, history]) => ({ position: pos, history }))
    priorsByPos.set(pos, deriveCohortPriors(pos, members))
  }

  const stats = CONFIGS.map(() => ({ n: 0, absErr: 0, signed: 0, sq: 0 }))
  let actualSum = 0
  let compared = 0

  for (const [id, history] of byPlayer) {
    const pos = posOf.get(id)!
    if (!isIdpPosition(pos)) continue
    const priors = priorsByPos.get(pos) ?? null

    for (let week = FIRST_WEEK; week <= LAST_WEEK; week++) {
      const target = history.find((h) => h.season === SEASON && h.week === week)
      if (!target) continue
      const train = history.filter((h) => h.season < SEASON || h.week < week)
      if (train.length < 6) continue

      const truth = score(actualLine(target.statMap))
      if (truth == null) continue

      CONFIGS.forEach((cfg, i) => {
        const out = projectIdpStatLine({ position: pos, history: train, priors, ...cfg })
        if (!out.ok) return
        const pred = score(out.statLine as Record<string, number>)
        if (pred == null) return
        const err = pred - truth
        const s = stats[i]
        s.n++
        s.absErr += Math.abs(err)
        s.signed += err
        s.sq += err * err
      })
      actualSum += truth
      compared++
    }
  }

  console.log(`\nplayer-weeks scored: ${compared}`)
  console.log(`mean ACTUAL points/week under the reference rulebook: ${(actualSum / compared).toFixed(2)}`)
  console.log('')
  console.log('config                    n      MAE     RMSE     bias')
  const rows = CONFIGS.map((cfg, i) => ({ label: cfg.label, ...stats[i] })).filter((r) => r.n > 0)
  for (const r of rows) {
    const bias = r.signed / r.n
    console.log(
      `${r.label.padEnd(22)} ${String(r.n).padStart(6)}  ${(r.absErr / r.n).toFixed(3)}  ` +
        `${Math.sqrt(r.sq / r.n).toFixed(3)}   ${(bias >= 0 ? '+' : '') + bias.toFixed(3)}`,
    )
  }
  const best = rows.slice().sort((a, b) => a.absErr / a.n - b.absErr / b.n)[0]
  console.log(`\nlowest MAE: ${best.label}`)
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
