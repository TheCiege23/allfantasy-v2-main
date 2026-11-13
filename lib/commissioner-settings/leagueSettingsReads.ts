import { prisma } from '@/lib/prisma'
import { SCORING_STAT_LABELS } from '@/lib/commissioner-settings/scoringStatLabels'
import type {
  LeagueScoringRule,
  LeagueSettingEntry,
  LeagueSettingGroup,
  LeagueSettingsSnapshot,
} from '@/lib/commissioner-ui/settings/decision-os-client/types'

/**
 * Reads a league's settings as they were actually captured.
 *
 * Straight Postgres, no provider call and no self-referential HTTP hop: `leagues.settings` is a JSON
 * column this deployment already holds, written by the importer. See `decision-os-client/types.ts`
 * for why this does NOT go through `UnifiedLeagueSettingsService` — that service defaults, and
 * measured on production it would default for all 288 leagues.
 */

/**
 * The shape is a provider snapshot, so every access is defensive by necessity.
 *
 * ⚠ THESE HELPERS RETURN `null`, NEVER A ZERO OR AN EMPTY STRING. A missing FAAB budget rendered as
 * `$0` is a claim that the league plays with no budget, which is a different league from one whose
 * budget we did not capture. Every formatter below preserves that distinction all the way to the
 * view, which is the whole point of the contract's `value: string | null`.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.length > 0 ? s : null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** A number for display, or null. Keeps "not captured" distinct from "zero". */
function fmtNum(value: unknown, suffix = ''): string | null {
  const n = num(value)
  return n === null ? null : `${n}${suffix}`
}

function fmtMoney(value: unknown): string | null {
  const n = num(value)
  return n === null ? null : `$${n.toLocaleString('en-US')}`
}

/** Turns `DYNASTY_IDP` / `weekly` / `faab` into something a person reads. */
function titleize(value: unknown): string | null {
  const s = str(value)
  if (!s) return null
  return s
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bIdp\b/g, 'IDP')
    .replace(/\bFaab\b/g, 'FAAB')
    .replace(/\bPpr\b/g, 'PPR')
}

/** Shared with the client settings hub — see `scoringStatLabels.ts` for why it is partial. */
const STAT_LABELS = SCORING_STAT_LABELS

function toScoringRules(scoring: Record<string, unknown> | null): LeagueScoringRule[] {
  const rules = asRecord(scoring?.rules)
  if (!rules) return []
  return Object.entries(rules)
    .map(([stat, raw]) => ({ stat, points: num(raw) }))
    .filter((r): r is { stat: string; points: number } => r.points !== null)
    .map(({ stat, points }) => ({ stat, label: STAT_LABELS[stat] ?? stat, points }))
    /*
     * Biggest absolute impact first, then alphabetically. A commissioner scanning this wants to see
     * the rules that move a score — a 6-point TD before a 0.04 passing yard — and ties resolved
     * stably so the list does not reshuffle between reads.
     */
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.label.localeCompare(b.label))
}

/** Drops nothing: an entry whose value is null is still shown, as "not captured". */
function group(id: string, label: string, description: string, entries: LeagueSettingEntry[]): LeagueSettingGroup {
  return { id, label, description, entries }
}

export async function readLeagueSettingsSnapshot(leagueId: string): Promise<LeagueSettingsSnapshot | null> {
  /*
   * ⚠ `findFirst`, NOT `findUnique`, AND THE DIFFERENCE IS NOT STYLISTIC (T-006). `findUnique`'s
   * `where` accepts only unique fields, so `deletedAt` is not a legal filter on it — the
   * soft-delete extension is STRUCTURALLY unable to cover it, and a purged league would still
   * render its settings here. `findFirst` takes the same arguments and IS filtered.
   */
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { name: true, settings: true, platform: true, platformLeagueId: true, sport: true },
  })
  if (!league) return null

  const s = asRecord(league.settings)
  const roster = asRecord(s?.rosterSettings)
  const waivers = asRecord(s?.waiverSettings)
  const playoffs = asRecord(s?.playoffSettings)
  const draft = asRecord(s?.draftSettings)
  const commish = asRecord(s?.commissionerSettings)
  const scoring = asRecord(s?.scoringSettings)
  const concept = asRecord(s?.conceptRules)
  const extensions = asRecord(concept?.extensions)
  const importMeta = asRecord(extensions?.importMetadata)

  const positions = Array.isArray(s?.roster_positions) ? (s?.roster_positions as unknown[]).map(String) : []
  const starters = positions.filter((p) => p !== 'BN' && p !== 'IR')

  const isDynasty = bool(s?.isDynasty)

  const groups: LeagueSettingGroup[] = [
    group('identity', 'League', 'What kind of league this is, as captured from its platform.', [
      { label: 'Teams', value: fmtNum(s?.leagueSize ?? s?.rosterSize) },
      { label: 'Season', value: fmtNum(s?.season) },
      { label: 'Format', value: titleize(s?.league_variant) },
      { label: 'Dynasty', value: isDynasty === null ? null : isDynasty ? 'Yes' : 'No' },
      { label: 'Sport', value: titleize(league.sport) },
      { label: 'Matchups', value: titleize(s?.matchup_frequency) },
    ]),
    group('roster', 'Roster', 'Starting slots, bench depth and the developmental slots this league carries.', [
      {
        label: 'Starting slots',
        value: starters.length > 0 ? String(starters.length) : null,
        note: starters.length > 0 ? starters.join(' · ') : undefined,
      },
      { label: 'Bench', value: fmtNum(roster?.benchSlots) },
      { label: 'IR', value: fmtNum(roster?.irSlots) },
      { label: 'Taxi squad', value: fmtNum(roster?.taxiSlots ?? s?.taxi_slots) },
      { label: 'Devy / college', value: fmtNum(roster?.devyCollegeSlots) },
      { label: 'Total roster spots', value: positions.length > 0 ? String(positions.length) : null },
    ]),
    group('waivers', 'Waivers', 'How this league adds free agents.', [
      { label: 'Waiver type', value: titleize(waivers?.waiverType) },
      { label: 'FAAB budget', value: fmtMoney(waivers?.faabBudget ?? s?.faab_budget) },
    ]),
    group('playoffs', 'Playoffs', 'How the season ends.', [
      { label: 'Playoff teams', value: fmtNum(playoffs?.playoffTeams ?? s?.playoff_team_count) },
      { label: 'Playoffs start', value: fmtNum(playoffs?.playoffStartWeek, '') , note: 'Week' },
      { label: 'Trade deadline', value: fmtNum(commish?.tradeDeadlineWeek), note: 'Week' },
    ]),
    group('draft', 'Draft', 'How this league drafts.', [
      { label: 'Draft type', value: titleize(draft?.draftType) },
    ]),
  ]

  const rules = toScoringRules(scoring)

  return {
    leagueName: str(league.name),
    seasonLabel: num(s?.season) === null ? null : String(num(s?.season)),
    groups,
    scoring: {
      format: titleize(scoring?.format),
      templateId: str(scoring?.scoringTemplateId),
      ruleCount: rules.length,
      rules,
    },
    provenance: {
      source: titleize(str(scoring?.source) ?? str(extensions?.importSource) ?? league.platform),
      externalLeagueId: str(importMeta?.externalLeagueId) ?? str(league.platformLeagueId),
      /*
       * An imported league is read-only here, full stop. Sleeper has no write endpoint at all, so
       * there is no version of an edit control on this page that could do anything but appear to
       * work. A league AllFantasy runs itself would be editable — none of the 288 commissioned
       * leagues on production is one today, so this is `false` in practice rather than in principle.
       */
      editableHere: !league.platform,
    },
  }
}
