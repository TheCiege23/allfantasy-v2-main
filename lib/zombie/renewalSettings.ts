import type { Prisma } from '@prisma/client'

/** Copy rule families, never old invitation tokens, member/roster IDs, schedule dates, or season progress. */
export function nextZombieSettings(raw: Prisma.JsonValue | null, season: number, previousLeagueId: string) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const exact = new Set(['roster','rosterSettings','scoringSettings','playoffSettings','waiverSettings','sportConfig',
    'commissionerSettings','conceptRules','mediaSettings','visualTheme','language','league_type','leagueType',
    'injury_slot_behavior','lock_time_behavior','matchup_frequency','standings_tiebreakers','trade_review_mode',
    'regular_season_length','season_labeling','snapshotVersion','scoring_preset_id','scoring_mode','scoring_format_type',
    'roster_format_type','roster_mode','category_preset_id','category_record_mode','playoff_team_count','playoff_structure','waiver_mode'])
  const out: Record<string, Prisma.JsonValue> = {}
  for (const [k,v] of Object.entries(source)) if (v !== undefined && (exact.has(k) || /^(nfl|nba|nhl|mlb)_(roster|scoring)_config$/.test(k) ||
    k.startsWith('fantasy_schedule_') || (k.startsWith('schedule_') && !/date|start|end|generated|current|season/i.test(k)))) out[k]=v
  // Foundation settings are rules; draft state/dates and creation-time ownership are rebuilt separately.
  if (source.foundation_defaults && typeof source.foundation_defaults === 'object' && !Array.isArray(source.foundation_defaults)) {
    const foundation = source.foundation_defaults
    out.foundation_defaults = Object.fromEntries(Object.entries(foundation).filter(([k]) =>
      ['roster','scoring','waiver','playoff','schedule','metadata','managerCount','sport','format','conceptPreset','tradeSettings','playerPoolRules','proPlayerPoolRules','tabsEnabled','mockDraftRules','liveDraftRules','redraftContract'].includes(k)))
  }
  out.zombie_renewal = { version: 1, season, previousLeagueId }
  return out as Prisma.InputJsonObject
}

/** Detach scalar policy rows from their old identity. Explicit runtime fields are omitted by callers. */
export function detachedPolicy(row: object, omit: string[] = [], nullableJson: string[] = []) {
  const skip = new Set(['id','leagueId','zombieLeagueId','createdAt','updatedAt',...omit])
  return Object.fromEntries(Object.entries(row).filter(([k,v]) => !skip.has(k) && v !== undefined &&
    !(v === null && nullableJson.includes(k))))
}
