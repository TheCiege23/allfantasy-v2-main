import Link from 'next/link'

import type { CareerData } from '@/lib/core-app/career'
import type { CareerRecordsData } from '@/lib/core-app/careerRecords'
import { SectionHead } from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * The three Career tabs that were "not built yet" panels until 2026-09-07.
 *
 * Handoff files `AF Core Career Seasons.dc.html`, `… Hall of Fame.dc.html` and
 * `… Records.dc.html`. Seasons and Hall of Fame are pure renders of data
 * `getCareerData` already returned and was throwing away; Records has its own
 * loader.
 *
 * ⚠ EACH VIEW DISTINGUISHES "NOTHING TO SHOW" FROM "NOT BUILT". The panel these
 * replaced said "not built yet", which was true then and would be a lie now — so
 * an empty Hall of Fame says you have not won one, which is a different and
 * much more useful sentence.
 */

const nf = (n: number) => n.toLocaleString()

/* ── Seasons ─────────────────────────────────────────────────────────────── */

/**
 * One row per season, most recent first.
 *
 * ⚠ `winRate` IS NULL, NOT ZERO, WHEN NO GAME WAS PLAYED. `/api/user/rank`
 * already has the inverse bug written down — it computes `totalGames > 0 ? … : 0`
 * and hands back a 0% record for a manager who has played nothing. This screen
 * withholds instead, and so must anything else reading these rows.
 */
export function CareerSeasonsView({ data }: { data: CareerData }) {
  const seasons = [...data.seasons].sort((a, b) => b.season - a.season)
  const current = data.currentSeason

  if (seasons.length === 0) {
    return (
      <div className="af-bd">
        <p className="af-bd-note">
          No season of yours has completed games on file yet. This view is built from played
          weeks, so it fills in as your leagues run —{' '}
          <Link href="/import?returnTo=%2Fcore%2Fcareer%3Fview%3Dseasons">
            import past seasons
          </Link>{' '}
          to backfill it.
        </p>
      </div>
    )
  }

  const totalLeagueSeasons = seasons.reduce((n, s) => n + s.leagueCount, 0)

  return (
    <div className="af-bd">
      <section className="af-bd-sec" aria-labelledby="af-cs-head">
        <SectionHead
          id="af-cs-head"
          label="Season by season · most recent first"
          count={`${seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'} · ${nf(totalLeagueSeasons)} league-seasons`}
        />
        <ul className="af-bd-rows">
          {seasons.map((s) => (
            <li key={s.season}>
              <div className="af-bd-row">
                <span
                  className="af-bd-stat af-bd-stat--narrow"
                  data-sev={s.season === current ? undefined : undefined}
                  style={s.season === current ? { color: 'var(--accent)' } : undefined}
                >
                  {s.season}
                </span>
                <span className="af-bd-league">
                  <span className="af-bd-name">
                    {s.leagueCount} {s.leagueCount === 1 ? 'league' : 'leagues'}
                  </span>
                  <span className="af-bd-sub">
                    {s.games} {s.games === 1 ? 'game' : 'games'} played
                    {s.playoffAppearances > 0
                      ? ` · ${s.playoffAppearances} playoff ${s.playoffAppearances === 1 ? 'berth' : 'berths'}`
                      : ''}
                  </span>
                </span>
                <span className="af-bd-mid">
                  <span className="af-bd-tag" data-sev={s.championships > 0 ? 'good' : 'info'}>
                    {s.championships > 0
                      ? `${s.championships} ${s.championships === 1 ? 'TITLE' : 'TITLES'}`
                      : 'NO TITLE'}
                  </span>
                </span>
                <span className="af-bd-stat af-bd-stat--narrow">
                  {s.wins}-{s.losses}
                  {s.ties > 0 ? `-${s.ties}` : ''}
                </span>
                <span
                  className="af-bd-stat af-bd-stat--narrow"
                  data-sev={
                    s.winRate == null ? undefined : s.winRate >= 0.5 ? 'good' : 'warn'
                  }
                >
                  {/*
                    ⚠ AN EM DASH, NOT 0%. A season with no completed games has an
                    undefined win rate; printing 0% says the manager lost every
                    game they played.
                  */}
                  {s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(1)}%`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="af-bd-note">
        Built from completed weeks only — a league still in progress contributes the games it has
        actually played, not its full schedule.
      </p>
    </div>
  )
}

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

/* ── Records ─────────────────────────────────────────────────────────────── */

export function CareerRecordsView({ records }: { records: CareerRecordsData | null }) {
  if (!records) {
    return (
      <div className="af-bd">
        <p className="af-bd-note">
          We could not read your weekly results just now. This is a read failure on our side, not
          a career with nothing in it.
        </p>
      </div>
    )
  }

  if (records.records.length === 0) {
    return (
      <div className="af-bd">
        <p className="af-bd-note">
          No played week is on file for any team you have claimed, so there is nothing to take a
          record from yet. Records are built from real weekly scores — a synced league with an
          unstarted season contributes none.
        </p>
      </div>
    )
  }

  return (
    <div className="af-bd">
      <section className="af-bd-sec" aria-labelledby="af-rec-head">
        <SectionHead
          id="af-rec-head"
          label="Personal bests and worsts"
          count={`${nf(records.weeksCounted)} played weeks across ${nf(records.leaguesCounted)} leagues`}
        />
        <ul className="af-bd-grid">
          {records.records.map((r) => (
            <li key={r.key} className="af-bd-statcard">
              <span className="af-bd-statcard-k">{r.label}</span>
              <span className="af-bd-statcard-v" data-sev={r.tone}>
                {r.value}
              </span>
              <span className="af-bd-statcard-c">{r.context}</span>
            </li>
          ))}
        </ul>
      </section>

      {/*
        ⚠ THE GAPS ARE NAMED WITH THEIR REASON. The design draws ten cards; two
        of them have no table behind them, and a grid that is quietly short reads
        as a bug. Saying which two and why is the difference between a known gap
        and a broken screen.
      */}
      {records.missing.length > 0 ? (
        <p className="af-bd-note">
          <strong>Two records in the design are not here.</strong>{' '}
          {records.missing.map((m) => `${m.label} — ${m.reason}`).join('; ')}.
        </p>
      ) : null}

      <p className="af-bd-note">
        Every figure comes from weeks that were actually played. A synced fixture with no points
        on either side is an unplayed game, not a nil-all draw, and is excluded — otherwise every
        manager on the product would carry a lowest-ever week of 0.0.
      </p>
    </div>
  )
}
