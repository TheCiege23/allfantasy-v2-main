/**
 * Best ball draft length for the daily sports (NBA, NHL, MLB).
 *
 * Best ball has no waivers, so the draft IS the season's roster: the draft must fill every seat a
 * team can play from — starters plus bench — and nothing a team cannot play from (IL / IR, NA,
 * taxi, prospect and other reserve seats). NFL and NCAAF already size their drafts from the best
 * ball contract (lib/league-concepts/bestBallDefaults.ts); these three sports have no contract, so
 * creation fell to the sport's generic registry default (NBA 13, NHL 17, MLB 24 rounds) while the
 * roster the league is actually given is the sport's `best_ball` template, installed at bootstrap by
 * `createDefaultLeagueRosterConfig(leagueId, sport, 'best_ball')` (lib/roster-engine).
 *
 * The count is read off that same template, so the two cannot drift apart.
 */
import { resolveNbaRosterTemplate, NBA_SLOT_MAP } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate, NHL_SLOT_MAP } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveMlbRosterTemplate, MLB_SLOT_MAP } from '@/lib/mlb-roster/MlbRosterTemplates'

export type BestBallTemplateSeats = { starters: number; bench: number; reserve: number; rounds: number }

type SlotCategoryMap = ReadonlyMap<string, { category: string }>

function seatsFor(slots: Record<string, number>, slotMap: SlotCategoryMap): BestBallTemplateSeats {
  let starters = 0
  let bench = 0
  let reserve = 0
  for (const [key, raw] of Object.entries(slots)) {
    const count = Math.max(0, Math.floor(Number(raw) || 0))
    if (count === 0) continue
    const category = slotMap.get(key)?.category
    if (category === 'bench') bench += count
    else if (category === 'reserve' || category === 'college') reserve += count
    else starters += count
  }
  return { starters, bench, reserve, rounds: starters + bench }
}

/** Seats of the best ball roster template for NBA / NHL / MLB; null for every other sport. */
export function bestBallTemplateSeats(sport: unknown): BestBallTemplateSeats | null {
  const normalized = String(sport ?? '').trim().toUpperCase()
  if (normalized === 'NBA') return seatsFor(resolveNbaRosterTemplate('best_ball').slots, NBA_SLOT_MAP)
  if (normalized === 'NHL') return seatsFor(resolveNhlRosterTemplate('best_ball').slots, NHL_SLOT_MAP)
  if (normalized === 'MLB') return seatsFor(resolveMlbRosterTemplate('best_ball').slots, MLB_SLOT_MAP)
  return null
}
