import Link from 'next/link'
import {
  DEFAULT_MIN_SAMPLE,
  MIN_SAMPLE_OPTIONS,
  type FilterOptions,
  type RankingFilters,
} from '@/lib/core-app/rankingsEngine'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { RankingsFilterSummary } from '@/components/core-app/rankings/RankingsGuide'

/**
 * The filter row — a GET form.
 *
 * ⚠ NO CLIENT JAVASCRIPT. Every filter is a query parameter, so a filtered board
 * is a URL: it survives a reload, the back button undoes it, and it can be sent
 * to someone. The Apply button is the submit; nothing auto-submits on change,
 * because a select that navigates on change strands keyboard users mid-list.
 *
 * ⚠ OPTIONS COME FROM THE ROWS. Each select offers only values that exist in the
 * ledger being viewed, with a count, so no choice can produce an empty board by
 * construction. A value already chosen stays listed even if its count is zero.
 *
 * Position is not here, deliberately: managers and leagues have no position.
 * It filters the player pickers on the Compare → Players tab, where it applies.
 */
export function RankingsFilterBar({
  filters,
  options,
  hidden,
  resetHref,
  label = null,
  unit = 'league-seasons',
}: {
  filters: RankingFilters
  options: FilterOptions
  /** Params the form must carry through (scope, league, board, view…). */
  hidden: Array<[string, string]>
  resetHref: string
  /** What the filters narrow the board to ("NFL · Sleeper") — said in the folded summary. */
  label?: string | null
  unit?: string
}) {
  const active = [filters.platform, filters.sport, filters.type, filters.format, filters.season, filters.league].filter((v) => v != null).length
  const changed = active + (filters.minSample !== DEFAULT_MIN_SAMPLE ? 1 : 0)
  const form = (className: string) => (
    <form className={className} action="/core/rankings" method="get" aria-label="Ranking filters">
      {hidden.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Select name="sport" label="Sport" value={filters.sport ?? ''} options={options.sports} unit={unit} />
      <Select name="platform" label="Platform" value={filters.platform ?? ''} options={options.platforms} unit={unit} />
      <Select name="type" label="League type" value={filters.type ?? ''} options={options.types} unit={unit} />
      <Select name="format" label="Format" value={filters.format ?? ''} options={options.formats} unit={unit} />
      <Select
        name="season"
        label="Season"
        value={filters.season != null ? String(filters.season) : ''}
        options={options.seasons.map((s) => ({ value: String(s.value), label: s.label, count: s.count }))}
        unit={unit}
      />
      {options.leagues?.length ? (
        <Select name="careerLeague" label="League" value={filters.league ?? ''} options={options.leagues} unit={unit} />
      ) : null}
      <label className="af-rk-field">
        <span>Min. sample</span>
        <select name="min" defaultValue={String(filters.minSample)}>
          {MIN_SAMPLE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}+ league-{n === 1 ? 'season' : 'seasons'}
            </option>
          ))}
        </select>
      </label>
      <div className="af-rk-filter-actions">
        <button type="submit" className="af-rk-btn af-rk-btn--primary">
          Apply
        </button>
        {changed > 0 ? (
          <Link className="af-rk-btn" href={resetHref}>
            Reset
          </Link>
        ) : null}
      </div>
    </form>
  )
  /*
   * ⚠ ONE FOLDED FORM AT EVERY WIDTH (2026-11-14). Six dropdowns and Apply sat open above the board on a
   * tablet or desktop even when nothing was filtered. The fold's summary says what the board is narrowed
   * to ("Filters · All leagues"), and it opens on arrival when a filter is set, so a narrowed board never
   * hides why. It used to be two copies of the form, one per width, because a closed <details> cannot be
   * opened by a media query; with one fold at every width there is one form.
   */
  return (
    <details className="af-rk-filterdrawer af-rk-filterdrawer--all" open={changed > 0 || undefined}>
      <summary className="af-rk-btn">
        {label != null ? <RankingsFilterSummary label={label} changed={changed} /> : <>Filters{changed > 0 ? ` · ${changed} on` : ''}</>}
      </summary>
      {form('af-rk-filters')}
    </details>
  )
}

function Select({
  name,
  label,
  value,
  options,
  unit,
}: {
  name: string
  label: string
  value: string
  options: Array<{ value: string; label: string; count: number }>
  unit: string
}) {
  const list = value && !options.some((o) => o.value === value) ? [{ value, label: value, count: 0 }, ...options] : options
  return (
    <label className="af-rk-field">
      <span>{label}</span>
      <select name={name} defaultValue={value}>
        <option value="">All</option>
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count.toLocaleString(getAppIntlLocale())} {unit})
          </option>
        ))}
      </select>
    </label>
  )
}

