/**
 * Imported-league assist (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3 idea 4, §1.2 "Imported leagues"):
 * the keeper grid for a league that lives on Sleeper, ESPN, Yahoo, Fleaflicker or MFL.
 *
 * "AF computes costs from the other platform's draft results + transactions and gives the commish the
 * grid and a 'set keepers in Sleeper/ESPN' checklist." The costs come from the league's OWN keeper
 * rules as set in AllFantasy (lib/keeper/keeperRules.ts — the same engine native keeper leagues use),
 * applied to the platform's draft history:
 *
 *   last round   the round the player sits at in the latest imported draft — drafted or kept there.
 *                Not in that draft → he was picked up after it, and costs the waiver round.
 *   years kept   consecutive latest seasons in which the platform flagged him as a keeper.
 *
 * ⚠ THE RULES ARE THE COMMISSIONER'S, AND THE HISTORY IS A CHECK ON THEM. Platforms do not publish a
 * league's keeper rule, so a grid built on a wrong rule would print confident wrong rounds. When the
 * league's own drafts clearly show one habit (lib/keeper/importedKeeperCost.ts measures "kept at the
 * round he went") and the rules here say otherwise, the grid says so above every cost.
 *
 * Pure.
 */

import { keeperCostRound, roundLabel, type KeeperRules } from '@/lib/keeper/keeperRules'
import type { KeeperCostRule, KeeperDraftPick } from '@/lib/keeper/importedKeeperCost'

export type GridPlayer = {
  playerId: string
  name: string
  /** Round he costs next season, or null when he cannot be kept / is not priced by round. */
  costRound: number | null
  label: string
  basis: 'drafted' | 'waiver' | null
  yearsKept: number
  keptThisSeason: boolean
  /** Why he cannot be kept, when he cannot. */
  blocked: string | null
}

export type GridTeam = { teamId: string; name: string; players: GridPlayer[] }

export type KeeperGrid = {
  /** The draft the costs are for. */
  draftSeason: number
  basedOnSeason: number
  totalRounds: number
  teams: GridTeam[]
  warnings: string[]
}

/** Latest season's round per player, and how many seasons in a row (ending at the latest) he was kept. */
export function historyByPlayer(picks: readonly KeeperDraftPick[]): { season: number | null; totalRounds: number; last: Map<string, { round: number; kept: boolean }>; yearsKept: Map<string, number> } {
  const seasons = [...new Set(picks.map((p) => p.season))].sort((a, b) => b - a)
  const season = seasons[0] ?? null
  const last = new Map<string, { round: number; kept: boolean }>()
  const keptIn = new Map<string, Set<number>>()
  let totalRounds = 0
  for (const p of picks) {
    if (p.season === season) {
      last.set(p.playerId, { round: p.round, kept: p.isKeeper })
      totalRounds = Math.max(totalRounds, p.round)
    }
    if (p.isKeeper) keptIn.set(p.playerId, (keptIn.get(p.playerId) ?? new Set()).add(p.season))
  }
  const yearsKept = new Map<string, number>()
  if (season != null) {
    for (const [id, set] of keptIn) {
      let n = 0
      for (let s = season; set.has(s); s--) n++
      if (n > 0) yearsKept.set(id, n)
    }
  }
  return { season, totalRounds, last, yearsKept }
}

export function buildKeeperGrid(args: {
  rules: KeeperRules
  picks: readonly KeeperDraftPick[]
  measured: KeeperCostRule
  teams: ReadonlyArray<{ teamId: string; name: string; playerIds: readonly string[] }>
  names: ReadonlyMap<string, string>
  waiverPickupsAllowed: boolean
  /** Max seasons a player may be kept; null = no limit. */
  maxYears: number | null
}): KeeperGrid | null {
  const h = historyByPlayer(args.picks)
  if (h.season == null || h.totalRounds === 0) return null
  const warnings: string[] = []
  const { rules } = args

  if (rules.costSystem === 'auction_value' || rules.costSystem === 'free') {
    warnings.push(
      rules.costSystem === 'free'
        ? 'Keepers cost nothing under this league’s rules, so there is no round to show.'
        : 'This league prices keepers by auction value, which the platform’s draft history here does not carry; rounds are not shown.',
    )
  }
  // The history as a check on the rules: say so when they disagree.
  if (args.measured.rule === 'same_round' && rules.costSystem === 'round_based' && rules.roundsEarlier !== 0) {
    warnings.push(
      `This league’s own ${args.measured.season} draft kept ${args.measured.agreeing} of ${args.measured.measured} keepers at the round they went the year before, but the keeper rules set here say ${Math.abs(rules.roundsEarlier)} round${Math.abs(rules.roundsEarlier) === 1 ? '' : 's'} ${rules.roundsEarlier > 0 ? 'earlier' : 'later'}. Check Keeper settings before sharing these costs.`,
    )
  }
  warnings.push('Traded draft picks are not read from the platform, so a keeper whose round was traded away is shown at its cost round; move it on the platform if that pick is gone.')

  const byRound = rules.costSystem === 'round_based' || rules.costSystem === 'inflation'
  const teams: GridTeam[] = args.teams.map((t) => {
    const players: GridPlayer[] = t.playerIds.map((playerId) => {
      const last = h.last.get(playerId) ?? null
      const yearsKept = h.yearsKept.get(playerId) ?? 0
      const base = { playerId, name: args.names.get(playerId) ?? `Player ${playerId}`, yearsKept, keptThisSeason: last?.kept ?? false }
      if (args.maxYears != null && yearsKept >= args.maxYears) {
        return { ...base, costRound: null, label: '—', basis: last ? 'drafted' : 'waiver', blocked: `Kept ${yearsKept} season${yearsKept === 1 ? '' : 's'} already — the league allows ${args.maxYears}` }
      }
      if (!last && !args.waiverPickupsAllowed) {
        return { ...base, costRound: null, label: '—', basis: 'waiver', blocked: 'Picked up after the draft; this league does not allow pickups as keepers' }
      }
      if (!byRound) return { ...base, costRound: null, label: '—', basis: last ? 'drafted' : 'waiver', blocked: null }
      const cost = keeperCostRound(rules, { lastRound: last?.round ?? null, yearsKept, totalRounds: h.totalRounds })
      if (!cost.ok) return { ...base, costRound: null, label: '—', basis: last ? 'drafted' : 'waiver', blocked: `Would cost ${roundLabel(cost.costRound)}, earlier than this league allows` }
      return { ...base, costRound: cost.costRound, label: cost.label, basis: cost.basis, blocked: null }
    })
    // Best value first: the latest (cheapest) round at the top, unkeepable players last.
    players.sort((a, b) => (b.costRound ?? -1) - (a.costRound ?? -1) || a.name.localeCompare(b.name))
    return { teamId: t.teamId, name: t.name, players }
  })
  teams.sort((a, b) => a.name.localeCompare(b.name))
  return { draftSeason: h.season + 1, basedOnSeason: h.season, totalRounds: h.totalRounds, teams, warnings }
}

// ── Checklist ────────────────────────────────────────────────────────────────

const WHERE: Record<string, string> = {
  sleeper: 'In the Sleeper app, open next season’s draft. Each manager (or you, as commissioner) marks their keepers from the draft’s keeper option before it starts.',
  espn: 'On ESPN, keepers are set from LM Tools (League Manager) before the draft.',
  yahoo: 'On Yahoo, keepers are set from Commissioner Tools before the draft.',
  fleaflicker: 'On Fleaflicker, keepers are set from the league’s commissioner settings before the draft.',
  mfl: 'On MyFantasyLeague, keepers are set from the Commissioner setup menu before the draft.',
}

/** Steps for setting keepers on the platform, and a block of text listing each team's costs. */
export function keeperChecklist(grid: KeeperGrid, platform: string | null | undefined): { steps: string[]; shareText: string } {
  const key = String(platform ?? '').toLowerCase()
  const steps = [
    `Share the cost list below with the league so each manager knows what keeping a player costs in the ${grid.draftSeason} draft.`,
    `Collect each team’s keepers by your league’s deadline.`,
    `${WHERE[key] ?? 'On your league’s platform, find the keeper setting for next season’s draft.'} (Menu names can change; look for “keepers”.)`,
    'Put each keeper in the round shown here. Where two keepers cost the same round, use your league’s same-round rule.',
    'Check the draft board on the platform against this list before the draft starts.',
  ]
  const lines: string[] = [`${grid.draftSeason} keeper costs`, '']
  for (const t of grid.teams) {
    const priced = t.players.filter((p) => p.costRound != null)
    if (priced.length === 0) continue
    lines.push(t.name)
    for (const p of priced) lines.push(`  ${p.name}: ${p.label}${p.basis === 'waiver' ? ' (pickup)' : ''}${p.yearsKept ? `, kept ${p.yearsKept}x` : ''}`)
    lines.push('')
  }
  lines.push('Calculated by AllFantasy from this league’s drafts and keeper rules.')
  return { steps, shareText: lines.join('\n') }
}
