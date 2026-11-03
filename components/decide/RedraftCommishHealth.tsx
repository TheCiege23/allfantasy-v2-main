'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, MessageSquare } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  HEALTH_RING_CIRCUMFERENCE,
  HEALTH_RING_RADIUS,
  buildCommishChecklist,
  checklistEmptyReason,
  healthRingDash,
  healthStatusLabel,
  healthSubScoreBars,
  healthTone,
  healthTrendLine,
  type CommishHealthSummary,
  type WeeklyChecklistResponse,
} from '@/lib/league-media/redraftDeck'
import './redraft-deck.css'

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

const MARK: Record<string, string> = { done: '✓', todo: '!', heads_up: '•' }

/**
 * League health for a redraft commissioner (the approved Commish mock): score ring, sub-score bars,
 * this week's checklist and the managers worth checking on. Two existing-shaped reads, in parallel —
 * /api/commissioner/leagues/[id]/health-summary (the hub's score + manager rows) and
 * /api/commissioner/leagues/[id]/weekly-checklist. Every part drops out when its read has nothing:
 * no score → the ring says why; no past scores → no trend line; no checklist → the reason.
 *
 * The manager card's action is the EXISTING one — League chat, where the commissioner already
 * messages managers. There is no per-manager nudge endpoint, so this does not pretend to send one.
 */
export function RedraftCommishHealth({
  leagueId,
  currentWeek,
  tradeDeadlineWeek,
  onOpenTab,
}: {
  leagueId: string
  currentWeek: number | null | undefined
  tradeDeadlineWeek: number | null | undefined
  onOpenTab: (tabId: string) => void
}) {
  const { language } = useOptionalLanguage()
  const [summary, setSummary] = useState<CommishHealthSummary | null | undefined>(undefined)
  const [checklist, setChecklist] = useState<WeeklyChecklistResponse | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const id = encodeURIComponent(leagueId)
    void getJson<CommishHealthSummary>(`/api/commissioner/leagues/${id}/health-summary`).then((v) => {
      if (!cancelled) setSummary(v)
    })
    void getJson<WeeklyChecklistResponse>(`/api/commissioner/leagues/${id}/weekly-checklist`).then((v) => {
      if (!cancelled) setChecklist(v)
    })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const checks = useMemo(
    () => (checklist === undefined ? [] : buildCommishChecklist({ checklist, currentWeek, tradeDeadlineWeek, language })),
    [checklist, currentWeek, tradeDeadlineWeek, language],
  )
  const score = summary?.score ?? null
  const bars = score && score.available ? healthSubScoreBars(score.sub) : []
  const trend = score && score.available ? healthTrendLine(score.history) : null
  const tone = score && score.available ? healthTone(score.score) : null
  const week = checklist && checklist.applies ? checklist.week : currentWeek ?? null

  return (
    <section className="rdk-health" aria-label="League health" data-testid="redraft-commish-health">
      <div className="rdk-health-grid">
        <section className="rdk-card rdk-score" aria-label="Health score" data-tone={tone ?? 'none'} data-testid="redraft-health-score">
          {summary === undefined ? (
            <div className="rdk-skel" style={{ height: 150 }} />
          ) : (
            <>
              <div className="rdk-score-head">
                <svg
                  className="rdk-ring"
                  width="150"
                  height="150"
                  viewBox="0 0 150 150"
                  role="img"
                  aria-label={score && score.available ? `Health score ${Math.round(score.score)} out of 100` : 'Health score not available'}
                >
                  <circle className="rdk-ring-track" cx="75" cy="75" r={HEALTH_RING_RADIUS} fill="none" strokeWidth="14" />
                  {score && score.available ? (
                    <circle
                      className="rdk-ring-value"
                      cx="75"
                      cy="75"
                      r={HEALTH_RING_RADIUS}
                      fill="none"
                      strokeWidth="14"
                      strokeLinecap="round"
                      strokeDasharray={healthRingDash(score.score)}
                      data-circumference={HEALTH_RING_CIRCUMFERENCE.toFixed(1)}
                      transform="rotate(-90 75 75)"
                    />
                  ) : null}
                  <text className="rdk-ring-num" x="75" y="82" textAnchor="middle">
                    {score && score.available ? Math.round(score.score) : '—'}
                  </text>
                  <text className="rdk-ring-of" x="75" y="106" textAnchor="middle">
                    / 100
                  </text>
                </svg>
                <div className="rdk-score-words">
                  <span className="rdk-score-status" data-testid="redraft-health-status">
                    {score && score.available ? healthStatusLabel(score.status) : 'Not scored yet'}
                  </span>
                  <span className="rdk-score-line">
                    {score && score.available
                      ? [
                          score.activeManagers != null && score.totalManagers
                            ? `${score.activeManagers} of ${score.totalManagers} managers active.`
                            : null,
                          score.summary || null,
                        ]
                          .filter(Boolean)
                          .join(' ')
                      : score
                        ? score.reason
                        : 'The health score could not be read right now.'}
                  </span>
                  {score && score.available ? (
                    <span className="rdk-score-conf">{Math.round(score.confidencePct)}% confidence</span>
                  ) : null}
                </div>
              </div>
              {trend ? (
                <div className="rdk-trend" data-testid="redraft-health-trend">
                  <span className="rdk-label">Trend · this season</span>
                  <svg width="100%" height="70" viewBox="0 0 372 70" preserveAspectRatio="none" role="img" aria-label={`Health trend from ${trend.first} to ${trend.latest}`}>
                    <polyline className="rdk-trend-line" points={trend.points} fill="none" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                    <circle className="rdk-trend-dot" cx={trend.last.x} cy={trend.last.y} r="5" />
                  </svg>
                </div>
              ) : null}
              {bars.length > 0 ? (
                <ul className="rdk-bars" aria-label="Sub-scores" data-testid="redraft-health-bars">
                  {bars.map((b) => (
                    <li key={b.key} data-key={b.key}>
                      <div className="rdk-bar-head">
                        <span>{b.label}</span>
                        <b>{b.value}</b>
                      </div>
                      <div className="rdk-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.value} aria-label={b.label}>
                        <span style={{ width: `${b.value}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </section>

        <div className="rdk-health-side">
          <section className="rdk-card rdk-checklist" aria-label="This week" data-testid="redraft-health-checklist">
            <div className="rdk-card-head">
              <span className="rdk-label">{week ? `Week ${week} checklist` : 'This week’s checklist'}</span>
              <span className="rdk-card-sub">Based on where your season is</span>
            </div>
            {checklist === undefined ? (
              <div className="rdk-skel" />
            ) : checks.length === 0 ? (
              <p className="rdk-empty">{checklistEmptyReason(checklist)}</p>
            ) : (
              <ul className="rdk-checks">
                {checks.map((c) => (
                  <li key={c.id} data-status={c.status} data-item={c.id} data-testid="redraft-health-check">
                    <span className="rdk-check-mark" aria-hidden>
                      {MARK[c.status] ?? '•'}
                    </span>
                    <span className="rdk-check-body">
                      <span className="rdk-check-title">{c.title}</span>
                      {c.detail ? <span className="rdk-check-detail">{c.detail}</span> : null}
                    </span>
                    {c.meta ? <span className="rdk-check-meta">{c.meta}</span> : null}
                    {c.href && c.status === 'todo' ? (
                      <a className="rdk-check-go" href={c.href} aria-label={`Open: ${c.title}`}>
                        <ArrowRight size={16} aria-hidden />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rdk-card rdk-managers" aria-label="Managers to check on" data-testid="redraft-health-managers">
            <div className="rdk-card-head">
              <span className="rdk-label">Managers to check on</span>
            </div>
            {summary === undefined ? (
              <div className="rdk-skel" />
            ) : !summary || !summary.managersRead ? (
              <p className="rdk-empty">Manager activity could not be read for this league yet.</p>
            ) : summary.managers.length === 0 ? (
              <p className="rdk-empty">Nobody needs a check-in — every claimed team has been active.</p>
            ) : (
              <div className="rdk-mgr-grid">
                {summary.managers.slice(0, 6).map((m) => (
                  <div className="rdk-mgr" key={m.rosterId} data-status={m.status} data-testid="redraft-health-manager">
                    <div className="rdk-mgr-who">
                      <span className="rdk-mgr-avatar" aria-hidden>
                        {m.initials}
                      </span>
                      <span className="rdk-mgr-text">
                        <strong>{m.name}</strong>
                        <span className="rdk-mgr-issue">{m.issues.join(' · ')}</span>
                      </span>
                    </div>
                    <button type="button" className="rdk-mgr-btn" onClick={() => onOpenTab('league_chat')}>
                      <MessageSquare size={15} aria-hidden /> Message in league chat
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

export default RedraftCommishHealth
