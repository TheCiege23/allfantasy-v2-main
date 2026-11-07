'use client'

import { useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import type { LineupIntegrityReport, TeamLineupScoreView } from '@/lib/lineup-integrity/lineupIntegrityService'

/**
 * Lineup-integrity card (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 7), on the Commissioner Hub.
 * Evidence, not a verdict: it lists lineups that could not score so the commissioner can decide.
 */

type View = LineupIntegrityReport & { entitled: boolean }

type M = typeof commissionerScreensMessages.en

const UNSUPPORTED: Record<string, (m: M) => string> = {
  unsupported_platform: (m) => m.integrityUnsupportedPlatform,
  not_nfl: (m) => m.integrityNotNfl,
  best_ball: (m) => m.integrityBestBall,
  no_lineup_rules: (m) => m.integrityNoLineupRules,
}

export function LineupIntegrity({ leagueId }: { leagueId: string }) {
  const m = useMessages(commissionerScreensMessages)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // Never rejects: a failed read is a line on the card, not an unhandled error on the hub.
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/lineup-integrity`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!live) return
        if (res.ok && body) setView(body as View)
        else setError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      })
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [leagueId])

  if (error) return <p className="af-ch-muted">{error}</p>
  if (!view) return <p className="af-ch-muted">{m.commonLoading}</p>
  if (!view.supported) {
    const copy = UNSUPPORTED[view.reason]
    return <p className="af-ch-recipe-desc">{copy ? copy(m) : view.reason}</p>
  }

  const flagged = view.findings.filter((f) => f.flagged)
  const soft = view.findings.filter((f) => !f.flagged)
  return (
    <div className="af-ch-recipes" data-testid="lineup-integrity">
      <p className="af-ch-recipe-desc">
        {view.latestWeek == null
          ? m.integrityNoFinishedWeek
          : view.fullSeason
            ? m.integritySeasonWeeks(view.season, view.weeks[0], view.latestWeek)
            : m.integrityLatestWeek(view.latestWeek)}
      </p>

      {flagged.length === 0 && view.latestWeek != null && (
        <p className="af-ch-recipe-desc">{m.integrityAllClear}</p>
      )}
      {flagged.length > 0 && (
        <ul className="af-ch-recipe-list">
          {flagged.map((f) => (
            <li key={`${f.rosterId}-${f.week}`} data-on="true">
              <p className="af-ch-recipe-desc">{f.text}</p>
            </li>
          ))}
        </ul>
      )}
      {soft.length > 0 && (
        <>
          <p className="af-ch-recipe-label" style={{ marginTop: 12 }}>{m.integrityLeads}</p>
          <ul className="af-ch-recipe-list">
            {soft.map((f) => (
              <li key={`soft-${f.rosterId}-${f.week}`}>
                <p className="af-ch-recipe-desc">{f.text}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.summary && view.summary.some((s) => s.weeksFlagged > 0) && (
        <table className="w-full text-sm" style={{ marginTop: 12 }}>
          <thead>
            <tr className="text-left text-white/60">
              <th>{m.integrityTeam}</th>
              <th>{m.integrityWeeksFlagged}</th>
              <th>{m.integrityEmptySlots}</th>
              <th>{m.integrityByeStarters}</th>
            </tr>
          </thead>
          <tbody>
            {view.summary
              .filter((s) => s.weeksFlagged > 0)
              .map((s) => (
                <tr key={s.rosterId}>
                  <td>{s.teamName}</td>
                  <td>
                    {s.weeksFlagged} / {s.weeksAudited}
                  </td>
                  <td>{s.emptySlots}</td>
                  <td>{s.byeStarts}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {view.scores && view.scores.length > 0 && (
        <LineupScores leagueId={leagueId} scores={view.scores} m={m} intro={view.scoresSource === 'sleeper' ? m.scoresIntroSleeper : undefined} />
      )}
      {view.coverage && <SnapshotCoverageLine coverage={view.coverage} m={m} />}

      {!view.entitled && (
        <p className="af-ch-recipe-meta" style={{ marginTop: 8 }}>
          {m.integrityUpsell}
        </p>
      )}
      <p className="af-ch-recipe-meta" style={{ marginTop: 8 }}>{view.basis}</p>
    </div>
  )
}

const pct = (ratio: number) => Math.round(ratio * 100)

/** Below this a week reads as a warning on the chip. Display only; the flag uses the league's line. */
const LOW_CHIP = 0.85

/** `intro` replaces the default line when the scores were not built from what the manager saw (an imported league). */
export function LineupScores({ leagueId, scores, m, intro }: { leagueId: string; scores: TeamLineupScoreView[]; m: M; intro?: string }) {
  const [state, setState] = useState<Record<string, 'posting' | 'posted' | string>>({})

  async function post(rosterId: string) {
    setState((s) => ({ ...s, [rosterId]: 'posting' }))
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/lineup-integrity/post`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setState((s) => ({ ...s, [rosterId]: res.ok ? 'posted' : (body?.error ?? `HTTP ${res.status}`) }))
    } catch (e) {
      setState((s) => ({ ...s, [rosterId]: String(e) }))
    }
  }

  return (
    <section className="af-li-scores" data-testid="lineup-integrity-scores" style={{ marginTop: 14 }}>
      <p className="af-ch-recipe-label">{m.scoresTitle}</p>
      <p className="af-ch-recipe-meta">{intro ?? m.scoresIntro}</p>
      <ul className="af-ch-recipe-list">
        {scores.map((team) => {
          const st = state[team.rosterId]
          return (
            <li key={team.rosterId} data-testid="lineup-score-team">
              <div className="af-li-team-head">
                <strong>{team.teamName}</strong>
                {team.summary.averageRatio != null && <span className="af-ch-recipe-meta">{m.scoresAverage(pct(team.summary.averageRatio))}</span>}
                {team.summary.lowestWeek && team.summary.weeksScored > 1 && (
                  <span className="af-ch-recipe-meta">{m.scoresLowest(team.summary.lowestWeek.week, pct(team.summary.lowestWeek.ratio))}</span>
                )}
              </div>
              <div className="af-li-chips">
                {team.weeks.map((w) => (
                  <span
                    key={w.week}
                    className="af-li-chip"
                    data-low={typeof w.ratio === 'number' && w.ratio < LOW_CHIP ? 'true' : undefined}
                    title={typeof w.ratio === 'number' && w.startedTopCount != null && w.starterCount != null ? m.scoresTop(w.startedTopCount, w.starterCount) : m.scoresNotScored}
                  >
                    <span className="af-li-chip-week">{m.scoresWeek(w.week)}</span>
                    <span className="af-li-chip-val">{typeof w.ratio === 'number' ? `${pct(w.ratio)}%` : '—'}</span>
                    <span className="af-li-chip-top">
                      {typeof w.ratio !== 'number'
                        ? m.scoresNotScored
                        : w.startedTopCount != null && w.starterCount != null
                          ? m.scoresTop(w.startedTopCount, w.starterCount)
                          : ''}
                    </span>
                  </span>
                ))}
              </div>
              <div className="af-li-actions">
                <button type="button" className="af-li-post" disabled={st === 'posting' || st === 'posted'} onClick={() => post(team.rosterId)}>
                  {st === 'posting' ? m.scoresPosting : st === 'posted' ? m.scoresPosted : m.scoresPost}
                </button>
                {st && st !== 'posting' && st !== 'posted' && (
                  <span className="af-ch-recipe-meta" role="alert">
                    {st}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * How much of the league the kickoff snapshots cover. Without it, a league whose snapshots silently
 * stopped (monitor off, slots unreadable, a sync gap) just shows no scores, which reads as "all fine".
 */
export function SnapshotCoverageLine({ coverage, m }: { coverage: NonNullable<Extract<View, { supported: true }>['coverage']>; m: M }) {
  const lines: string[] = []
  if (!coverage.monitorOn) lines.push(m.coverageMonitorOff)
  else if (!coverage.latest) lines.push(m.coverageNone)
  if (coverage.latest) lines.push(m.coverageLatest(coverage.latest.week, coverage.latest.snapshotted, coverage.teams))
  if (coverage.lastScored) lines.push(m.coverageScored(coverage.lastScored.week, coverage.lastScored.scored, coverage.teams))
  const gap = (coverage.latest && coverage.latest.snapshotted < coverage.teams) || (coverage.lastScored && coverage.lastScored.scored < coverage.teams)
  if (gap) lines.push(m.coverageGap)
  return (
    <div className="af-li-coverage" data-testid="lineup-integrity-coverage" data-gap={gap ? 'true' : undefined} style={{ marginTop: 10 }}>
      <p className="af-ch-recipe-label">{m.coverageTitle}</p>
      {lines.map((l) => (
        <p key={l} className="af-ch-recipe-meta">
          {l}
        </p>
      ))}
    </div>
  )
}
