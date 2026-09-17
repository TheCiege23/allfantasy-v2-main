'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { careerHref, isUnfiltered, type CareerData, type CareerFilter } from '@/lib/core-app/careerModel'
import { platformLabel } from '@/lib/core-app/rankingsEngine'

/**
 * The career screen's navigation: the tab row and the filter bar (brief item 3).
 *
 * ⚠ EVERY CONTROL IS A LINK OR A GET FORM FIRST. The selects navigate on change
 * for convenience, but each sits in a form with a real submit button, so the
 * filter works before hydration and without script — the rest of `/core` makes
 * the same promise with plain links.
 *
 * ⚠ THE TABS SCROLL, THEY DO NOT WRAP. Nine views do not fit a phone. A wrapped
 * tab row pushes the page down by a row per breakpoint; a scrolled one keeps its
 * height, and the current tab is scrolled into view on load.
 */

export const CAREER_TABS: Array<{ key: string; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'seasons', label: 'Seasons' },
  { key: 'progress', label: 'Progress' },
  { key: 'peers', label: 'Peers' },
  { key: 'records', label: 'Records' },
  { key: 'awards', label: 'Awards' },
  { key: 'hall', label: 'Hall of Fame' },
  { key: 'coverage', label: 'Coverage' },
]

export function CareerTabs({ view, filter }: { view: string; filter: CareerFilter }) {
  const strip = useRef<HTMLElement | null>(null)
  useEffect(() => {
    /*
     * ⚠ SCROLL THE STRIP, NEVER THE PAGE, AND MEASURE BY RECTS. `scrollIntoView`
     * also scrolls the window, which jumps a reader who had scrolled down; and
     * `offsetLeft` counts from the offsetParent, which is not this strip — the
     * league tab bar shipped that bug once (it read 1165 against a true 900).
     */
    const el = strip.current
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !current) return
    const a = el.getBoundingClientRect()
    const b = current.getBoundingClientRect()
    if (b.left < a.left || b.right > a.right) {
      el.scrollLeft += b.left - a.left - (a.width - b.width) / 2
    }
  }, [view])
  return (
    <nav className="af-crx-tabs" aria-label="Career views" ref={strip}>
      {CAREER_TABS.map((t) =>
        t.key === view ? (
          <span key={t.key} className="af-cr-tab" aria-current="page">
            {t.label}
          </span>
        ) : (
          <Link key={t.key} className="af-cr-tab" href={careerHref(filter, { view: t.key === 'overview' ? null : t.key })}>
            {t.label}
          </Link>
        ),
      )}
    </nav>
  )
}

/**
 * Platform and sport as chips (few options), league and era as selects (many).
 * A chip row with one option is furniture, so each row only renders when there
 * is a choice to make.
 *
 * ⚠ FOLDED UNTIL IT IS USED. Brief item 1 puts accomplishments first, and an
 * open filter bar is ~180px of controls above them. Closed, it is one line that
 * says what you are looking at; it opens by itself whenever a filter is set, so
 * a narrowed board never hides the fact that it is narrowed.
 */
export function CareerFilterBar({ data, view }: { data: CareerData; view: string }) {
  const router = useRouter()
  const f = data.filter
  const opts = data.filterOptions
  const viewParam = view === 'overview' ? null : view
  const go = (next: Partial<CareerFilter>) => router.push(careerHref({ ...f, ...next }, { view: viewParam }))

  const seasons = opts.seasons
  const newest = seasons[seasons.length - 1]
  const eraPresets =
    seasons.length > 1 && newest != null
      ? [
          { label: 'All time', from: null, to: null },
          { label: 'Last 3 seasons', from: newest - 2, to: newest },
          { label: `${newest}`, from: newest, to: newest },
        ]
      : []

  const filtered = !isUnfiltered(f)
  const leagueName = f.league ? opts.leagues.find((l) => l.key === f.league)?.name ?? f.league : null
  const summary = [
    leagueName ?? 'All leagues',
    f.platform ? platformLabel(f.platform) : 'all platforms',
    f.sport ? f.sport : opts.sports.length > 1 ? 'all sports' : null,
    f.fromSeason != null || f.toSeason != null
      ? f.fromSeason === f.toSeason
        ? String(f.fromSeason)
        : `${f.fromSeason ?? 'start'}–${f.toSeason ?? 'now'}`
      : 'all seasons',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <details className="af-crx-filter" open={filtered} aria-label="Filter your career">
      <summary className="af-crx-filter-sum">
        <span className="af-crx-filter-k">Filter</span>
        <span className="af-crx-filter-v">{summary}</span>
      </summary>
      <div className="af-crx-filter-row">
        {opts.platforms.length > 1 ? (
          <div className="af-cr-filter" role="group" aria-label="Platform">
            <Link className="af-cr-filter-opt" aria-current={f.platform == null ? 'true' : undefined} href={careerHref({ ...f, platform: null }, { view: viewParam })}>
              All platforms
            </Link>
            {opts.platforms.map((p) => (
              <Link
                key={p}
                className="af-cr-filter-opt"
                aria-current={f.platform === p ? 'true' : undefined}
                href={careerHref({ ...f, platform: p }, { view: viewParam })}
              >
                {platformLabel(p)}
              </Link>
            ))}
          </div>
        ) : null}
        {opts.sports.length > 1 ? (
          <div className="af-cr-filter" role="group" aria-label="Sport">
            <Link className="af-cr-filter-opt" aria-current={f.sport == null ? 'true' : undefined} href={careerHref({ ...f, sport: null }, { view: viewParam })}>
              All sports
            </Link>
            {opts.sports.map((s) => (
              <Link
                key={s}
                className="af-cr-filter-opt"
                aria-current={f.sport === s ? 'true' : undefined}
                href={careerHref({ ...f, sport: s }, { view: viewParam })}
              >
                {s}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {/* Keyed on the filter: the selects are uncontrolled, and a reused form would keep the last value. */}
      <form key={careerHref(f)} className="af-crx-filter-row" method="get" action="/core/career">
        {viewParam ? <input type="hidden" name="view" value={viewParam} /> : null}
        {f.platform ? <input type="hidden" name="platform" value={f.platform} /> : null}
        {f.sport ? <input type="hidden" name="sport" value={f.sport} /> : null}
        <label className="af-crx-select">
          <span>League</span>
          <select name="lg" defaultValue={f.league ?? ''} onChange={(e) => go({ league: e.target.value || null })}>
            <option value="">All leagues ({opts.leagues.length})</option>
            {opts.leagues.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name} · {l.firstSeason === l.lastSeason ? l.firstSeason : `${l.firstSeason}–${l.lastSeason}`}
              </option>
            ))}
          </select>
        </label>
        {seasons.length > 1 ? (
          <>
            <label className="af-crx-select">
              <span>From</span>
              <select
                name="from"
                defaultValue={f.fromSeason != null ? String(f.fromSeason) : ''}
                onChange={(e) => go({ fromSeason: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">First season</option>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="af-crx-select">
              <span>To</span>
              <select
                name="to"
                defaultValue={f.toSeason != null ? String(f.toSeason) : ''}
                onChange={(e) => go({ toSeason: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Latest season</option>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <button type="submit" className="af-crx-apply">
          Apply
        </button>
      </form>

      {eraPresets.length > 0 ? (
        <div className="af-cr-filter" role="group" aria-label="Era">
          {eraPresets.map((p) => (
            <Link
              key={p.label}
              className="af-cr-filter-opt"
              aria-current={f.fromSeason === p.from && f.toSeason === p.to ? 'true' : undefined}
              href={careerHref({ ...f, fromSeason: p.from, toSeason: p.to }, { view: viewParam })}
            >
              {p.label}
            </Link>
          ))}
        </div>
      ) : null}

      {filtered ? (
        <p className="af-crx-filter-state" role="status">
          Showing{' '}
          <b>
            {[
              leagueName ?? 'every league',
              f.platform ? `on ${platformLabel(f.platform)}` : null,
              f.sport ? `in ${f.sport}` : null,
              f.fromSeason != null || f.toSeason != null
                ? f.fromSeason === f.toSeason
                  ? `in ${f.fromSeason}`
                  : `from ${f.fromSeason ?? 'the start'} to ${f.toSeason ?? 'now'}`
                : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </b>
          .{' '}
          <Link href={careerHref({ platform: null, sport: null, league: null, fromSeason: null, toSeason: null }, { view: viewParam })}>
            Clear filters
          </Link>
        </p>
      ) : null}
    </details>
  )
}
