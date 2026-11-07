/**
 * The ONE best ball lineup: the slots production scoring seats, and the exact optimizer it seats them with.
 *
 * Production truth is `scoreRosterBestBall` in `lib/redraft/scoringEngine.ts`: every candidate is scored,
 * then `computeOptimalLineup` (exact) starts the best legal lineup over `buildBestBallSlots(sport,
 * league.settings)`. Every other best ball number in the app — the contest / survivor optimizer cache,
 * the generic weekly processor, the scoring worker, the War Room's slot summary and the settings copy —
 * reads its slots and its optimizer from here, so none of them can show a different lineup from the
 * matchup.
 *
 * 🛑 THESE WERE FOUR DIFFERENT ANSWERS (audit 2026-11-06, finding #17 / #22). A greedy fill that burnt a
 * dual-eligible player in the wrong seat (35 where the optimum is 50), a DFS over hard-coded slots with
 * no K/DST/superflex that took 18 s on a 30-player MLB roster, a scoring-worker fallback that summed the
 * whole roster, and a sport profile (`lib/bestball/rules.ts`) whose NBA lineup had 9 starters while the
 * `best_ball` roster template a league is actually given has 11.
 *
 * Pure: no DB, no clock. `buildBestBallSlots` moved here unchanged from `scoringEngine.ts` (which still
 * re-exports it) so client code and pure modules can use it without importing Prisma.
 */
import {
  computeOptimalLineup,
  type LineupSlotSpec,
  type OptimalLineupResult,
  type OptimizerPlayerInput,
} from '@/lib/lineup-optimizer/optimalLineup'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { allowedPositionsForSlot, normalizeToken } from '@/lib/redraft/lineupValidation'
import { resolveNflRosterTemplate } from '@/lib/nfl-roster/NflRosterTemplates'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveMlbRosterTemplate } from '@/lib/mlb-roster/MlbRosterTemplates'
import { resolveNcaafRosterTemplate } from '@/lib/ncaaf-roster/NcaafRosterTemplates'
import { resolveNcaabRosterTemplate } from '@/lib/ncaab-roster/NcaabRosterTemplates'
import { resolveSoccerRosterTemplate } from '@/lib/soccer-roster/SoccerRosterTemplates'

/**
 * The league's starter slots as optimizer input: the commissioner's roster (a superflex league
 * gets its SF seat), with the same slot eligibility lineup validation enforces.
 */
export function buildBestBallSlots(sport: string, leagueSettings: unknown): LineupSlotSpec[] {
  const config = resolveRedraftRosterConfig(sport, leagueSettings)
  const slots: LineupSlotSpec[] = []
  let order = 0
  for (const [token, count] of config.starterCapacities) {
    slots.push({ slot: token, eligible: allowedPositionsForSlot(sport, token), count, slotOrder: order++ })
  }
  return slots
}

/** A roster row's position string as optimizer positions (`WR/RB` is both), normalized like the slots. */
export function bestBallPlayerPositions(position: string | null | undefined): string[] {
  return String(position ?? '')
    .split(/[/,]/)
    .map((p) => normalizeToken(p))
    .filter(Boolean)
}

const TEMPLATE_RESOLVERS: Record<string, (leagueType: string) => { slots: Record<string, number> }> = {
  NFL: resolveNflRosterTemplate,
  NBA: resolveNbaRosterTemplate,
  NHL: resolveNhlRosterTemplate,
  MLB: resolveMlbRosterTemplate,
  NCAAF: resolveNcaafRosterTemplate,
  NCAAB: resolveNcaabRosterTemplate,
  SOCCER: resolveSoccerRosterTemplate,
}

/**
 * The sport's `best_ball` roster template — what league bootstrap installs
 * (`createDefaultLeagueRosterConfig(leagueId, sport, 'best_ball')` writes it to
 * `settings.roster.config.sections`, which `resolveRedraftRosterConfig` reads first). Null for a sport
 * with no best ball template, so a caller can say "unresolved" instead of borrowing NFL's slots
 * (`getRedraftSportConfig` falls back to NFL for an unknown sport).
 */
export function bestBallTemplateRosterSlots(sport: string | null | undefined): Record<string, number> | null {
  const resolve = TEMPLATE_RESOLVERS[String(sport ?? '').trim().toUpperCase()]
  return resolve ? { ...resolve('best_ball').slots } : null
}

/** League settings carrying only the template roster, in the shape bootstrap writes. */
export function bestBallTemplateSettings(sport: string): Record<string, unknown> | null {
  const slots = bestBallTemplateRosterSlots(sport)
  return slots ? { roster: { config: { sections: [{ key: 'primary', label: 'Primary', slots }] } } } : null
}

/**
 * The slots production would seat for this league. With `leagueSettings` (a real league, even `{}`) this
 * is EXACTLY `buildBestBallSlots`. Without it (no league yet: the create wizard, a sport profile) it is the
 * `best_ball` template a new league of that sport is given. Null when neither can be resolved, or the
 * resolved layout has no starter seat.
 */
export function resolveBestBallSlots(sport: string, leagueSettings?: unknown): LineupSlotSpec[] | null {
  const normalized = String(sport ?? '').trim().toUpperCase()
  if (!TEMPLATE_RESOLVERS[normalized]) return null
  const settings = leagueSettings === undefined ? bestBallTemplateSettings(normalized) : leagueSettings
  const slots = buildBestBallSlots(normalized, settings)
  return slots.some((s) => s.count > 0) ? slots : null
}

export type BestBallDisplaySlot = { code: string; count: number; allowedPositions: string[] }

/**
 * The same slots for display: `code` is the roster key a person reads (`FLEX`, `SUPERFLEX`), not the
 * normalized scoring token (`FLX`, `SF`). Counts and eligibility are the scoring ones, unchanged.
 */
export function bestBallDisplaySlots(sport: string, leagueSettings?: unknown): BestBallDisplaySlot[] {
  const slots = resolveBestBallSlots(sport, leagueSettings) ?? []
  const templateKeys = Object.keys(bestBallTemplateRosterSlots(sport) ?? {})
  return slots
    .filter((s) => s.count > 0)
    .map((s) => ({
      code: templateKeys.find((k) => normalizeToken(k) === s.slot) ?? displayToken(s.slot),
      count: s.count,
      allowedPositions: [...s.eligible],
    }))
}

function displayToken(token: string): string {
  if (token === 'FLX') return 'FLEX'
  if (token === 'SF') return 'SUPERFLEX'
  return token
}

export type BestBallLineupPlayer = { playerId: string; position: string | null | undefined; points: number; playerName?: string | null }

/** Seat a best ball lineup exactly as production does, over slots already resolved for the league. */
export function computeBestBallLineup(input: {
  slots: readonly LineupSlotSpec[]
  players: readonly BestBallLineupPlayer[]
}): OptimalLineupResult {
  const players: OptimizerPlayerInput[] = input.players.map((p) => ({
    playerId: p.playerId,
    positions: bestBallPlayerPositions(p.position),
    points: Number.isFinite(p.points) ? p.points : 0,
    playerName: p.playerName ?? null,
  }))
  return computeOptimalLineup({ players, slots: input.slots })
}
