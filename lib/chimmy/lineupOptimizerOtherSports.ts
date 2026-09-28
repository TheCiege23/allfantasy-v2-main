import 'server-only'

import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { activePlayerIds, viewerRosterOf } from './leagueRosterIndex'
import { BASELINE_BASIS, baselineAvailable, baselineFor, loadBaselineIndex, type BaselineIndex } from './afBaselineIndex'

/**
 * "Set my lineup" outside the NFL — NBA, NHL, MLB, college basketball and college football.
 *
 * The NFL optimizer prices each player with this week's vendor line re-scored under the league's
 * rules. No other sport has a weekly feed (lib/projections/projectionCoverage.ts), but five of them
 * have AllFantasy's season-long per-game projection. This fills the league's own starting slots
 * from that number, most restrictive slot first — the same greedy the NFL fill uses, correct here for
 * the same reason (the slot eligibility sets below are nested: PG ⊂ G ⊂ UTIL, C ⊂ F ⊂ UTIL…).
 *
 * ── 🛑 IT IS A BASELINE AND THE BLOCK SAYS SO, EVERY TIME ─────────────────────────────────────
 * The number is AllFantasy's STANDARD per-game projection — not this league's scoring, and blind to
 * who actually plays today or this week. For a daily sport that last part is the whole game, so the
 * block tells the model to say it. Soccer has no projection base at all and is refused by name.
 * No number is invented: a player with no row is left out of the fill and counted.
 */

/** Slot label → positions that may fill it, per sport. Unknown labels block, as in the NFL fill. */
const ELIGIBILITY: Record<string, Record<string, readonly string[]>> = {
  NBA: {
    PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'],
    G: ['PG', 'SG'], F: ['SF', 'PF'], 'G/F': ['PG', 'SG', 'SF', 'PF'], 'F/C': ['SF', 'PF', 'C'],
    UTIL: ['PG', 'SG', 'SF', 'PF', 'C'], UT: ['PG', 'SG', 'SF', 'PF', 'C'], FLEX: ['PG', 'SG', 'SF', 'PF', 'C'],
  },
  NHL: {
    C: ['C'], LW: ['LW'], RW: ['RW'], W: ['LW', 'RW'], D: ['D'], G: ['G'],
    F: ['C', 'LW', 'RW'], UTIL: ['C', 'LW', 'RW', 'D'], SKATER: ['C', 'LW', 'RW', 'D'], FLEX: ['C', 'LW', 'RW', 'D'],
  },
  MLB: {
    C: ['C'], '1B': ['1B'], '2B': ['2B'], '3B': ['3B'], SS: ['SS'], OF: ['OF', 'LF', 'CF', 'RF'],
    LF: ['LF', 'OF'], CF: ['CF', 'OF'], RF: ['RF', 'OF'], DH: ['DH', 'C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF'],
    CI: ['1B', '3B'], MI: ['2B', 'SS'], IF: ['1B', '2B', '3B', 'SS'],
    UTIL: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH'],
    SP: ['SP'], RP: ['RP'], P: ['SP', 'RP', 'P'],
  },
  NCAAF: {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], DST: ['DST', 'DEF'],
    FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  },
}
ELIGIBILITY.NCAAB = ELIGIBILITY.NBA!

const NON_STARTING = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'IL', 'NA'])
const MIN_GAIN = 0.5

type P = { playerId: string; name: string; positions: string[]; team: string | null; injury: string | null; perGame: number | null }

export interface BaselineOptimizerDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  loadPlayers: (sport: string, ids: string[]) => Promise<Map<string, { name: string | null; position: string | null; team?: string | null; injury?: string | null }>>
  baseline: (sport: string) => Promise<BaselineIndex>
}

const defaultDeps: BaselineOptimizerDeps = {
  resolveWorld: resolveCanonicalWorld,
  loadPlayers: (sport, ids) => resolveNames(normalizeToSupportedSport(sport), ids, 120),
  baseline: loadBaselineIndex,
}

function positionsOf(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .toUpperCase()
    .split(/[\/,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const fmt = (n: number) => n.toFixed(1)
const who = (p: P) => {
  const bits = [p.positions.join('/'), p.team].filter(Boolean).join(', ')
  return bits ? `${p.name} (${bits})` : p.name
}

export function supportsBaselineLineup(sport: string): boolean {
  const s = String(sport).toUpperCase()
  return s !== 'NFL' && Boolean(ELIGIBILITY[s]) && baselineAvailable(s)
}

export async function buildBaselineLineupContext(
  args: { leagueId: string; userId: string },
  deps: BaselineOptimizerDeps = defaultDeps,
): Promise<string> {
  const notComputed = (why: string) =>
    ['LINEUP OPTIMIZER: NOT COMPUTED.', why, 'Do not present projected points or a "best lineup". Say plainly that it was not computed and why.'].join('\n')

  const world = await deps.resolveWorld(args.leagueId).catch(() => null)
  if (!world) return notComputed('The league could not be loaded to build a lineup.')
  const sport = String(world.league.sport).toUpperCase()
  const elig = ELIGIBILITY[sport]
  if (!elig || !baselineAvailable(sport)) {
    return notComputed(`AllFantasy holds no ${sport} projections to build a lineup from (there is no player season-stat base for it).`)
  }
  const roster = viewerRosterOf(world, args.userId)
  if (!roster) return notComputed('Your team in this league is not claimed or has no synced roster.')
  const slots = (world.league.rosterSettings.starterSlots ?? []).map((s) => s.toUpperCase()).filter((s) => !NON_STARTING.has(s))
  if (slots.length === 0) return notComputed("This league's starting lineup slots are not on file, so no lineup can be built.")
  const unknown = [...new Set(slots.filter((s) => !elig[s]))]
  if (unknown.length > 0) return notComputed(`The lineup has slots this model cannot fill: ${unknown.join(', ')}.`)

  const [meta, index] = await Promise.all([
    deps.loadPlayers(sport, roster.playerIds).catch(() => new Map()),
    deps.baseline(sport).catch(() => null),
  ])
  if (!index || index.byName.size === 0) return notComputed(`No AllFantasy ${sport} projections are stored right now.`)

  const players = new Map<string, P>()
  for (const id of roster.playerIds) {
    const m = meta.get(id)
    const b = baselineFor(index, m?.name ?? null)
    players.set(id, {
      playerId: id,
      name: m?.name ?? `(unnamed player ${id})`,
      positions: positionsOf(m?.position ?? b?.position ?? null),
      team: m?.team ?? null,
      injury: m?.injury ?? null,
      perGame: b?.perGame ?? null,
    })
  }
  const active = activePlayerIds(roster).map((id) => players.get(id)!).filter(Boolean)
  if (active.every((p) => p.perGame == null)) {
    return notComputed(`No player on your roster has an AllFantasy ${sport} projection on file.`)
  }

  /* Most restrictive slot first; best remaining eligible player per slot. */
  const order = slots.map((slot, i) => ({ slot, i, size: elig[slot]!.length })).sort((a, b) => a.size - b.size || a.i - b.i)
  const taken = new Set<string>()
  const filled: Array<{ i: number; slot: string; p: P | null }> = []
  const ranked = active.filter((p) => p.perGame != null).sort((a, b) => (b.perGame as number) - (a.perGame as number))
  for (const { slot, i } of order) {
    const pick = ranked.find((p) => !taken.has(p.playerId) && p.positions.some((pos) => elig[slot]!.includes(pos)))
    if (pick) taken.add(pick.playerId)
    filled.push({ i, slot, p: pick ?? null })
  }
  filled.sort((a, b) => a.i - b.i)
  const best = filled.filter((f) => f.p).map((f) => f.p!)
  const bestIds = new Set(best.map((p) => p.playerId))
  const bestTotal = best.reduce((s, p) => s + (p.perGame as number), 0)

  const currentIds = roster.starterIds.filter((id) => id && id !== '0')
  const current = currentIds.map((id) => players.get(id)).filter((p): p is P => Boolean(p))
  const currentSet = new Set(currentIds)
  const startInstead = best.filter((p) => !currentSet.has(p.playerId))
  const benchInstead = current.filter((p) => !bestIds.has(p.playerId))
  const unpricedCurrent = current.filter((p) => p.perGame == null)
  const currentTotal = unpricedCurrent.length === 0 && current.length > 0 ? current.reduce((s, p) => s + (p.perGame as number), 0) : null

  const lines: string[] = [
    `LINEUP OPTIMIZER (${sport}) — ranked by ${BASELINE_BASIS}. Repeat these numbers as PER-GAME standard projections; never call them this league's points or this week's total.`,
    `- Best lineup by that projection (${fmt(bestTotal)} per-game pts across the lineup):`,
    ...filled.map((f) => `  ${f.slot}: ${f.p ? `${who(f.p)} — ${fmt(f.p.perGame as number)}/game${f.p.injury ? ` [${f.p.injury}]` : ''}` : 'nobody eligible has a projection'}`),
  ]
  if (currentIds.length === 0) {
    lines.push('- No current lineup is on file to compare against. Present the lineup above.')
  } else if (startInstead.length === 0 && benchInstead.length === 0) {
    lines.push('- Your current lineup already matches it. Say so.')
  } else {
    lines.push(`- Changes: START ${startInstead.map((p) => `${who(p)} (${fmt(p.perGame as number)}/game)`).join(', ') || 'nobody new'}; BENCH ${benchInstead.map((p) => `${who(p)} (${p.perGame == null ? 'no projection' : `${fmt(p.perGame)}/game`})`).join(', ') || 'nobody'}.`)
    if (currentTotal != null) {
      const gain = bestTotal - currentTotal
      lines.push(gain >= MIN_GAIN ? `- That adds ${fmt(gain)} per-game pts across the lineup.` : `- The difference is ${fmt(gain)} per-game pts — a coin flip; say so.`)
    }
    lines.push('- To make these moves, call propose_lineup_change with the START and BENCH names; the user confirms on the card.')
  }
  for (const p of unpricedCurrent) lines.push(`- ⚠ ${who(p)} starts for you with no AllFantasy projection on file — check him.`)
  const unpricedActive = active.filter((p) => p.perGame == null).length
  if (unpricedActive > 0) lines.push(`- ${unpricedActive} active player(s) have no projection and were left out.`)
  lines.push(
    sport === 'NCAAF'
      ? '- Not modelled: this week\'s opponent and byes. College projections are season-long.'
      : '- 🚨 Not modelled: WHO PLAYS TODAY / THIS WEEK. In a daily sport a starter with no game scores nothing — tell the user to check the schedule before locking this in.',
  )
  return lines.join('\n')
}
