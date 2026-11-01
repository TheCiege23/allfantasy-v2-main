/**
 * Redraft identity for the League Settings page (wave-2 A5, 2026-10-31): "how your season works".
 *
 * The page's sections already run in season order (General → Roster & scoring → Draft → Waivers &
 * trades → Playoffs → Members → Commissioner tools). For a native redraft league this module adds the
 * two things the approved mock layers on top of that list, both derived from data the page already
 * holds — nothing here fetches, and nothing is invented:
 *
 *   - a "when" eyebrow per section ("Before the draft", "Draft day", "Weeks 1–14 · trade deadline Wk 12",
 *     "From Week 15"), and
 *   - a stage per season section (done / now / next) from the league's lifecycle phase, which drives the
 *     timeline dot beside each card.
 *
 * ⚠ A WEEK IS SHOWN ONLY WHEN THE LEAGUE CHOSE IT. `resolvePlayoffStartWeek` falls back to a sport
 * default; the eyebrow reads `readChosenPlayoffStartWeek` and does not (same rule as the header's season track, lib/league-media/redraftSeasonTrack.ts),
 * so a league with no chosen start reads "All season" / "Season's end" rather than a week nobody set.
 *
 * ⚠ NO NEW CLASSIFICATION: "is this redraft" is `resolveRedraftIdentity`, the same call the workspace
 * root uses to stamp `data-format="redraft"`. Null keeps the default settings page, byte for byte.
 *
 * Spanish copy says «reclamo», never «waiver» — none of these strings names claims at all.
 */
import { resolveRedraftIdentity, type RedraftIdentityLeague, type RedraftSportTheme } from './redraftIdentity'
import { readChosenPlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import type { SettingsSubPageId } from '@/lib/league-settings-home/buildLeagueSettingsHome'

export type RedraftSettingsPhase = 'Setup' | 'Draft' | 'Regular season' | 'Playoffs' | 'Offseason'
export type RedraftSettingsStage = 'done' | 'now' | 'next'

/** The four points of a redraft season a setting belongs to, in order. */
type SeasonPoint = 'before' | 'draft' | 'season' | 'playoffs'
const POINT_ORDER: Record<SeasonPoint, number> = { before: 0, draft: 1, season: 2, playoffs: 3 }
const PHASE_ORDER: Record<RedraftSettingsPhase, number> = { Setup: 0, Draft: 1, 'Regular season': 2, Playoffs: 3, Offseason: 4 }

/** buildLeagueSettingsHome's section ids → where in the season they act. Others have no point. */
const SECTION_POINT: Record<string, SeasonPoint> = {
  general: 'before',
  'roster-scoring': 'before',
  draft: 'draft',
  'waivers-trades': 'season',
  playoffs: 'playoffs',
}

/** The Commissioner center's pane label for a sub-page (desktop commissioner layout). */
const SUBPAGE_POINT: Partial<Record<SettingsSubPageId, SeasonPoint>> = {
  general: 'before',
  format: 'before',
  roster: 'before',
  scoring: 'before',
  draft: 'draft',
  waivers: 'season',
  trades: 'season',
  playoffs: 'playoffs',
}

type Lang = 'en' | 'es'

const COPY: Record<Lang, {
  before: string
  draft: string
  weeks: (last: number) => string
  allSeason: string
  deadline: (week: number) => string
  from: (week: number) => string
  seasonEnd: string
  members: string
  commissioner: string
}> = {
  en: {
    before: 'Before the draft',
    draft: 'Draft day',
    weeks: (last) => (last <= 1 ? 'Week 1' : `Weeks 1–${last}`),
    allSeason: 'All season',
    deadline: (week) => `trade deadline Wk ${week}`,
    from: (week) => `From Week ${week}`,
    seasonEnd: 'Season’s end',
    members: 'All year',
    commissioner: 'Commissioner only',
  },
  es: {
    before: 'Antes del draft',
    draft: 'Día del draft',
    weeks: (last) => (last <= 1 ? 'Semana 1' : `Semanas 1–${last}`),
    allSeason: 'Toda la temporada',
    deadline: (week) => `fecha límite de intercambios Sem ${week}`,
    from: (week) => `Desde la semana ${week}`,
    seasonEnd: 'Fin de temporada',
    members: 'Todo el año',
    commissioner: 'Solo comisionado',
  },
}

export type RedraftSettingsLeague = RedraftIdentityLeague & {
  lifecycleState?: string | null
  status?: string | null
  playoffStartWeek?: number | null
  tradeDeadlineWeek?: number | null
  settings?: unknown
}

export type RedraftSettingsSection = { when: string; stage?: RedraftSettingsStage }

export type RedraftSettingsView = {
  sport: RedraftSportTheme
  sportLabel: string
  phase: RedraftSettingsPhase
  /** Keyed by buildLeagueSettingsHome section id. A section absent here renders as today. */
  sections: Record<string, RedraftSettingsSection>
  /** Keyed by sub-page id: the Commissioner center's pane eyebrow and its nav item's timeline stage. */
  subPages: Partial<Record<SettingsSubPageId, RedraftSettingsSection>>
}

const positiveWeek = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Null means "keep the default settings page": not a native redraft league (resolveRedraftIdentity).
 * `phase` is nativeLeaguePhase(league) — passed in so this file and the workspace read one answer.
 */
export function buildRedraftSettingsView(
  league: RedraftSettingsLeague,
  phase: RedraftSettingsPhase,
  language: string | null | undefined = 'en',
): RedraftSettingsView | null {
  const identity = resolveRedraftIdentity(league)
  if (!identity) return null
  const c = COPY[language === 'es' ? 'es' : 'en']

  const playoffStart = readChosenPlayoffStartWeek({ playoffStartWeek: league.playoffStartWeek ?? null, settings: league.settings })
  const deadlineRaw = positiveWeek(league.tradeDeadlineWeek)
  // A deadline at or after the playoffs is "no deadline" in practice; do not print it as one.
  const deadline = deadlineRaw != null && (playoffStart == null || deadlineRaw < playoffStart) ? deadlineRaw : null

  const seasonWhen = [playoffStart != null ? c.weeks(playoffStart - 1) : c.allSeason, deadline != null ? c.deadline(deadline) : null]
    .filter(Boolean)
    .join(' · ')
  const whenFor: Record<SeasonPoint, string> = {
    before: c.before,
    draft: c.draft,
    season: seasonWhen,
    playoffs: playoffStart != null ? c.from(playoffStart) : c.seasonEnd,
  }

  const now = PHASE_ORDER[phase]
  const stageOf = (point: SeasonPoint): RedraftSettingsStage => {
    const at = POINT_ORDER[point]
    if (at < now) return 'done'
    return at === now ? 'now' : 'next'
  }

  const sections: Record<string, RedraftSettingsSection> = {
    members: { when: c.members },
    commissioner: { when: c.commissioner },
  }
  for (const [id, point] of Object.entries(SECTION_POINT)) sections[id] = { when: whenFor[point], stage: stageOf(point) }

  const subPages: Partial<Record<SettingsSubPageId, RedraftSettingsSection>> = {}
  for (const [id, point] of Object.entries(SUBPAGE_POINT) as Array<[SettingsSubPageId, SeasonPoint]>) subPages[id] = { when: whenFor[point], stage: stageOf(point) }

  return { sport: identity.sport, sportLabel: identity.sportLabel, phase, sections, subPages }
}
