/**
 * The Commissioner Hub's dynasty-only health flags — pick balance, rookie draft order and taxi
 * squads over their limit — in the SAME shape as the five in ./health.ts, so they rank with them,
 * render in the same list, and become "Needs you" task cards through `buildTaskCards` unchanged.
 *
 * Orphan teams are NOT here: the existing `abandoned` flag already names teams with no owner, and a
 * second detector for the same condition is how one empty seat ends up on the screen twice.
 *
 * ⚠ ONLY A DYNASTY LEAGUE GETS THESE. The caller adds them behind `usesDynastyBackground`; every
 * other league's flag list is exactly what it was.
 *
 * ⚠ THEY CARRY NO SCORE, LIKE EVERY FLAG. The headline number stays the canonical
 * `monitorLeagueHealth` score (see the header of ./health.ts) — these are the named conditions
 * under it.
 *
 * Strings live in lib/i18n (commishHub.dynHealth.*), English and Spanish. Client-safe: no Prisma.
 */
import { translations } from '@/lib/i18n/translations'
import { interpolateTemplate } from '@/lib/i18n/interpolate'
import type { DynastyPickBalance, DynastyTaxiOverLimit } from '@/lib/commissioner-hub/dynastyHealthSignals'
import { rookieOrderWords, type DynastyRolloverInput } from '@/lib/season-rollover/dynastyRolloverWizard'
import type { HealthFlag, HealthFlagAction } from './health'

const K = 'commishHub.dynHealth.'

/** `t()` for a server builder: the reader's language, then English, then the key. */
export function dynText(language: string | undefined, key: string, vars: Record<string, string | number> = {}): string {
  const lang = language && translations[language] ? language : 'en'
  const raw = translations[lang]?.[K + key] ?? translations.en[K + key] ?? K + key
  return interpolateTemplate(raw, vars)
}

const plural = (language: string | undefined, key: string, n: number, vars: Record<string, string | number> = {}) =>
  dynText(language, `${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars })

function names(list: string[], language: string | undefined, max = 4): string {
  if (list.length <= max) return list.join(', ')
  return dynText(language, 'names.more', { shown: list.slice(0, max).join(', '), n: list.length - max })
}

const teamName = (name: string | null, language: string | undefined) => name?.trim() || dynText(language, 'panel.unnamed')

// ── Pick balance ────────────────────────────────────────────────────────────

export function pickBalanceFlag(picks: DynastyPickBalance, action: HealthFlagAction | null, language?: string): HealthFlag {
  const label = dynText(language, 'picks.label')
  if (!picks.measured) {
    const reason = {
      missing: 'picks.missing',
      partial: 'picks.partial',
      empty: 'picks.empty',
      no_teams: 'picks.noTeams',
    }[picks.reason]
    return { key: 'picks', label, measured: false, reason: dynText(language, reason), action: null }
  }
  const season = picks.seasons[0]
  const drafts = picks.seasons.length
  const none = picks.rows.filter((r) => r.flag === 'none_next')
  const heavy = picks.rows.filter((r) => r.flag === 'heavy')
  const count = none.length + heavy.length
  const headline =
    count === 0
      ? dynText(language, 'picks.balancedHeadline', { season })
      : [
          none.length > 0 ? plural(language, 'picks.noneHeadline', none.length, { season }) : null,
          heavy.length > 0 ? plural(language, 'picks.heavyHeadline', heavy.length) : null,
        ]
          .filter(Boolean)
          .join(' · ')
  const detail =
    count === 0
      ? dynText(language, 'picks.balancedDetail', { drafts, avg: picks.average })
      : [
          none.length > 0
            ? dynText(language, 'picks.noneDetail', { season, names: names(none.map((r) => teamName(r.teamName, language)), language) })
            : null,
          heavy.length > 0
            ? dynText(language, 'picks.heavyDetail', {
                avg: picks.average,
                drafts,
                names: names(
                  heavy.map((r) => dynText(language, 'names.held', { team: teamName(r.teamName, language), n: r.total })),
                  language,
                ),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' ')
  return {
    key: 'picks',
    label,
    measured: true,
    severity: count > 0 ? 'warn' : 'good',
    count,
    headline,
    detail,
    names: [...none, ...heavy].map((r) => teamName(r.teamName, language)),
    action: count > 0 && action ? { ...action, label: dynText(language, 'picks.action') } : null,
  }
}

// ── Taxi squads over their limit ───────────────────────────────────────────

export function taxiOverLimitFlag(
  taxi: DynastyTaxiOverLimit | null,
  action: HealthFlagAction | null,
  language?: string,
): HealthFlag {
  const label = dynText(language, 'taxi.label')
  if (!taxi) return { key: 'taxi', label, measured: false, reason: dynText(language, 'taxi.unread'), action: null }
  if (!taxi.measured) {
    return {
      key: 'taxi',
      label,
      measured: false,
      reason: dynText(language, taxi.reason === 'no_limit' ? 'taxi.noLimit' : 'taxi.noRosters'),
      action: null,
    }
  }
  const over = taxi.teams
  return {
    key: 'taxi',
    label,
    measured: true,
    severity: over.length > 0 ? 'warn' : 'good',
    count: over.length,
    headline:
      over.length === 0
        ? dynText(language, 'taxi.okHeadline', { limit: taxi.limit })
        : plural(language, 'taxi.overHeadline', over.length, { limit: taxi.limit }),
    detail:
      over.length === 0
        ? dynText(language, 'taxi.okDetail')
        : dynText(language, 'taxi.overDetail', {
            names: names(over.map((t) => dynText(language, 'names.held', { team: teamName(t.teamName, language), n: t.held })), language),
          }),
    names: over.map((t) => teamName(t.teamName, language)),
    action: over.length > 0 && action ? { ...action, label: dynText(language, 'taxi.action') } : null,
  }
}

// ── Rookie draft order ─────────────────────────────────────────────────────

export type RookieOrderInput =
  /** An imported league: its platform orders the rookie draft. */
  | { kind: 'imported'; platformLabel: string }
  /** A native league; `rollover` is null when it has no finished season on file. */
  | { kind: 'native'; rollover: Pick<DynastyRolloverInput, 'season' | 'nextSeason' | 'seasonOver' | 'started' | 'rookieDraft' | 'draftOrder'> | null }

/**
 * `rookieOrderWords` (the rollover wizard's own copy) speaks English and Spanish only; any other
 * language reads its English. This picks the language, it holds no copy of its own.
 */
const ROOKIE_WORDS_LANGUAGES: ReadonlySet<string> = new Set(['en', 'es'])
function rookieWordsLanguage(language: string | undefined): 'en' | 'es' {
  return ROOKIE_WORDS_LANGUAGES.has(language ?? '') ? (language as 'en' | 'es') : 'en'
}

export function rookieOrderFlag(input: RookieOrderInput, action: HealthFlagAction | null, language?: string): HealthFlag {
  const label = dynText(language, 'order.label')
  const lang = rookieWordsLanguage(language)
  if (input.kind === 'imported') {
    return { key: 'rookie_order', label, measured: false, reason: dynText(language, 'order.imported', { platform: input.platformLabel }), action: null }
  }
  const r = input.rollover
  if (!r) return { key: 'rookie_order', label, measured: false, reason: dynText(language, 'order.noSeason'), action: null }
  const method = rookieOrderWords(r.draftOrder.source, lang)
  const good = (headline: string, detail: string): HealthFlag => ({
    key: 'rookie_order',
    label,
    measured: true,
    severity: 'good',
    count: 0,
    headline,
    detail,
    names: [],
    action: null,
  })
  // Mid-season the order is not due: it is fixed from the final standings.
  if (!r.seasonOver && !r.started) {
    return good(dynText(language, 'order.notDueHeadline', { season: r.season }), dynText(language, 'order.notDueDetail', { next: r.nextSeason, method }))
  }
  if (r.started || r.rookieDraft !== 'none' || r.draftOrder.finalOrderSaved) {
    return good(
      dynText(language, 'order.setHeadline', { next: r.nextSeason }),
      r.rookieDraft === 'complete'
        ? dynText(language, 'order.doneDetail', { next: r.nextSeason })
        : dynText(language, 'order.setDetail', { method }),
    )
  }
  return {
    key: 'rookie_order',
    label,
    measured: true,
    severity: 'warn',
    count: 1,
    headline: dynText(language, 'order.unsetHeadline', { next: r.nextSeason }),
    detail: dynText(language, 'order.unsetDetail', { next: r.nextSeason, method }),
    names: [],
    action: action ? { ...action, label: dynText(language, 'order.action') } : null,
  }
}
