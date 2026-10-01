'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'

import { LeagueCrest, platformKey } from '@/components/core-app/boards/BoardKit'
import {
  SWING_BADGE_PTS,
  LUCK_THRESHOLD,
  TIER_LABEL,
  TIER_ORDER,
  byOdds,
  bySeed,
  type StandingsRow,
  type Tier,
} from '@/lib/core-app/standingsPortfolio'

/**
 * The interactive half of the cross-league standings board: tier filter, sort, search, and every
 * league — not ten of them with "55 more sit between these two columns" as the only route to the rest.
 *
 * ⚠ THE SEARCH BOX IS 16PX ON PURPOSE. iOS Safari zooms the page on focus into any input under 16px
 * and does not zoom back out, which on a phone leaves the board panned sideways.
 */

type SortKey = 'odds' | 'seed' | 'title' | 'luck' | 'name'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'odds', label: 'Playoff odds' },
  { key: 'seed', label: 'Seed' },
  { key: 'title', label: 'Title odds' },
  { key: 'luck', label: 'Luck' },
  { key: 'name', label: 'A–Z' },
]

/** Rows drawn before "Show all" on the unfiltered board. Enough to fill a laptop screen, not a novel. */
const FIRST_PAGE = 12

const TIER_SEV: Record<Tier, 'good' | 'warn' | 'bad' | 'muted'> = {
  clinched: 'good',
  control: 'good',
  bubble: 'warn',
  longshot: 'bad',
  out: 'muted',
}

function sorter(key: SortKey): (a: StandingsRow, b: StandingsRow) => number {
  switch (key) {
    case 'seed':
      return bySeed
    case 'title':
      return (a, b) => b.titlePct - a.titlePct || byOdds(a, b)
    case 'luck':
      /* Unknown luck sorts last, never as zero — "no read" is not "exactly as earned". */
      return (a, b) => (b.luck ?? -Infinity) - (a.luck ?? -Infinity) || byOdds(a, b)
    case 'name':
      return (a, b) => a.name.localeCompare(b.name)
    default:
      return byOdds
  }
}

export function StandingsExplorer({
  rows,
  tierCounts,
}: {
  rows: StandingsRow[]
  tierCounts: Record<Tier, number>
}) {
  const [tier, setTier] = useState<Tier | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('odds')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => (tier === 'all' ? true : r.tier === tier))
      .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
      .sort(sorter(sort))
  }, [rows, tier, sort, query])

  const narrowed = tier !== 'all' || query.trim() !== ''
  const visible = expanded || narrowed ? filtered : filtered.slice(0, FIRST_PAGE)
  const hidden = filtered.length - visible.length
  /* Tier dividers only where the order IS the tiers — the default odds sort over every league. */
  const grouped = sort === 'odds' && tier === 'all'

  return (
    <section className="af-sb-explore" aria-label="Every league, by standing">
      <div className="af-sb-controls">
        <div className="af-sb-chips" role="group" aria-label="Filter by standing">
          <button type="button" className="af-sb-chip" aria-pressed={tier === 'all'} onClick={() => setTier('all')}>
            All <span className="af-sb-chip-n">{rows.length}</span>
          </button>
          {TIER_ORDER.filter((t) => tierCounts[t] > 0).map((t) => (
            <button
              key={t}
              type="button"
              className="af-sb-chip"
              data-sev={TIER_SEV[t]}
              aria-pressed={tier === t}
              onClick={() => setTier(tier === t ? 'all' : t)}
            >
              {TIER_LABEL[t]} <span className="af-sb-chip-n">{tierCounts[t]}</span>
            </button>
          ))}
        </div>
        <div className="af-sb-tools">
          <label className="af-sb-search">
            <span className="af-sb-visually-hidden">Find a league</span>
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Find a league"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="af-sb-sort">
            <span className="af-sb-sort-k">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visible.length > 0 ? (
        <ul className="af-sb-list">
          {visible.map((r, i) => {
            const divider = grouped && (i === 0 || visible[i - 1].tier !== r.tier)
            return (
              <li key={r.id} className="af-sb-item">
                {divider ? (
                  <p className="af-sb-divider" data-sev={TIER_SEV[r.tier]}>
                    {TIER_LABEL[r.tier]} <span>{tierCounts[r.tier]}</span>
                  </p>
                ) : null}
                <Row row={r} />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="af-sb-empty">No league matches{query.trim() ? ` “${query.trim()}”` : ''}.</p>
      )}

      {hidden > 0 ? (
        <button type="button" className="af-sb-more" onClick={() => setExpanded(true)}>
          Show all {filtered.length} leagues
        </button>
      ) : null}
    </section>
  )
}

/**
 * The seed track: one pip per team, the playoff field shaded, the bye seeds marked, and you lit.
 *
 * ⚠ THIS IS WHY "#7 of 12" STOPPED NEEDING A SENTENCE. The old row printed the seed and IN / OUT; the
 * track shows how far inside or outside the line that seed is, which is the actual question.
 */
function SeedTrack({ row }: { row: StandingsRow }) {
  const pips = Array.from({ length: Math.max(row.teams, 1) }, (_, i) => i + 1)
  return (
    <span
      className="af-sb-track"
      role="img"
      aria-label={`Seed ${row.seed} of ${row.teams}; the top ${row.playoffTeams} make the playoffs`}
      data-dense={row.teams > 16 || undefined}
    >
      {pips.map((s) => (
        <span
          key={s}
          className="af-sb-pip"
          data-field={s <= row.playoffTeams || undefined}
          data-bye={s <= row.byeTeams || undefined}
          data-cut={s === row.playoffTeams || undefined}
          data-you={s === row.seed ? TIER_SEV[row.tier] : undefined}
        />
      ))}
    </span>
  )
}

function Ring({ row }: { row: StandingsRow }) {
  const sev = TIER_SEV[row.tier]
  return (
    <span className="af-sb-ring" data-sev={sev} style={{ ['--p' as string]: String(row.pct) }}>
      <span className="af-sb-ring-v">
        {row.pct}%{row.modelled ? '' : '*'}
      </span>
    </span>
  )
}

function Row({ row }: { row: StandingsRow }) {
  const sev = TIER_SEV[row.tier]
  const swingPts = row.swing ? row.swing.ifWin - row.swing.ifLose : 0
  return (
    <Link className="af-sb-row" href={row.href} data-sev={sev}>
      <LeagueCrest name={row.name} platform={row.platform} size="sm" />
      <span className="af-sb-main">
        <span className="af-sb-name-line">
          <span className="af-sb-name">{row.name}</span>
          {row.tier === 'clinched' ? <Badge sev="good">Clinched</Badge> : null}
          {row.tier === 'out' && row.record != null ? <Badge sev="muted">Eliminated</Badge> : null}
          {row.seed === 1 && row.record != null ? <Badge sev="accent">#1 seed</Badge> : null}
          {row.losses === 0 && row.wins >= 2 ? <Badge sev="good">Unbeaten</Badge> : null}
          {row.luck != null && row.luck >= LUCK_THRESHOLD ? <Badge sev="warn">Lucky {fmtLuck(row.luck)}</Badge> : null}
          {row.luck != null && row.luck <= -LUCK_THRESHOLD ? <Badge sev="bad">Robbed {fmtLuck(row.luck)}</Badge> : null}
        </span>
        <span className="af-sb-sub">
          <span className="af-bd-plat" data-platform={platformKey(row.platform)}>
            {row.platform.toUpperCase()}
          </span>
          {' · '}
          {/* ⚠ AN ABSENT RECORD IS NOT 0-0. A freshly synced league carries a season of unplayed rows. */}
          {row.record ?? 'no games played yet'}
          {row.titlePct > 0 ? ` · ${row.titlePct}% title` : ''}
          {row.weeksRemaining > 0 ? ` · ${row.weeksRemaining} ${row.weeksRemaining === 1 ? 'week' : 'weeks'} left` : ''}
        </span>
        <SeedTrack row={row} />
        <span className="af-sb-decides" title={row.decides}>
          {row.swing && swingPts >= SWING_BADGE_PTS ? (
            <span className="af-sb-swing">
              Wk {row.swing.week}
              {row.swing.opponent ? ` vs ${row.swing.opponent}` : ''}: win {row.swing.ifWin}% · lose {row.swing.ifLose}%
            </span>
          ) : null}
          {row.decides}
        </span>
      </span>
      <span className="af-sb-side">
        <Ring row={row} />
        <span className="af-sb-seed" data-sev={sev}>
          #{row.seed} of {row.teams}
        </span>
        <span className="af-sb-inout" data-sev={sev}>
          {row.inField ? (row.inBye ? 'Bye' : 'In') : 'Out'}
        </span>
      </span>
    </Link>
  )
}

function Badge({ sev, children }: { sev: 'good' | 'warn' | 'bad' | 'accent' | 'muted'; children: ReactNode }) {
  return (
    <span className="af-sb-badge" data-sev={sev}>
      {children}
    </span>
  )
}

function fmtLuck(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
}

export default StandingsExplorer
