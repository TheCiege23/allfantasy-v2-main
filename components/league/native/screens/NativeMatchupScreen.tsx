'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import type { MatchupCenterPayload, MatchupPlayerSlot } from '@/lib/matchup-center/types'
import { maxWeekForSport } from '@/components/matchup-center/MatchupTabContainer'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import { fmt1, formatRecord, initialsOf, pairScoreboard, rowPointTone, shortPlayerName, type ScoreboardRow } from '@/lib/league/native/nativeScreenModels'
import { Card, PosPill, ScreenHead, Segmented } from './NativeScreenParts'
import { TournamentBracketCard } from './TournamentBracketCard'

/**
 * Matchup — handoff §3, `Matchup.png` / `MobileMatchup.png`.
 *
 * Reads the same two DB-backed routes as before: `/api/leagues/[id]/matchup-center` (the viewer's
 * matchup, win probability and the deterministic insight copy) and
 * `/api/leagues/[id]/scoring/matchups` (every `teamWeekResult` row for the week, for the league
 * scoreboard). No provider is called from here and no score is computed client-side.
 */
type View = 'mine' | 'league'

function sideLine(rec: MatchupCenterPayload['left']['record'], remaining: number) {
  return (
    <>
      {formatRecord(rec)}
      <span> · {remaining} left to play</span>
    </>
  )
}

function SlotCell({ p, side }: { p: MatchupPlayerSlot | null; side: 'left' | 'right' }) {
  if (!p) return <div className="nls-player" data-side={side}><strong className="nls-muted">Empty</strong></div>
  const status = p.gameLabel || (p.gameStatus === 'final' ? 'Final' : '—')
  const team = p.team ? <span data-long>{p.team} · </span> : null
  return (
    <div className="nls-player" data-side={side}>
      <strong title={p.name}>
        <span className="nls-long">{p.name}</span>
        <span className="nls-short">{shortPlayerName(p.name)}</span>
      </strong>
      <small data-live={p.gameStatus === 'live' || undefined}>
        {side === 'left' ? <>{team}{status}</> : <>{status}{p.team ? <span data-long> · {p.team}</span> : null}</>}
      </small>
    </div>
  )
}

export function NativeMatchupScreen({ league, onSelectTab }: { league: UserLeague; onSelectTab: (id: string) => void }) {
  const season = useMemo(() => {
    const n = Number(league.season)
    return Number.isFinite(n) && n > 0 ? n : new Date().getFullYear()
  }, [league.season])
  const maxWeek = maxWeekForSport(String(league.sport ?? 'NFL'))
  const [week, setWeek] = useState(() => Math.min(maxWeek, Math.max(1, league.currentWeek ?? 1)))
  const [view, setView] = useState<View>('mine')
  const [payload, setPayload] = useState<MatchupCenterPayload | null>(null)
  const [board, setBoard] = useState<ScoreboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      const id = encodeURIComponent(league.id)
      try {
        const [mRes, bRes] = await Promise.all([
          fetch(`/api/leagues/${id}/matchup-center?season=${season}&week=${week}`, { credentials: 'include', cache: 'no-store' }),
          fetch(`/api/leagues/${id}/scoring/matchups?season=${season}&week=${week}`, { credentials: 'include', cache: 'no-store' }),
        ])
        const mJson = (await mRes.json().catch(() => ({}))) as { payload?: MatchupCenterPayload; error?: string }
        const bJson = (await bRes.json().catch(() => ({}))) as { matchups?: ScoreboardRow[] }
        if (!mRes.ok) {
          if (!silent) {
            setPayload(null)
            setError(mJson.error ?? 'We could not load this matchup.')
          }
        } else {
          setPayload(mJson.payload ?? null)
        }
        if (bRes.ok) setBoard(Array.isArray(bJson.matchups) ? bJson.matchups : [])
        else if (!silent) setBoard([])
      } catch {
        if (!silent) setError('We could not load this matchup.')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [league.id, season, week],
  )

  useEffect(() => {
    void load()
  }, [load])
  useLeagueRealtimeRefresh(league.id, () => void load(true))
  useEffect(() => {
    const ms = payload?.refreshIntervalMs
    if (!ms || !Number.isFinite(ms) || ms <= 0) return
    const t = window.setInterval(() => void load(true), ms)
    return () => window.clearInterval(t)
  }, [payload?.refreshIntervalMs, load])

  const rows = useMemo(() => {
    if (!payload) return []
    const n = Math.max(payload.left.starters.length, payload.right.starters.length)
    return Array.from({ length: n }, (_, i) => {
      const l = payload.left.starters[i] ?? null
      const r = payload.right.starters[i] ?? null
      return { pos: l?.position ?? r?.position ?? '—', l, r }
    })
  }, [payload])
  const pairs = useMemo(() => pairScoreboard(board, payload?.left.rosterId ?? null), [board, payload?.left.rosterId])

  const prob = payload?.winProbabilityLeft
  const left = payload?.left
  const right = payload?.right
  const leftLeads = left && right ? left.totalPoints >= right.totalPoints : true
  const insight = payload ? (payload.insights.startSit || payload.insights.matchupEdge || '').trim() : ''

  const weekControls = (
    <>
      <Segmented label="Matchup view" value={view} onChange={setView} options={[{ id: 'mine', label: 'My matchup' }, { id: 'league', label: 'League scoreboard' }]} />
      <button type="button" className="nls-iconbtn" aria-label="Previous week" disabled={week <= 1 || loading} onClick={() => setWeek((w) => Math.max(1, w - 1))}>
        <ChevronLeft size={18} aria-hidden />
      </button>
      <button type="button" className="nls-iconbtn" aria-label="Next week" disabled={week >= maxWeek || loading} onClick={() => setWeek((w) => Math.min(maxWeek, w + 1))}>
        <ChevronRight size={18} aria-hidden />
      </button>
    </>
  )

  const scoreboard = (
    <Card label={`League scoreboard · Wk ${week}`}>
      {pairs.length ? (
        <ul className="nls-board">
          {pairs.map((p) => {
            const hp = p.home.totalPoints ?? null
            const ap = p.away?.totalPoints ?? null
            return (
              <li key={p.home.rosterId} data-mine={p.mine || undefined}>
                <div className="nls-board-line" data-lead={hp != null && ap != null && hp > ap}>
                  <span>{p.home.teamName}</span>
                  <span>{fmt1(hp)}</span>
                </div>
                {p.away ? (
                  <div className="nls-board-line" data-lead={hp != null && ap != null && ap > hp}>
                    <span>{p.away.teamName}</span>
                    <span>{fmt1(ap)}</span>
                  </div>
                ) : (
                  <div className="nls-board-line"><span className="nls-muted">Bye</span><span /></div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="nls-muted">Scores appear here once week {week} is scored.</p>
      )}
    </Card>
  )

  return (
    <div className="nls" data-testid="native-matchup-screen">
      <ScreenHead eyebrow={`${league.name} · Matchup`} title={`Week ${week}`}>
        {weekControls}
      </ScreenHead>

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {loading && !payload ? <p className="nls-empty" role="status">Loading matchup…</p> : null}

      {payload && left && right ? (
        <section className="nls-card nls-card-flush" aria-label="Score">
          {payload.conceptOverlay ? <p className="nls-overlay">{payload.conceptOverlay}</p> : null}
          <div className="nls-score">
            <div className="nls-side" data-side="left">
              <span className="nls-avatar" aria-hidden>{initialsOf(left.teamName)}</span>
              <div className="nls-side-name">
                <strong>{left.teamName}</strong>
                <small>{sideLine(left.record, left.remainingStarters)}</small>
              </div>
            </div>
            <div className="nls-score-mid">
              <div className="nls-score-nums" aria-label={`${left.teamName} ${left.totalPoints.toFixed(1)}, ${right.teamName} ${right.totalPoints.toFixed(1)}`}>
                <b data-lead={leftLeads}>{left.totalPoints.toFixed(1)}</b>
                <span>vs</span>
                <b data-lead={!leftLeads}>{right.totalPoints.toFixed(1)}</b>
              </div>
            </div>
            <div className="nls-side" data-side="right">
              <span className="nls-avatar" aria-hidden>{initialsOf(right.teamName)}</span>
              <div className="nls-side-name">
                <strong>{right.teamName}</strong>
                <small>{sideLine(right.record, right.remainingStarters)}</small>
              </div>
            </div>
            <div className="nls-prob">
              {prob != null ? (
                <>
                  <div className="nls-probbar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prob * 100)} aria-label={`${left.teamName} win probability`}>
                    <span style={{ width: `${(prob * 100).toFixed(1)}%` }} />
                    <span />
                  </div>
                  <p className="nls-probline">
                    AF win prob <b>{Math.round(prob * 100)}%</b>
                    {!left.projectedTotalIncludesFallback && !right.projectedTotalIncludesFallback ? ` · proj ${fmt1(left.projectedTotal)} – ${fmt1(right.projectedTotal)}` : ''}
                  </p>
                </>
              ) : (
                <p className="nls-probline">Win probability needs real projections for every starter.</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Divisions-tournament conference leagues, bracket weeks only: the entrant's bracket game. */}
      <TournamentBracketCard leagueId={league.id} settings={league.settings} week={week} />

      {payload ? (
        <div className="nls-cols">
          {view === 'mine' ? (
            <section className="nls-card nls-card-flush" aria-label="Starters">
              <h3 className="nls-label nls-card-head">Starters</h3>
              {rows.length ? (
                <ul className="nls-rows">
                  {rows.map((row, i) => {
                    const lp = row.l?.currentPoints ?? 0
                    const rp = row.r?.currentPoints ?? 0
                    return (
                      <li key={`${row.pos}-${i}`} className="nls-mrow">
                        <SlotCell p={row.l} side="left" />
                        <span className="nls-pts" data-side="left" data-pts={rowPointTone(lp, rp, row.l?.gameStatus === 'final')}>{row.l ? lp.toFixed(1) : '—'}</span>
                        <PosPill label={row.pos} />
                        <span className="nls-pts" data-side="right" data-pts={rowPointTone(rp, lp, row.r?.gameStatus === 'final')}>{row.r ? rp.toFixed(1) : '—'}</span>
                        <SlotCell p={row.r} side="right" />
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="nls-empty">No starters yet for week {payload.week}. Set your lineup, or check back once the week is scored.</p>
              )}
              <div className="nls-card-foot">
                <span className="nls-muted nls-mono">{payload.matchupStatus === 'final' ? 'Final' : payload.matchupStatus === 'live' ? 'Live' : 'Upcoming'}</span>
                <button type="button" className="nls-btn" onClick={() => onSelectTab('roster')}>Edit my lineup</button>
              </div>
            </section>
          ) : (
            scoreboard
          )}
          <aside className="nls-aside" aria-label="Matchup insight">
            <Card label="Chimmy · AF edge" tone="accent">
              <p>{insight || 'No edge to report for this week yet.'}</p>
              <button type="button" className="nls-btn" data-variant="primary" data-block="true" onClick={() => onSelectTab('roster')}>Review lineup</button>
            </Card>
            {view === 'mine' ? scoreboard : null}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
