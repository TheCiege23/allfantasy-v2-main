/**
 * The playoff-overrides panel (components/app/settings/PlayoffSettingsPanel.tsx →
 * PUT /api/commissioner/leagues/[leagueId]/playoffs) translated into ONE canonical settings patch
 * (lib/league/execute-league-settings-patch.ts).
 *
 * 🛑 THIS PANEL USED TO WRITE `League.settings` ALONE, AND THE COLUMNS WIN. The bracket resolver
 * (PlayoffBracketConfigResolver) and the playoff runtime read `League.playoffTeams`,
 * `playoffStartWeek`, `playoffWeeksPerRound` and `playoffLowerBracket` BEFORE the JSON copies, so a
 * team count, start week, round length or lower bracket saved here was stored and then read straight
 * past — the panel even showed the old value back after "Playoff overrides saved". Those four now go
 * to the columns, and the canonical patch mirrors them into the JSON copies
 * (commissioner-settings-derived-sync.ts) and applies every rule the League Settings screen gets:
 * the playoff fit check, field-size bounds, the championship-length refusals, the settings lock and
 * the lifecycle and co-commissioner gates.
 *
 * Only the fields with no column — playoff weeks, start point, byes, rounds, tiebreakers,
 * bye rules, reseeding, third place — stay JSON, merged into `settings.playoff_structure` through the
 * same patch's `settingsMerge`. What the consolation bracket plays for is JSON too but is forwarded as
 * the canonical `consolationPlaysFor`, because saving it is what opts an existing league's draft order
 * in (lib/playoff-runtime/consolationPlaysFor.ts) — so the panel sends it only when it was changed.
 */

export type PlayoffsPanelBody = Record<string, unknown>

export type CommissionerPlayoffsLeague = {
  settings: unknown
  playoffTeams: number | null
  playoffLowerBracket: string | null
}

export type CommissionerPlayoffsPatch =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; status: number; error: string }

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Panel keys with no `League` column, and the `settings.playoff_structure` key each is stored as. */
const JSON_ONLY_KEYS: Array<[string, string]> = [
  ['playoffWeeks', 'playoff_weeks'],
  ['playoffStartPoint', 'playoff_start_point'],
  ['firstRoundByes', 'first_round_byes'],
  ['totalRounds', 'total_rounds'],
  ['tiebreakerRules', 'tiebreaker_rules'],
  ['byeRules', 'bye_rules'],
  ['reseedBehavior', 'reseed_behavior'],
  ['thirdPlaceGameEnabled', 'third_place_game_enabled'],
]

/** The lower bracket the column holds now, read the way the bracket resolver reads it. */
function currentLowerBracket(league: CommissionerPlayoffsLeague): { toilet: boolean; consolation: boolean } {
  const lb = String(league.playoffLowerBracket ?? '').toLowerCase()
  if (lb) return { toilet: lb === 'toilet', consolation: lb === 'consolation' || lb === 'consolation_bracket' }
  const structure = record(record(league.settings).playoff_structure)
  return { toilet: structure.toilet_bowl_enabled === true, consolation: structure.consolation_bracket_enabled === true }
}

/**
 * The canonical patch body (without `leagueId`) for one save of the panel, or a refusal for input
 * the panel's own fields cannot mean. Anything the canonical patch validates is left to it.
 */
export function commissionerPlayoffsPatch(body: PlayoffsPanelBody, league: CommissionerPlayoffsLeague): CommissionerPlayoffsPatch {
  const patch: Record<string, unknown> = {}

  if (hasOwn(body, 'playoffTeamCount')) {
    const n = Number(body.playoffTeamCount)
    if (!Number.isInteger(n) || n < 0) return { ok: false, status: 400, error: 'playoffTeamCount must be a whole number' }
    // The panel re-sends its whole form; a field it can show as 0 is only refused when it is CHANGED to one.
    if (n !== league.playoffTeams) {
      if (n < 2) return { ok: false, status: 400, error: 'playoffTeamCount must be at least 2' }
      patch.playoffTeams = n
    }
  }

  if (hasOwn(body, 'playoffStartWeek') && body.playoffStartWeek != null && body.playoffStartWeek !== '') {
    const n = Number(body.playoffStartWeek)
    if (!Number.isInteger(n) || n < 1) return { ok: false, status: 400, error: 'playoffStartWeek must be a week number' }
    patch.playoffStartWeek = n
  }

  // `matchup_length` IS the weeks-per-round column (PlayoffBracketConfigResolver reads one for the other).
  if (hasOwn(body, 'matchupLength')) {
    const n = Number(body.matchupLength)
    if (!Number.isInteger(n) || n < 1) return { ok: false, status: 400, error: 'matchupLength must be at least 1 week' }
    patch.playoffWeeksPerRound = n
  }

  // Two checkboxes for one column: the league plays a toilet bowl, a consolation bracket, or neither.
  if (hasOwn(body, 'consolationBracketEnabled') || hasOwn(body, 'toiletBowlEnabled')) {
    const now = currentLowerBracket(league)
    const toilet = hasOwn(body, 'toiletBowlEnabled') ? body.toiletBowlEnabled === true : now.toilet
    const consolation = hasOwn(body, 'consolationBracketEnabled') ? body.consolationBracketEnabled === true : now.consolation
    if (toilet && consolation) {
      return { ok: false, status: 400, error: 'Pick a consolation bracket or a toilet bowl, not both.' }
    }
    patch.playoffLowerBracket = toilet ? 'toilet' : consolation ? 'consolation' : 'none'
  }

  if (hasOwn(body, 'seedingRules') && typeof body.seedingRules === 'string' && body.seedingRules.trim()) {
    // A column too: the derived sync writes `seeding_rules` from it, which the seeding resolver reads first.
    patch.playoffSeedingRule = body.seedingRules.trim()
  }

  if (hasOwn(body, 'championshipLength')) {
    // This panel's input allows 0 and the no-playoff sport default stores 0; both read as "unset" (1 week).
    const n = Number(body.championshipLength)
    if (!Number.isInteger(n) || n < 0 || n > 4) return { ok: false, status: 400, error: 'championshipLength must be 0–4 weeks' }
    patch.championshipLength = Math.max(1, n)
  }

  if (hasOwn(body, 'thirdPlaceGameEnabled')) {
    // Forwarded as well as stored below, so the canonical patch's own third-place rule applies where it has one.
    patch.thirdPlaceGameEnabled = body.thirdPlaceGameEnabled === true
  }

  // Validated and stored (with the draft-order flag) by the canonical patch.
  if (hasOwn(body, 'consolationPlaysFor')) patch.consolationPlaysFor = body.consolationPlaysFor

  const settingsMerge: Record<string, unknown> = {}
  const structureChanges: Record<string, unknown> = {}
  for (const [incoming, target] of JSON_ONLY_KEYS) {
    if (hasOwn(body, incoming)) structureChanges[target] = body[incoming]
  }
  if (Object.keys(structureChanges).length > 0) {
    settingsMerge.playoff_structure = { ...record(record(league.settings).playoff_structure), ...structureChanges }
  }
  if (hasOwn(body, 'standingsTiebreakers')) settingsMerge.standings_tiebreakers = body.standingsTiebreakers
  if (Object.keys(settingsMerge).length > 0) patch.settingsMerge = settingsMerge

  return { ok: true, patch }
}
