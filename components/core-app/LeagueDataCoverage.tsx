import type {
  LeagueDataCoverage as LeagueDataCoverageData,
  LeagueDataCoverageStatus,
} from '@/lib/core-app/leagueDataCoverage'
import { ScrollToHashOnMount } from '@/components/core-app/ScrollToHashOnMount'
import '@/components/core-app/af-league-coverage.css'

/**
 * "What's on file from <platform>" — one row per kind of history, on the league Overview.
 *
 * ⚠ THE STATUS IS PRINTED AS WORDS, NOT ONLY AS A COLOUR OR GLYPH. Six rows whose only
 * difference is a dot's colour cannot be read by anyone who does not see that colour, and
 * "unsupported" and "none" would look identical in greyscale while asking the reader for
 * opposite things.
 *
 * The anchor id is load-bearing: the league header's source chip links here from every tab.
 */
export const LEAGUE_DATA_COVERAGE_ANCHOR = 'league-data-coverage'

const STATUS_LABEL: Record<LeagueDataCoverageStatus, string> = {
  available: 'On file',
  importing: 'Importing',
  not_published: 'Not published',
  unsupported: 'Not imported yet',
  none: 'None',
  unknown: 'Unknown',
}

const GLYPH: Record<LeagueDataCoverageStatus, string> = {
  available: '●',
  importing: '◐',
  not_published: '○',
  unsupported: '○',
  none: '–',
  unknown: '?',
}

export function LeagueDataCoverage({ coverage }: { coverage: LeagueDataCoverageData }) {
  const headingId = `${LEAGUE_DATA_COVERAGE_ANCHOR}-title`
  return (
    <section id={LEAGUE_DATA_COVERAGE_ANCHOR} className="af-card af-ldc" aria-labelledby={headingId}>
      <ScrollToHashOnMount id={LEAGUE_DATA_COVERAGE_ANCHOR} />
      <header className="af-ldc-head">
        <h2 id={headingId} className="af-ldc-title">
          What’s on file from {coverage.platformLabel}
        </h2>
        <p className="af-ldc-sub">History AllFantasy holds for this league, by kind.</p>
      </header>
      <ul className="af-ldc-rows">
        {coverage.rows.map((row) => (
          <li key={row.key} className="af-ldc-row" data-status={row.status}>
            <span className="af-ldc-glyph" aria-hidden>
              {GLYPH[row.status]}
            </span>
            <span className="af-ldc-copy">
              <span className="af-ldc-label">{row.label}</span>
              <span className="af-ldc-detail">{row.detail}</span>
            </span>
            <span className="af-ldc-status">{STATUS_LABEL[row.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Holds the panel's height while the counts stream in, so the page below does not jump. */
export function LeagueDataCoverageSkeleton() {
  return (
    <section className="af-card af-ldc" aria-busy="true" aria-label="Loading what’s on file">
      <header className="af-ldc-head">
        <span className="af-ldc-title af-ldc-shimmer" style={{ width: 180 }} />
      </header>
      <ul className="af-ldc-rows" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="af-ldc-row">
            <span className="af-ldc-glyph" />
            <span className="af-ldc-copy">
              <span className="af-ldc-shimmer" style={{ width: 90 }} />
              <span className="af-ldc-shimmer" style={{ width: 150 }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default LeagueDataCoverage
