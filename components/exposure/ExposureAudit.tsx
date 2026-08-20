'use client'

/**
 * 12b — the exposure audit view.
 *
 * ⚠ FOLDED INTO `/my-players`, WHICH ALREADY PROMISED IT. The handoff names
 * `/players/exposure`. That route does not exist, `/players` itself is a PUBLIC,
 * hour-cached SEO index that must not become an authed per-user surface, and the
 * repo is near Vercel's route ceiling. Meanwhile `DashboardV2` already renders a
 * link reading **"Full exposure audit" → /my-players**. So the destination was
 * already advertised; it just did not contain an audit. This is that audit, on
 * that route, as a second view beside the existing card list.
 *
 * ⚠ IT READS THE SAME PAYLOAD THE CARD LIST ALREADY FETCHED. No second request
 * and no second source of truth — a table and a card list on one screen
 * disagreeing about how many leagues hold a player is worse than either alone.
 */

import { useMemo, useState } from 'react'

import ExposureTable, {
  isInjured,
  isOverexposed,
  OVEREXPOSED_THRESHOLD,
  type ExposureFilter,
  type ExposureRow,
} from './ExposureTable'

// The chip's label is generated from the same constant the filter compares
// against, so "50%+" cannot outlive a change to the threshold.
const FILTERS: { id: ExposureFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'starting', label: 'Starting' },
  { id: 'injured', label: 'Injured' },
  { id: 'threshold', label: `${Math.round(OVEREXPOSED_THRESHOLD * 100)}%+` },
]

export function ExposureAudit({
  rows,
  connectedLeagueCount,
}: {
  rows: ExposureRow[]
  connectedLeagueCount: number
}) {
  const [filter, setFilter] = useState<ExposureFilter>('all')

  /*
   * Most-exposed first. The audit's job is to put what you are most concentrated
   * in at the top; an alphabetical list of forty players answers nothing.
   * Injured players break ties upward, because that is the exposure that needs a
   * decision this week.
   */
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (b.exposurePercent !== a.exposurePercent) return b.exposurePercent - a.exposurePercent
        const ai = isInjured(a.injuryStatus) ? 1 : 0
        const bi = isInjured(b.injuryStatus) ? 1 : 0
        if (ai !== bi) return bi - ai
        return (a.name ?? '').localeCompare(b.name ?? '')
      }),
    [rows],
  )

  const overexposedCount = useMemo(
    () => sorted.filter((r) => isOverexposed(r, connectedLeagueCount)).length,
    [sorted, connectedLeagueCount],
  )

  return (
    <div className="af-core af-cm-shell" style={{ minHeight: 0, padding: 0, background: 'transparent' }}>
      <div className="af-cm">
        <header className="af-cm-head">
          <div className="af-cm-head-titles">
            <h2 className="af-cm-title">Exposure audit</h2>
            <span className="af-cm-sub">
              {/* The denominator is stated up front — a percentage with a hidden base is not checkable. */}
              measured against your {connectedLeagueCount} connected{' '}
              {connectedLeagueCount === 1 ? 'league' : 'leagues'}
            </span>
          </div>
          <div className="af-xp-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="af-xp-filter"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </header>

        {/*
          ⚠ VERBATIM, BEFORE THE TABLE, ALWAYS. Build rule 1. Both clauses of the
          rule are here because the second one — that a single-league user cannot
          be overexposed — is the half a reader would never infer.
        */}
        <p className="af-xp-definition">
          A player is called overexposed only when he&apos;s in half or more of your leagues <strong>and</strong> you
          have more than one league. Owning your only team&apos;s roster isn&apos;t a choice.
        </p>

        {connectedLeagueCount <= 1 ? (
          <p className="af-cm-empty" style={{ marginBottom: 14 }}>
            You have one connected league, so nothing here can be overexposure — the table below is still an honest
            picture of what you roster.
          </p>
        ) : overexposedCount > 0 ? (
          <p className="af-cm-sub" style={{ marginBottom: 14 }}>
            {overexposedCount} {overexposedCount === 1 ? 'player is' : 'players are'} over the line.
          </p>
        ) : null}

        <ExposureTable rows={sorted} connectedLeagueCount={connectedLeagueCount} filter={filter} />

        <div className="af-cm-foot">
          {/*
            Build rule 4, said out loud. The portfolio marks identity confidence,
            and an unresolved row renders as a slot rather than a guessed name.
          */}
          <span>
            Rows are built from your real rosters in each league. A player AllFantasy can&apos;t name yet shows his slot
            honestly rather than a guessed name.
          </span>
        </div>
      </div>
    </div>
  )
}

export default ExposureAudit
