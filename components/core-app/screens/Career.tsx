'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import '@/components/core-app/af-career.css'

/**
 * Career — your record across every league and season we know about.
 *
 * ⚠ THIS WAS THE LAST RAIL SLOT RENDERING AN APOLOGY. It was pulled out of the
 * nav rather than left pointing at a "not built yet" panel; this puts it back.
 *
 * ⚠ IT FETCHES /api/user/rank INSTEAD OF TAKING A SERVER LOADER, which is a
 * deliberate break from the lib/core-app/<screen>.ts pattern the other screens
 * use. That endpoint is not a plain read: on a cold profile it calls
 * calculateAndSaveRank before it answers. Awaiting that in the page's server
 * render would hold the entire shell — rail, topbar and all — behind a rank
 * recalculation. It also already exists, and this repo is at Vercel's hard route
 * ceiling, so the alternative is a route we cannot afford.
 *
 * ⚠ EVERY NUMBER HERE IS WITHHELD RATHER THAN ZEROED WHEN WE HAVE NO DATA. The
 * endpoint returns winRate: 0 when totalGames is 0 (route.ts computes
 * `totalGames > 0 ? … : 0`), and a 0% win rate rendered on a career page reads as
 * a catastrophic record rather than an empty one. Same for the grade: aiScore is
 * null unless a report exists, and a letter grade next to "import your leagues to
 * unlock" is the exact contradiction the rank route was already fixed to stop
 * emitting. No number is invented to fill a slot.
 */

type CareerStats = {
  seasonsPlayed: number
  totalWins: number
  totalLosses: number
  championships: number
  playoffAppearances: number
  leaguesPlayed: number
}

type RankBlock = {
  aiReportGrade: string | null
  aiScore: number | null
  aiInsight: string | null
  winRate: number | null
  playoffRate: number | null
  totalWins: number
  totalLosses: number
  totalTies: number
}

type RankResponse = {
  imported?: boolean
  level?: number | null
  levelName?: string | null
  tierGroup?: string | null
  color?: string | null
  xpTotal?: number | null
  xpIntoLevel?: number | null
  xpForLevel?: number | null
  progressPct?: number | null
  nextLevelName?: string | null
  careerStats?: CareerStats | null
  rank?: RankBlock | null
  rankProcessing?: boolean
  rankCalculatedAt?: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: RankResponse }

function formatInt(n: number): string {
  return n.toLocaleString('en-US')
}

export function Career() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/rank', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: RankResponse) => {
        if (!cancelled) setState({ kind: 'ready', data })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind === 'loading') {
    return (
      <div className="af-cr">
        <header className="af-cr-head">
          <h1 className="af-cr-title">Career</h1>
        </header>
        <p className="af-cr-sub">Loading your record…</p>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="af-cr">
        <header className="af-cr-head">
          <h1 className="af-cr-title">Career</h1>
        </header>
        {/* A read failure is not the same as an empty career, and saying "no
            history" here would be a lie told by a network error. */}
        <div className="af-cr-empty">
          <p className="af-cr-empty-title">We could not load your career just now.</p>
          <p className="af-cr-empty-body">
            This is a read failure on our side, not a sign that you have no history. Reloading
            usually clears it.
          </p>
        </div>
      </div>
    )
  }

  const { data } = state
  const stats = data.careerStats ?? null
  const rank = data.rank ?? null

  const games = rank ? rank.totalWins + rank.totalLosses + rank.totalTies : 0
  const hasGames = games > 0
  const leaguesPlayed = stats?.leaguesPlayed ?? 0
  const hasHistory = Boolean(stats) && (hasGames || leaguesPlayed > 0 || (stats?.seasonsPlayed ?? 0) > 0)

  if (!hasHistory) {
    return (
      <div className="af-cr">
        <header className="af-cr-head">
          <h1 className="af-cr-title">Career</h1>
        </header>
        <div className="af-cr-empty">
          <p className="af-cr-empty-title">No seasons on record yet.</p>
          <p className="af-cr-empty-body">
            Career is built from finished seasons. Import a league with history and your record,
            titles and playoff runs land here — nothing is shown until then, rather than a page of
            zeroes.
          </p>
          <Link href="/import?returnTo=%2Fcore%2Fcareer" className="af-cr-btn af-cr-btn--primary">
            Import a league
          </Link>
        </div>
        {data.rankProcessing ? (
          <p className="af-cr-notice">
            We are still working through an import. This page will fill in once it finishes.
          </p>
        ) : null}
      </div>
    )
  }

  const record = rank
    ? `${rank.totalWins}-${rank.totalLosses}${rank.totalTies > 0 ? `-${rank.totalTies}` : ''}`
    : stats
      ? `${stats.totalWins}-${stats.totalLosses}`
      : null

  // Withheld unless there are games behind it — see the header note.
  const winRate = hasGames && rank?.winRate != null ? rank.winRate : null
  const playoffRate = leaguesPlayed > 0 && rank?.playoffRate != null ? rank.playoffRate : null

  const levelColor = data.color ?? 'var(--accent)'
  const progressPct =
    data.progressPct != null ? Math.max(0, Math.min(100, Math.round(data.progressPct))) : null

  return (
    <div className="af-cr">
      <header className="af-cr-head">
        <h1 className="af-cr-title">Career</h1>
        <p className="af-cr-sub">
          Everything we know about how you have actually done — across{' '}
          {formatInt(stats?.seasonsPlayed ?? 0)}{' '}
          {(stats?.seasonsPlayed ?? 0) === 1 ? 'season' : 'seasons'} and {formatInt(leaguesPlayed)}{' '}
          {leaguesPlayed === 1 ? 'league' : 'leagues'}.
        </p>
      </header>

      {data.rankProcessing ? (
        <p className="af-cr-notice">
          An import is still being processed, so these numbers may still move.
        </p>
      ) : null}

      {data.level != null ? (
        <section className="af-cr-level">
          <div className="af-cr-level-top">
            <span className="af-cr-level-num" style={{ color: levelColor }}>
              {data.level}
            </span>
            <span className="af-cr-level-name">{data.levelName ?? `Level ${data.level}`}</span>
            {data.tierGroup ? <span className="af-cr-level-tier">{data.tierGroup}</span> : null}
          </div>

          {progressPct != null ? (
            <>
              <div
                className="af-cr-bar"
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress to next level"
              >
                <div
                  className="af-cr-bar-fill"
                  style={{ width: `${progressPct}%`, background: levelColor }}
                />
              </div>
              <div className="af-cr-bar-label">
                <span>
                  {data.xpIntoLevel != null && data.xpForLevel != null
                    ? `${formatInt(data.xpIntoLevel)} / ${formatInt(data.xpForLevel)} XP`
                    : data.xpTotal != null
                      ? `${formatInt(data.xpTotal)} XP`
                      : ''}
                </span>
                {data.nextLevelName ? <span>Next: {data.nextLevelName}</span> : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <div className="af-cr-grid">
        <div className="af-cr-stat">
          <span className="af-cr-stat-label">Record</span>
          {record ? (
            <span className="af-cr-stat-value af-num">{record}</span>
          ) : (
            <span className="af-cr-stat-value af-cr-stat-value--none">no games recorded</span>
          )}
        </div>

        <div className="af-cr-stat">
          <span className="af-cr-stat-label">Win rate</span>
          {winRate != null ? (
            <span className="af-cr-stat-value af-num">{winRate}%</span>
          ) : (
            <span className="af-cr-stat-value af-cr-stat-value--none">
              no games behind it yet
            </span>
          )}
        </div>

        <div className="af-cr-stat">
          <span className="af-cr-stat-label">Championships</span>
          <span className="af-cr-stat-value af-num">{formatInt(stats?.championships ?? 0)}</span>
        </div>

        <div className="af-cr-stat">
          <span className="af-cr-stat-label">Playoff runs</span>
          <span className="af-cr-stat-value af-num">
            {formatInt(stats?.playoffAppearances ?? 0)}
          </span>
          {playoffRate != null ? (
            <span className="af-cr-stat-note">{playoffRate}% of leagues played</span>
          ) : null}
        </div>

        <div className="af-cr-stat">
          <span className="af-cr-stat-label">Seasons</span>
          <span className="af-cr-stat-value af-num">{formatInt(stats?.seasonsPlayed ?? 0)}</span>
        </div>

        <div className="af-cr-stat">
          <span className="af-cr-stat-label">Leagues</span>
          <span className="af-cr-stat-value af-num">{formatInt(leaguesPlayed)}</span>
        </div>
      </div>

      {/*
        The grade renders ONLY when a report exists. legacy_ai_reports has held no
        rows, which is why the rank route stopped defaulting this to 70 / "C-" —
        rendering the letter here anyway would put that fabrication straight back
        on screen.
      */}
      {rank?.aiScore != null && rank.aiReportGrade ? (
        <section className="af-cr-level">
          <div className="af-cr-level-top">
            <span className="af-cr-level-num" style={{ color: levelColor }}>
              {rank.aiReportGrade}
            </span>
            <span className="af-cr-level-name">Chimmy&apos;s read</span>
          </div>
          {rank.aiInsight ? <p className="af-cr-sub">{rank.aiInsight}</p> : null}
        </section>
      ) : null}

      {data.rankCalculatedAt ? (
        <p className="af-cr-foot">
          Last calculated {new Date(data.rankCalculatedAt).toLocaleDateString('en-US')}.
        </p>
      ) : null}
    </div>
  )
}

export default Career
