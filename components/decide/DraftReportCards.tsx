'use client'

/**
 * DraftReportCards — feature 5 surface (Legacy tab): every draft in league
 * history graded per manager, with the grade EVOLVING as seasons play out.
 * Steals and busts league-wide per draft, me-highlight, verbatim grade scale.
 */

import { useEffect, useState } from 'react'
import type {
  DraftManagerCard,
  DraftPickGrade,
  DraftReportPayload,
} from '@/lib/draft-intel/draftReportService'
import { sleeperAvatarThumb, sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; viewerSleeperUserId: string | null; report: DraftReportPayload | null; error?: string }

function Grade({ letter }: { letter: string }) {
  const cls = letter === 'A' || letter === 'B' ? 'ok' : letter === 'C' ? 'info' : 'crit'
  return <span className={`bdx-sev ${cls}`}>{letter}</span>
}

function TrendChip({ trend }: { trend: DraftManagerCard['trend'] }) {
  if (trend === 'improved') return <span className="bdx-sev ok">▲ aged well</span>
  if (trend === 'declined') return <span className="bdx-sev crit">▼ aged badly</span>
  return <span className="bdx-sev info">— steady</span>
}

function PickLine({ g, tone }: { g: DraftPickGrade; tone: 'ok' | 'crit' }) {
  const src = sleeperPlayerHeadshot(g.playerId)
  return (
    <div className="bdx-row" style={{ alignItems: 'center' }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', background: '#1c2153', flex: 'none' }}
          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
        />
      ) : null}
      <span className="x" style={{ textAlign: 'left', flex: 1 }}>
        {g.playerName}
        <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
          {' '}
          {g.position ?? ''} · {g.round}.{String(g.pickNo).padStart(2, '0')} · {g.byName}
        </span>
      </span>
      <span className={`bdx-sev ${tone}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {(g.currentValueOver ?? 0) > 0 ? '+' : ''}
        {(g.currentValueOver ?? 0).toFixed(1)} vs round
      </span>
    </div>
  )
}

export function DraftReportCards({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [seasonKey, setSeasonKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/draft-report?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, viewerSleeperUserId: null, report: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const report = data && data.supported ? data.report : null
  const viewerId = data && data.supported ? data.viewerSleeperUserId : null
  const season = report
    ? report.seasons.find((s) => s.season === seasonKey) ?? report.seasons[0] ?? null
    : null

  return (
    <div data-testid="draft-report-cards">
      <div className="bdx-kick" style={{ marginTop: 22 }}>
        <h2 className="bdx-disp">Draft report cards</h2>
        <span className="bdx-sub">
          {report
            ? `${report.seasons.length} draft${report.seasons.length === 1 ? '' : 's'} graded · re-rated every season`
            : 'every draft in league history, graded and re-graded'}
        </span>
      </div>

      {loading ? (
        <div className="bdx-skel" />
      ) : !report ? (
        <div className="bdx-empty">
          <div className="t">Draft grading temporarily unavailable</div>
          <div className="m">The first sync grades every draft in the chain — try again shortly.</div>
        </div>
      ) : report.seasons.length === 0 ? (
        <div className="bdx-empty">
          <div className="t">No completed drafts found in this league&apos;s history</div>
          <div className="m">When a draft completes, its report card lands here automatically.</div>
        </div>
      ) : (
        <>
          {report.staleAsOf ? (
            <div className="bdx-card c-warn" style={{ marginBottom: 12 }}>
              <div className="bdx-line">
                Showing the last synced report (upstream unavailable) — as of{' '}
                <b>{new Date(report.staleAsOf).toLocaleString()}</b>.
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
            {report.seasons.map((s) => {
              const active = season?.season === s.season
              return (
                <button
                  key={s.draftId}
                  type="button"
                  className={`bdx-btn ${active ? 'pri' : 'sec'}`}
                  onClick={() => setSeasonKey(s.season)}
                >
                  {s.season} draft
                </button>
              )
            })}
          </div>

          {season ? (
            <>
              <div className="bdx-panelbox" style={{ marginBottom: 12 }}>
                <h3>
                  {season.season} · {season.rounds} rounds · {season.gradedPicks}/{season.totalPicks}{' '}
                  picks graded{season.partial ? ' · season in progress (grades still moving)' : ''}
                </h3>
                <table className="bdx-stand">
                  <thead>
                    <tr>
                      <th>Manager</th>
                      <th style={{ textAlign: 'right' }}>Picks</th>
                      <th style={{ textAlign: 'right' }}>Draft-year</th>
                      <th style={{ textAlign: 'right' }}>Initial</th>
                      <th style={{ textAlign: 'right' }}>Now</th>
                      <th style={{ textAlign: 'right' }}>Since</th>
                      <th style={{ textAlign: 'right' }}>Aging</th>
                    </tr>
                  </thead>
                  <tbody>
                    {season.managers.map((m) => {
                      const av = sleeperAvatarThumb(m.avatar)
                      return (
                        <tr key={m.ownerId} className={viewerId && m.ownerId === viewerId ? 'me' : undefined}>
                          <td>
                            {av ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={av}
                                alt=""
                                style={{ width: 15, height: 15, borderRadius: '50%', objectFit: 'cover', verticalAlign: '-3px', marginRight: 4 }}
                              />
                            ) : null}
                            {m.name}
                          </td>
                          <td className="rec">{m.picks}</td>
                          <td className="rec">
                            {m.initialScore > 0 ? '+' : ''}
                            {m.initialScore.toFixed(0)}
                          </td>
                          <td className="rec"><Grade letter={m.initialGrade} /></td>
                          <td className="rec"><Grade letter={m.currentGrade} /></td>
                          <td className="rec">
                            {m.currentScore > 0 ? '+' : ''}
                            {m.currentScore.toFixed(0)}
                          </td>
                          <td className="rec"><TrendChip trend={m.trend} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bdx-support" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="bdx-panelbox">
                  <h3>Biggest steals · value since the draft</h3>
                  {season.steals.length > 0 ? (
                    <div className="bdx-rows">
                      {season.steals.map((g) => (
                        <PickLine key={g.pickNo} g={g} tone="ok" />
                      ))}
                    </div>
                  ) : (
                    <div className="bdx-rail-empty">No pick has clearly beaten its round yet.</div>
                  )}
                </div>
                <div className="bdx-panelbox">
                  <h3>Biggest busts · value since the draft</h3>
                  {season.busts.length > 0 ? (
                    <div className="bdx-rows">
                      {season.busts.map((g) => (
                        <PickLine key={g.pickNo} g={g} tone="crit" />
                      ))}
                    </div>
                  ) : (
                    <div className="bdx-rail-empty">No pick has clearly fallen below its round yet.</div>
                  )}
                </div>
              </div>
            </>
          ) : null}

          <div className="bdx-empty" style={{ marginTop: 12 }}>
            <div className="m">
              <b>How draft grades work:</b> {report.gradeScale.description} A ≥ +25/pick · B ≥ +10 ·
              C &gt; −10 · D &gt; −25 · F below.{' '}
              {report.dynastyLike
                ? 'Dynasty league: the "Now" grade keeps accruing every season, so a draft that ages well climbs.'
                : 'Redraft league: each draft is graded on its own season.'}
            </div>
          </div>

          {report.missing.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {report.missing.map((m) => (
                <span key={m} className="bdx-sev warn">
                  ⚠ couldn&apos;t sync: {m}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

export default DraftReportCards
