import 'server-only'

import { getMyTeamData, type LineupPlayer, type LineupSlot, type MyTeamData } from '@/lib/core-app/myTeam'
import { optimizeLineup, type LineupOptimization } from '@/lib/decision-os/lineup/bestLineup'
import { BENCH_SWAP_POINTS } from '@/lib/core-app/rosterSlots'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type { ChatStartCall } from './tools/chimmyTools'
import { loadBenchCalibration } from '@/lib/decision-os/lineup/benchCalibrationStore'
import { BENCH_EDGE_LABEL, BENCH_SHARE_LABEL, benchCallRecord, benchEdgeScaleFor, type BenchCalibration } from '@/lib/decision-os/lineup/benchCalibration'

/**
 * ONE START/SIT ANSWER: Chimmy reads My Team's (Lineup OS, 2026-11-16 re-score item 6).
 *
 * 🛑 CHIMMY COULD DISAGREE WITH THE MY TEAM SCREEN. My Team's "best lineup" is `optimizeLineup`
 * (`lib/decision-os/lineup/bestLineup.ts`): the exact optimizer on `afProjectedPoints` — AllFantasy's projection
 * under this league's scoring — with a bye or ruled-out player a guaranteed 0 and a kicked-off player locked.
 * Chimmy's lineup tools priced the vendor's weekly line and filled the lineup greedily, so the same roster on the
 * same Sunday could get one answer on the screen and another in chat. Both tools now read My Team's own result.
 *
 * EVERY SPORT WHERE MY TEAM HAS AN ANSWER (2026-11-20 re-score push). This was NFL-only, and the re-score found the
 * cost: My Team runs `optimizeLineup` for every sport, so an NCAAF, NBA, MLB or NHL points league saw one best lineup
 * on the screen and a different one from Chimmy's season-baseline optimizer in chat. Now:
 *   - NFL: always My Team's answer — including "My Team has no best lineup right now, and why".
 *   - Every other sport: My Team's answer whenever My Team itself computed a best lineup. When it did not (a
 *     category league, a lineup My Team cannot price), this steps aside exactly as before and Chimmy's own
 *     comparison answers (`otherSportStartSit.ts`), which handles the category leagues the optimizer does not.
 *
 * ⚠ A FALLBACK IS SAID OUT LOUD. When My Team cannot load at all (no claimed team, a failed read), the caller
 * uses the weekly-feed tool and the block says the answer did not come from My Team.
 *
 * AllFantasy never sets a lineup: this explains My Team's recommendation; the user makes the move.
 */

export type MyTeamLineupDeps = {
  load: (leagueId: string, userId: string) => Promise<MyTeamData | null>
  /** The bench check's graded record (2026-11-21): said beside a one-swap verdict, never changing it. */
  calibration: (league: { sport: string | null | undefined; platform: string | null | undefined }) => Promise<BenchCalibration | null>
}

/*
 * ONE MY TEAM LOAD PER TURN (2026-11-20). A lineup question now asks for this answer twice: the grounding packet's
 * `myTeamLineup` slice and the lineup tool the model calls. Both read through here, so the load is shared for a
 * minute per (league, user): the second caller gets the same data rather than paying for My Team again. The text is
 * still rebuilt per caller (it is cheap), so the tool's ledger callback runs exactly as before. A failed load is not
 * kept.
 */
const LOAD_TTL_MS = 60_000
const LOAD_MAX = 200
const loads = new Map<string, { at: number; p: Promise<MyTeamData | null> }>()
function loadShared(leagueId: string, userId: string): Promise<MyTeamData | null> {
  const key = `${leagueId}:${userId}`
  const now = Date.now()
  const hit = loads.get(key)
  if (hit && now - hit.at < LOAD_TTL_MS) return hit.p
  if (loads.size >= LOAD_MAX) loads.delete(loads.keys().next().value!)
  const p = getMyTeamData(leagueId, userId)
  loads.set(key, { at: now, p })
  p.catch(() => loads.delete(key))
  return p
}
/** Test hook. */
export function __resetMyTeamLoadsForTests(): void {
  loads.clear()
}

const defaultDeps: MyTeamLineupDeps = { load: (leagueId, userId) => loadShared(leagueId, userId), calibration: loadBenchCalibration }

const BENCH_SHOWN = 6

/** The value My Team prices a player at: 0 for a bye or a ruled-out player, else AllFantasy's league projection. */
function valueOf(p: LineupPlayer): number | null {
  if (p.onBye || p.ruledOut) return 0
  return p.afProjectedPoints
}

const pts = (n: number | null) => (n == null ? 'no projection' : `${Math.round(n * 10) / 10} pts`)

function flags(p: LineupPlayer, now: number): string {
  const out: string[] = []
  if (p.onBye) out.push('BYE')
  if (p.ruledOut) out.push('OUT')
  else if (p.injuryStatus) out.push(p.injuryStatus)
  if (p.kickoff instanceof Date && p.kickoff.getTime() <= now) out.push('game started — locked')
  return out.length ? ` [${out.join(', ')}]` : ''
}

/**
 * Why the My Team answer stepped aside: `not_nfl` is by design — a non-NFL league for which My Team computed no best
 * lineup (a category league, an unpriced lineup), so the sport's own tool answers; `no_my_team` means My Team could
 * not load this lineup, which the caller must say out loud.
 */
export type MyTeamFallback = { fallback: 'not_nfl' | 'no_my_team' }

/** The My Team payload Chimmy answers from, or why it steps aside (see the header). */
async function loadMyTeam(args: { leagueId: string; userId: string }, d: MyTeamLineupDeps): Promise<MyTeamData | MyTeamFallback> {
  const data = await d.load(args.leagueId, args.userId).catch(() => null)
  if (!data) return { fallback: 'no_my_team' }
  const sport = String(data.league.sport ?? 'NFL').toUpperCase()
  if (sport === 'NFL') return data
  return data.lineupOptimizer ? data : { fallback: 'not_nfl' }
}

const isFallback = (x: MyTeamData | MyTeamFallback): x is MyTeamFallback => 'fallback' in x

/**
 * My Team's best lineup, re-run at the moment of ANSWERING (2026-11-20 re-score).
 *
 * 🛑 THE SHARED LOAD IS UP TO 60 SECONDS OLD, AND SO WAS ITS VERDICT. `getMyTeamData` runs the optimizer with the clock
 * of the load (`adviceAt`), and the load is shared for a minute (`loadShared`). The "locked" flags below are drawn with
 * the clock of the answer. So in the minute a game kicks off — when the question is asked most — the block could say
 * "start X instead of Y" while labelling X or Y "game started — locked". The optimizer is pure and cheap, so it runs
 * again here over the same starters and bench with the same clock the flags use: one answer, one moment.
 * No answer at load time (best ball, no starters, an unpriced seat) stays no answer.
 */
function optimizationAt(data: MyTeamData, now: number): LineupOptimization | null {
  if (!data.lineupOptimizer) return null
  return optimizeLineup({
    starters: data.starters.available ? data.starters.data : [],
    bench: data.bench.available ? data.bench.data : [],
    sport: data.league.sport ?? null,
    bestBall: Boolean(data.league.bestBall),
    now: new Date(now),
  })
}

function weekOf(data: MyTeamData): string {
  const p = data.projections
  return p && p.available ? `week ${p.data.week}, ${p.data.season}` : 'this week'
}

/** Why My Team has no best lineup to give, in its own words where it has them. */
function noAnswerReason(data: MyTeamData): string {
  if (data.bestBall || data.league.bestBall) return 'this is a best-ball league: the lineup is set automatically each week, so there is nothing to set'
  if (!data.starters.available) return data.starters.reason
  if (data.projections && !data.projections.available) return data.projections.reason
  return 'a starter has no projection this week or could not be identified, so no honest total exists'
}

/** The best lineup after My Team's changes: slot index → player id. */
function bestSeats(starters: readonly LineupSlot[], bench: readonly LineupPlayer[], opt: LineupOptimization): Set<string> {
  const ids = new Set(starters.flatMap((s) => (s.player ? [s.player.sleeperId] : [])))
  if (opt.state === 'improve') {
    const byName = new Map([...starters.flatMap((s) => (s.player ? [s.player] : [])), ...bench].map((p) => [p.name, p.sleeperId]))
    for (const c of opt.changes) {
      const outId = c.outName ? byName.get(c.outName) : undefined
      if (outId) ids.delete(outId)
      const inId = byName.get(c.inName)
      if (inId) ids.add(inId)
    }
  }
  return ids
}

/**
 * "Is my lineup right?" — My Team's whole-lineup answer as a prompt block, or why it stepped aside.
 */
export async function buildMyTeamLineupContext(
  args: {
    leagueId: string
    userId: string
    now?: Date
    /** Told the call when the answer is exactly one swap — the same rule as the weekly-feed tool. */
    onStartCall?: (call: ChatStartCall) => void
  },
  deps: Partial<MyTeamLineupDeps> = {},
): Promise<string | MyTeamFallback> {
  const d: MyTeamLineupDeps = { ...defaultDeps, ...deps }
  const data = await loadMyTeam(args, d)
  if (isFallback(data)) return data
  const now = (args.now ?? new Date()).getTime()
  const starters = data.starters.available ? data.starters.data : []
  const bench = data.bench.available ? data.bench.data : []
  const opt = optimizationAt(data, now)

  const lines = [
    `BEST LINEUP for ${data.league.name} (${weekOf(data)}) — THE SAME ANSWER THE MY TEAM SCREEN SHOWS: the exact lineup optimizer on AllFantasy projections under this league's scoring. A bye or ruled-out player counts 0; a player whose game has started is locked.`,
  ]
  if (!opt) {
    lines.push(`My Team has no best lineup to give right now: ${noAnswerReason(data)}. Say so; do not build a lineup of your own.`)
  } else if (opt.state === 'optimal') {
    lines.push(
      `Verdict: the current lineup is already the best one — ${pts(opt.currentTotal)} projected.` +
        (opt.lockedSeats ? ` ${opt.lockedSeats} seat(s) are locked (game started) and were left as they are.` : ''),
    )
  } else {
    lines.push(
      `Verdict: ${opt.verdict === 'swap' ? 'CHANGE THE LINEUP' : `CLOSE CALL — the gain is under ${BENCH_SWAP_POINTS} points, inside projection noise; say it is close`}. ` +
        `Current ${pts(opt.currentTotal)}, best ${pts(opt.bestTotal)} (+${opt.gain}).` +
        (opt.lockedSeats ? ` ${opt.lockedSeats} locked seat(s) left as they are.` : ''),
    )
    for (const c of opt.changes) {
      lines.push(`- ${c.slotLabel}: start ${c.inName} (${pts(c.inProjected)}) instead of ${c.outName ? `${c.outName} (${pts(c.outProjected)})` : 'the empty seat'}.`)
    }
    // One clear swap is a start/sit call worth grading later (the advice ledger); a reshuffle or a close call is not.
    const p = data.projections
    const only = opt.changes.length === 1 ? opt.changes[0]! : null
    /*
     * The bench check's own graded record for one swap of this size (2026-11-21, `decision-os/lineup/benchCalibration.ts`)
     * — the same record My Team shows beside its bench check. It is said beside the verdict and never changes it.
     */
    const edge =
      opt.verdict === 'swap' && only?.outName && typeof only.inProjected === 'number' && typeof only.outProjected === 'number'
        ? only.inProjected - only.outProjected
        : null
    if (edge != null) {
      const calibration = await Promise.resolve()
        .then(() => d.calibration({ sport: data.league.sport ?? null, platform: data.league.platform ?? null }))
        .catch(() => null)
      const record = benchCallRecord(edge, calibration, {
        scale: benchEdgeScaleFor(data.league.sport ?? null),
        starterProjected: typeof only?.outProjected === 'number' ? only.outProjected : null,
      })
      if (record) {
        const size = record.scale === 'share' ? BENCH_SHARE_LABEL[record.band] : BENCH_EDGE_LABEL[record.band]
        lines.push(
          `How My Team's bench calls like this have held up: swaps with an edge of ${size} were right ${record.rightPct}% of ${record.decided} graded calls` +
            (record.level === 'low' ? ' — closer than the projections suggest; say this call is closer than it looks.' : '.') +
            ' Quote these numbers if asked how sure this is; never call the swap certain.',
        )
      }
    }
    if (args.onStartCall && opt.verdict === 'swap' && only?.outName && p && p.available) {
      const idOf = (name: string) => [...starters.flatMap((s) => (s.player ? [s.player] : [])), ...bench].find((x) => x.name === name)?.sleeperId
      const recId = idOf(only.inName)
      const altId = idOf(only.outName)
      const season = Number(p.data.season)
      if (recId && altId && Number.isInteger(season)) {
        args.onStartCall({ leagueId: args.leagueId, season, week: p.data.week, rec: { key: recId, name: only.inName }, alt: { key: altId, name: only.outName }, slot: only.slotLabel })
      }
    }
  }
  if (starters.length) {
    lines.push('Starters now:')
    for (const s of starters) {
      lines.push(s.player ? `  ${s.slotLabel}: ${s.player.name} (${s.player.position ?? '?'}) ${pts(valueOf(s.player))}${flags(s.player, now)}` : `  ${s.slotLabel}: EMPTY`)
    }
  }
  const benchShown = [...bench].sort((a, b) => (valueOf(b) ?? -1) - (valueOf(a) ?? -1)).slice(0, BENCH_SHOWN)
  if (benchShown.length) {
    lines.push(`Bench (top ${benchShown.length} by projection): ` + benchShown.map((p) => `${p.name} (${p.position ?? '?'}) ${pts(valueOf(p))}${flags(p, now)}`).join('; ') + '.')
  }
  lines.push(
    'RULES: this is the My Team recommendation; never recommend a different lineup or quote different numbers. AllFantasy never sets the lineup — the user makes the change (a confirm card may offer it).',
  )
  return lines.join('\n')
}

/**
 * "Start A or B?" — answered from My Team's best lineup, so it can never contradict the lineup screen. Steps aside
 * when My Team has no NFL lineup, or a name is not on this roster (the caller then uses the scenario tool).
 */
export async function buildMyTeamStartSitContext(
  args: { leagueId: string; userId: string; players: [string, string]; now?: Date; onStartCall?: (call: ChatStartCall) => void },
  deps: Partial<MyTeamLineupDeps> = {},
): Promise<string | MyTeamFallback> {
  const d: MyTeamLineupDeps = { ...defaultDeps, ...deps }
  const data = await loadMyTeam(args, d)
  if (isFallback(data)) return data
  const starters = data.starters.available ? data.starters.data : []
  const bench = data.bench.available ? data.bench.data : []
  const everyone = [...starters.flatMap((s) => (s.player ? [s.player] : [])), ...bench]
  const find = (name: string) => {
    const key = normalizePlayerName(name)
    const hits = everyone.filter((p) => normalizePlayerName(p.name) === key)
    return hits.length === 1 ? hits[0]! : null
  }
  const a = find(args.players[0])
  const b = find(args.players[1])
  // A name not on this roster is the scenario tool's question to answer (it says so); not a My Team failure.
  if (!a || !b || a.sleeperId === b.sleeperId) return { fallback: 'not_nfl' }

  const opt = optimizationAt(data, (args.now ?? new Date()).getTime())
  const head = `START/SIT: ${a.name} or ${b.name} (${weekOf(data)}) — FROM MY TEAM'S BEST LINEUP, the same answer the My Team screen shows (AllFantasy projections under this league's scoring).`
  const line = (p: LineupPlayer) => `${p.name} (${p.position ?? '?'}): ${pts(valueOf(p))}${flags(p, (args.now ?? new Date()).getTime())}`
  if (!opt) {
    return [head, line(a), line(b), `My Team cannot decide this right now: ${noAnswerReason(data)}. Say so; do not pick one yourself.`].join('\n')
  }
  const best = bestSeats(starters, bench, opt)
  const inA = best.has(a.sleeperId)
  const inB = best.has(b.sleeperId)
  const va = valueOf(a)
  const vb = valueOf(b)
  let verdict: string
  let pick: LineupPlayer | null = null
  if (inA && inB) verdict = 'BOTH START — both are in the best lineup; this is not an either/or this week.'
  else if (!inA && !inB) verdict = 'NEITHER STARTS — neither is in the best lineup; other players outscore both for these seats.'
  else {
    pick = inA ? a : b
    const other = pick === a ? b : a
    const gap = va != null && vb != null ? Math.abs(va - vb) : null
    verdict =
      `START ${pick.name} over ${other.name}` +
      (gap != null ? ` (${Math.round(gap * 10) / 10} pts${gap < BENCH_SWAP_POINTS ? ` — CLOSE CALL, under ${BENCH_SWAP_POINTS} points; say it is close` : ''})` : '') +
      '.'
  }
  const p = data.projections
  if (pick && args.onStartCall && p && p.available) {
    const season = Number(p.data.season)
    const other = pick === a ? b : a
    if (Number.isInteger(season)) {
      args.onStartCall({ leagueId: args.leagueId, season, week: p.data.week, rec: { key: pick.sleeperId, name: pick.name }, alt: { key: other.sleeperId, name: other.name }, slot: null })
    }
  }
  return [
    head,
    line(a),
    line(b),
    `Verdict: ${verdict}`,
    'RULES: this is My Team\'s call; never recommend the other player or quote different numbers. AllFantasy never sets the lineup.',
  ].join('\n')
}
