'use client'

/**
 * LegacyHome — the Legacy tab (slice 3): the league's whole story, from the
 * real multi-season Sleeper chain via /api/league/history.
 *
 * Honesty contract: everything rendered comes from the payload; each season's
 * `missing` list renders as visible "couldn't sync" chips; unsupported
 * platforms and stale caches say so; head-to-head manager comparison is shown
 * as an explicit not-yet state (deep sync), never fabricated.
 */

import { useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import type {
  HistoryAllTimeRow,
  HistoryManagerRef,
  HistorySeason,
  LeagueHistoryPayload,
} from '@/lib/league-history/sleeperLeagueHistoryService'
import { DraftReportCards } from '@/components/decide/DraftReportCards'
import { ManagerH2H } from '@/components/decide/ManagerH2H'
import { TradeLedgerGraded } from '@/components/decide/TradeLedgerGraded'
import './broadcast-deck.css'

type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; viewerSleeperUserId: string | null; history: LeagueHistoryPayload | null; error?: string }

function avatarUrl(id: string | null): string | null {
  return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null
}

function Avatar({ m, size = 16 }: { m: HistoryManagerRef | null; size?: number }) {
  const src = m ? avatarUrl(m.avatar) : null
  if (!src) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', verticalAlign: '-3px' }}
    />
  )
}

function record(row: { wins: number; losses: number; ties: number }): string {
  return `${row.wins}–${row.losses}${row.ties > 0 ? `–${row.ties}` : ''}`
}

export function LegacyHome({ league, leagueId }: { league: UserLeague; leagueId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [seasonKey, setSeasonKey] = useState<string | null>(null)
  const [fullBoard, setFullBoard] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/history?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, viewerSleeperUserId: null, history: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const history = data && data.supported ? data.history : null
  const viewerId = data && data.supported ? data.viewerSleeperUserId : null

  const selectedSeason: HistorySeason | null = useMemo(() => {
    if (!history) return null
    return history.seasons.find((s) => s.season === seasonKey) ?? history.seasons[0] ?? null
  }, [history, seasonKey])

  useEffect(() => {
    setFullBoard(false)
  }, [seasonKey])

  const isMe = (m: HistoryManagerRef | null | undefined) =>
    Boolean(m?.ownerId && viewerId && m.ownerId === viewerId)

  return (
    <div className="bdx" data-testid="legacy-home">
      {loading ? (
        <>
          <div className="bdx-skel" />
          <div className="bdx-skel" style={{ marginTop: 12 }} />
        </>
      ) : data && !data.supported ? (
        <div className="bdx-empty">
          <div className="t">History for {data.platform} leagues isn&apos;t synced yet</div>
          <div className="m">
            The full-chain Legacy import currently covers Sleeper-imported leagues. Other platforms
            arrive in a later slice — this page will say so until then rather than showing partial data.
          </div>
        </div>
      ) : !history ? (
        <div className="bdx-empty">
          <div className="t">League history temporarily unavailable</div>
          <div className="m">The upstream feed didn&apos;t answer and no cached copy exists yet. Try again shortly.</div>
        </div>
      ) : (
        <>
          {history.staleAsOf ? (
            <div className="bdx-card c-warn" style={{ marginBottom: 12 }}>
              <div className="bdx-line">
                Showing the last synced copy (upstream unavailable) — data as of{' '}
                <b>{new Date(history.staleAsOf).toLocaleString()}</b>.
              </div>
            </div>
          ) : null}

          {/* ── Champions timeline ── */}
          <div className="bdx-kick">
            <h2 className="bdx-disp">League history</h2>
            <span className="bdx-sub">
              {history.seasons.length} season{history.seasons.length === 1 ? '' : 's'} synced from the chain
            </span>
          </div>
          <div className="bdx-champs">
            {history.seasons.map((s) => (
              <div className="bdx-champ" key={s.sleeperLeagueId}>
                <div className="yr">
                  {s.season}
                  {String(s.status).toLowerCase() === 'complete' ? ' Champion' : ` · ${s.status.replace(/_/g, ' ')}`}
                </div>
                {String(s.status).toLowerCase() !== 'complete' ? (
                  <div className="nm">Race is live</div>
                ) : s.champion ? (
                  <>
                    <div className="nm">
                      🏆 <Avatar m={s.champion} size={18} /> {s.champion.name}
                    </div>
                    {s.runnerUp ? (
                      <div className="rec">
                        Runner-up: <Avatar m={s.runnerUp} size={13} /> {s.runnerUp.name}
                      </div>
                    ) : null}
                    {s.topScorer ? (
                      <div className="rec">
                        Top scorer: {s.topScorer.name} · {s.topScorer.pointsFor.toFixed(1)}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="nm" style={{ color: 'var(--bdx-ink-faint)' }}>
                    Champion not synced
                  </div>
                )}
                {s.missing.length > 0 ? (
                  <div className="rec" style={{ color: 'var(--bdx-ink-ghost)' }}>
                    couldn&apos;t sync: {s.missing.join(', ')}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* ── All-time manager table ── */}
          <div className="bdx-support" style={{ gridTemplateColumns: '1fr' }}>
            <div className="bdx-panelbox">
              <h3>All-time manager table · {history.seasons.length} seasons</h3>
              <table className="bdx-stand">
                <thead>
                  <tr>
                    <th>Manager</th>
                    <th style={{ textAlign: 'right' }}>W–L</th>
                    <th style={{ textAlign: 'right' }}>PF</th>
                    <th style={{ textAlign: 'right' }}>Titles</th>
                    <th style={{ textAlign: 'right' }}>Seasons</th>
                  </tr>
                </thead>
                <tbody>
                  {history.allTime.map((row: HistoryAllTimeRow) => (
                    <tr key={row.ownerId ?? row.name} className={isMe(row) ? 'me' : undefined}>
                      <td>
                        <Avatar m={row} size={16} /> {row.name}
                        {row.teamName ? (
                          <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}> · {row.teamName}</span>
                        ) : null}
                      </td>
                      <td className="rec">{record(row)}</td>
                      <td className="rec">{row.pointsFor.toFixed(0)}</td>
                      <td className="rec">{row.titles > 0 ? `🏆 ${row.titles}` : '—'}</td>
                      <td className="rec">{row.seasons}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Season selector ── */}
          <div className="bdx-kick" style={{ marginTop: 22 }}>
            <h2 className="bdx-disp">Season detail</h2>
            <span className="bdx-sub">standings + draft board per year</span>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
            {history.seasons.map((s) => {
              const active = selectedSeason?.season === s.season
              return (
                <button
                  key={s.sleeperLeagueId}
                  type="button"
                  className={`bdx-btn ${active ? 'pri' : 'sec'}`}
                  onClick={() => setSeasonKey(s.season)}
                >
                  {s.season}
                </button>
              )
            })}
          </div>

          {selectedSeason ? (
            <div className="bdx-support" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="bdx-panelbox">
                <h3>{selectedSeason.season} standings</h3>
                {selectedSeason.standings.length > 0 ? (
                  <table className="bdx-stand">
                    <tbody>
                      {selectedSeason.standings.map((row, i) => (
                        <tr key={row.rosterId} className={isMe(row) ? 'me' : undefined}>
                          <td className="rk">{i + 1}</td>
                          <td>
                            <Avatar m={row} size={15} /> {row.name}
                          </td>
                          <td className="rec">{record(row)}</td>
                          <td className="rec">{row.pointsFor.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="bdx-rail-empty">Standings didn&apos;t sync for this season.</div>
                )}
              </div>
              <div className="bdx-panelbox">
                <h3>
                  {selectedSeason.season} draft
                  {selectedSeason.draft ? ` · ${selectedSeason.draft.picks.length} picks` : ''}
                </h3>
                {selectedSeason.draft && selectedSeason.draft.picks.length > 0 ? (
                  <>
                    <div className="bdx-rows">
                      {(fullBoard
                        ? selectedSeason.draft.picks
                        : selectedSeason.draft.picks.filter((p) => p.round === 1)
                      ).map((p) => (
                        <div className="bdx-row" key={`${p.round}-${p.pickNo}`}>
                          <span className="k" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 44 }}>
                            {p.round}.{String(p.pickNo).padStart(2, '0')}
                          </span>
                          <span className="x" style={{ textAlign: 'left', flex: 1 }}>
                            {p.playerName}
                            {p.position ? (
                              <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
                                {' '}
                                {p.position}
                                {p.nflTeam ? ` · ${p.nflTeam}` : ''}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className="k"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              color: isMe(p.pickedBy) ? '#ff9d5c' : undefined,
                              fontWeight: isMe(p.pickedBy) ? 700 : undefined,
                            }}
                          >
                            <Avatar m={p.pickedBy} size={14} /> {p.pickedBy?.name ?? '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                    {selectedSeason.draft.picks.some((p) => p.round > 1) ? (
                      <button
                        type="button"
                        className="bdx-btn sec bdx-rail-link"
                        onClick={() => setFullBoard((v) => !v)}
                      >
                        {fullBoard ? 'Show round 1 only' : 'Show full board'}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="bdx-rail-empty">Draft results didn&apos;t sync for this season.</div>
                )}
              </div>
            </div>
          ) : null}

          {/* ── Draft report cards (feature 5): every draft, graded + re-rated ── */}
          <DraftReportCards leagueId={leagueId} />

          {/* ── Graded trade ledger (every trade, every season, re-graded) ── */}
          <TradeLedgerGraded leagueId={leagueId} />

          {/* ── Head-to-head deep sync (the promised manager comparison) ── */}
          <ManagerH2H leagueId={leagueId} />

          <div className="bdx-foot">
            Synced live from your league&apos;s full Sleeper chain · cached 6h ·{' '}
            {league.name} · read-only.
          </div>
        </>
      )}
    </div>
  )
}

export default LegacyHome
