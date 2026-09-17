import Link from 'next/link'

import type { CareerData } from '@/lib/core-app/careerModel'
import { SectionHead } from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * The Hall of Fame tab — one of three Career tabs that were "not built yet"
 * panels until 2026-09-07. Seasons and Records moved to
 * `components/core-app/career/CareerBriefViews.tsx` with the 2026-09-16 brief
 * (a full season table and a six-section record book).
 *
 * ⚠ EACH VIEW DISTINGUISHES "NOTHING TO SHOW" FROM "NOT BUILT". The panel these
 * replaced said "not built yet", which was true then and would be a lie now — so
 * an empty Hall of Fame says you have not won one, which is a different and
 * much more useful sentence.
 */

/* ── Hall of Fame ────────────────────────────────────────────────────────── */

/**
 * The trophy case.
 *
 * ⚠ THE DESIGN SHOWS A CHAMPIONSHIP-WEEK SCORE AND THIS DOES NOT. No stored
 * championship box score exists — `CareerTitle` carries season, league, platform
 * and the regular-season record, and nothing joins a title to the final's
 * points. Rendering a score here would be the one invented number on a page
 * whose entire value is that it is not.
 */
export function CareerHallView({ data }: { data: CareerData }) {
  const titles = [...data.titles].sort(
    (a, b) => b.season - a.season || a.leagueName.localeCompare(b.leagueName),
  )

  if (titles.length === 0) {
    return (
      <div className="af-bd">
        <p className="af-bd-note">
          No championship on file yet. This case is built from finished seasons where a league
          recorded you as its champion —{' '}
          {data.leagueCounts.active > 0
            ? `you have ${data.leagueCounts.active} still running.`
            : 'import past seasons to backfill it.'}
        </p>
      </div>
    )
  }

  const leagues = new Set(titles.map((t) => t.leagueName)).size

  return (
    <div className="af-bd">
      <section className="af-bd-sec" aria-labelledby="af-hof-head">
        <SectionHead
          id="af-hof-head"
          label="Championships · most recent first"
          count={`${titles.length} across ${leagues} ${leagues === 1 ? 'league' : 'leagues'}`}
        />
        <ul className="af-bd-rows">
          {titles.map((t, i) => (
            <li key={`${t.season}-${t.leagueName}-${i}`}>
              <div className="af-bd-row">
                <span className="af-bd-rank" aria-hidden>
                  🏆
                </span>
                <span
                  className="af-bd-stat af-bd-stat--narrow"
                  style={t.season === data.currentSeason ? { color: 'var(--accent)' } : undefined}
                >
                  {t.season}
                </span>
                <span className="af-bd-league af-bd-league--wide">
                  <span className="af-bd-name">{t.leagueName}</span>
                  <span className="af-bd-sub">
                    <span className="af-bd-plat" data-platform={t.platform}>
                      {t.platform.toUpperCase()}
                    </span>
                    {t.sport ? ` · ${t.sport}` : ''}
                  </span>
                </span>
                <span className="af-bd-mid">
                  {t.settingsLabel ? (
                    <span className="af-bd-tag" data-sev="info">
                      {t.settingsLabel}
                    </span>
                  ) : null}
                </span>
                <span className="af-bd-stat af-bd-stat--narrow" data-sev="good">
                  {/*
                    The regular-season record, which is what we hold. Null when
                    the source published a title without one — an em dash rather
                    than a fabricated line.
                  */}
                  {t.record ?? '—'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="af-bd-note">
        The record beside each ring is that season&apos;s regular season. We hold no championship
        box score, so no final is shown rather than a score nobody played.
      </p>
    </div>
  )
}
