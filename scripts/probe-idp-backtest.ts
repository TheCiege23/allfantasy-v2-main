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
import { readFileSync } from 'node:fs'
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

/**
 * Team-defense tendencies derived by `derive-team-defense-tendencies.ts`.
 *
 * Loaded from the JSON artifact rather than a table on purpose: whether these signals earn a
 * migration is the question this backtest exists to answer.
 */
type Tendency = {
  teamId: string
  season: number
  offensePassRate: number | null
  blitzRate: number | null
  /** Filled in from `TeamTendencySeason` at run time, not from the JSON artifact. */
  secPerPlayOffense?: number | null
}
const TENDENCIES: Tendency[] = JSON.parse(
  readFileSync(process.argv[2] ?? 'data/team-defense-tendencies.json', 'utf8'),
)
const tendencyBy = new Map<string, Tendency>()
for (const t of TENDENCIES) tendencyBy.set(`${t.teamId}|${t.season}`, t)
const meanOf = (season: number, pick: (t: Tendency) => number | null): number | null => {
  const vals = TENDENCIES.filter((t) => t.season === season)
    .map(pick)
    .filter((v): v is number => v != null && v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

const CONFIGS: Array<{
  label: string
  contextStrength?: number
  usePace?: boolean
} & Record<string, unknown>> = [
  { label: 'control (snap only)', useSnapBasis: true, contextStrength: 0 },
  { label: '+ opponent pace', useSnapBasis: true, contextStrength: 0, usePace: true },
  { label: '+ context x0.5', useSnapBasis: true, contextStrength: 0.5 },
  { label: '+ context x1.0', useSnapBasis: true, contextStrength: 1 },
  { label: '+ pace + ctx x0.5', useSnapBasis: true, contextStrength: 0.5, usePace: true },
  { label: 'per-game basis', useSnapBasis: false, contextStrength: 0 },
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
    select: {
      playerId: true,
      season: true,
      weekOrRound: true,
      opponent: true,
      team: true,
      normalizedStatMap: true,
    },
  })
  console.log(`game rows loaded: ${games.length}`)

  const byPlayer = new Map<string, IdpGameObservation[]>()
  const teamOf = new Map<string, string | null>()
  for (const g of games) {
    const arr = byPlayer.get(g.playerId) ?? []
    arr.push({
      season: g.season,
      week: g.weekOrRound,
      opponent: g.opponent ?? null,
      statMap: g.normalizedStatMap as Record<string, unknown>,
    })
    teamOf.set(`${g.playerId}|${g.season}|${g.weekOrRound}`, g.team ?? null)
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

  /*
   * Offensive pace by team, from the table the production path already reads. Included because
   * `opponentPace` is LIVE in `loadIdpProjections` and had never been measured — a shipped
   * adjustment that has not been shown to help is indistinguishable from one that hurts.
   */
  const paceRows = await prisma.teamTendencySeason.findMany({
    where: { season: SEASON },
    select: { teamId: true, secPerPlay: true },
  })
  for (const r of paceRows) {
    const key = `${r.teamId.toUpperCase()}|${SEASON}`
    const t = tendencyBy.get(key)
    if (t) (t as any).secPerPlayOffense = r.secPerPlay
  }
  const paceVals = paceRows
    .map((r) => r.secPerPlay)
    .filter((v): v is number => v != null && v > 0)
  const meanSecPerPlay = paceVals.length
    ? paceVals.reduce((a, b) => a + b, 0) / paceVals.length
    : null
  console.log(`offensive pace rows: ${paceRows.length}, league mean ${meanSecPerPlay?.toFixed(2)}`)

  const meanPassRate = meanOf(SEASON, (t) => t.offensePassRate)
  const meanBlitzRate = meanOf(SEASON, (t) => t.blitzRate)
  console.log(
    `league means ${SEASON}: pass rate ${meanPassRate?.toFixed(3)}, blitz rate ${meanBlitzRate?.toFixed(3)}`,
  )
  console.log(`tendency rows loaded: ${TENDENCIES.length}`)

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

      /*
       * Context for the TARGET week, built from the opponent that week and the player's own
       * team. Season-level tendencies are used for both; a week-level split would leak, since
       * a season aggregate that includes week W is not knowable before week W is played.
       */
      const ownTeam = teamOf.get(`${id}|${SEASON}|${week}`) ?? null
      const oppT = target.opponent ? tendencyBy.get(`${target.opponent}|${SEASON}`) : undefined
      const ownT = ownTeam ? tendencyBy.get(`${ownTeam}|${SEASON}`) : undefined
      const context = {
        opponentPassRate: oppT?.offensePassRate ?? null,
        leagueMeanPassRate: meanPassRate,
        ownBlitzRate: ownT?.blitzRate ?? null,
        leagueMeanBlitzRate: meanBlitzRate,
      }

      const oppPace =
        oppT?.secPerPlayOffense != null && meanSecPerPlay != null
          ? { secPerPlay: oppT.secPerPlayOffense, leagueMeanSecPerPlay: meanSecPerPlay }
          : null

      CONFIGS.forEach((cfg, i) => {
        const { contextStrength, usePace, ...rest } = cfg
        const out = projectIdpStatLine({
          position: pos,
          history: train,
          priors,
          context: { ...context, strength: contextStrength ?? 0 },
          opponentPace: usePace ? oppPace : null,
          ...rest,
        })
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
