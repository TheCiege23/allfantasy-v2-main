'use client'

/**
 * DraftIntelHome — the Live Intel tab (slice 4): a Broadcast-Deck cockpit over
 * the viewer's live Sleeper drafts via /api/draft/intel.
 *
 * Honesty contract: every number on screen comes from the feed (picks, slots,
 * settings, traded picks) — runs are counted, psychology is counted behavior,
 * and the Focus card is explicitly STRUCTURAL: it names slots to attack, never
 * players, and repeats the payload's own note that player-level verdicts wait
 * for the LeagueContext valuation slice. Missing feed parts render as chips.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import type {
  DraftIntelPayload,
  DraftListItem,
} from '@/lib/draft-intel/sleeperDraftIntelService'
import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type ListResponse =
  | { linked: false; drafts: null }
  | { linked: true; season: string; drafts: DraftListItem[] | null; error?: string }
type IntelResponse = { linked: boolean; intel: DraftIntelPayload | null; error?: string }

const POLL_MS = 20_000

function statusChip(status: string): { cls: string; label: string } {
  const s = status.toLowerCase()
  if (s === 'drafting') return { cls: 'ok', label: '● LIVE' }
  if (s === 'paused') return { cls: 'warn', label: '⏸ Paused' }
  if (s === 'pre_draft') return { cls: 'info', label: 'Scheduled' }
  return { cls: '', label: 'Complete' }
}

function avatarUrl(id: string | null): string | null {
  return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null
}

function Headshot({
  playerId,
  fallback = null,
  size = 26,
}: {
  playerId: string | null
  /** TheSportsDB cutout/thumb (via /api/players/assets) used when the Sleeper CDN 404s. */
  fallback?: string | null
  size?: number
}) {
  const primary = sleeperPlayerHeadshot(playerId)
  const [src, setSrc] = useState<string | null>(primary)
  useEffect(() => {
    setSrc(primary)
  }, [primary])
  if (!src) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        background: '#1c2153',
        flex: 'none',
      }}
      onError={() => setSrc(fallback && src !== fallback ? fallback : null)}
    />
  )
}

export function DraftIntelHome({
  league = null,
  leagueId = null,
}: {
  /** When rendered inside a league page: enables pirate-rule confirmation for THAT league's draft. */
  league?: UserLeague | null
  leagueId?: string | null
}) {
  const [list, setList] = useState<ListResponse | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const [intel, setIntel] = useState<DraftIntelPayload | null>(null)
  const [intelError, setIntelError] = useState<string | null>(null)
  const [intelLoading, setIntelLoading] = useState(false)
  const [lastFetched, setLastFetched] = useState<number | null>(null)
  const [agoText, setAgoText] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Draft list ──
  // League pages get ONLY this league's drafts (?leagueId= scope); the
  // dashboard's cross-league view is the only place all drafts appear together.
  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    const url = leagueId
      ? `/api/draft/intel?leagueId=${encodeURIComponent(leagueId)}`
      : '/api/draft/intel'
    void fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => res.json() as Promise<ListResponse>)
      .then((payload) => {
        if (cancelled) return
        setList(payload)
        if (payload.linked && payload.drafts && payload.drafts.length > 0) {
          // List arrives sorted drafting > paused > pre_draft > complete, so
          // [0] is the most-live draft — the right default mid-drafting.
          setSelectedDraftId((prev) => prev ?? payload.drafts![0].draftId)
        }
      })
      .catch(() => {
        if (!cancelled) setList({ linked: true, season: '', drafts: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  // ── Intel fetch + live polling ──
  const fetchIntel = useCallback((draftId: string, silent: boolean) => {
    if (!silent) setIntelLoading(true)
    void fetch(`/api/draft/intel?draftId=${encodeURIComponent(draftId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<IntelResponse>)
      .then((payload) => {
        if (payload.intel) {
          setIntel(payload.intel)
          setIntelError(null)
          setLastFetched(Date.now())
        } else {
          setIntelError(payload.error ?? 'Draft feed unavailable')
        }
      })
      .catch(() => setIntelError('Request failed'))
      .finally(() => setIntelLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedDraftId) return
    setIntel(null)
    setIntelError(null)
    fetchIntel(selectedDraftId, false)
  }, [selectedDraftId, fetchIntel])

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (selectedDraftId && intel && intel.draft.status === 'drafting') {
      pollRef.current = setInterval(() => fetchIntel(selectedDraftId, true), POLL_MS)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [selectedDraftId, intel, fetchIntel])

  // "updated Xs ago" ticker
  useEffect(() => {
    const t = setInterval(() => {
      if (lastFetched == null) return
      const s = Math.max(0, Math.round((Date.now() - lastFetched) / 1000))
      setAgoText(s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`)
    }, 1000)
    return () => clearInterval(t)
  }, [lastFetched])

  const drafts = list && list.linked ? list.drafts ?? [] : []
  const activeRuns = useMemo(() => (intel ? intel.runs.filter((r) => r.active) : []), [intel])

  // ── Asset enrichment: TheSportsDB headshot fallbacks + injury flags ──
  const [assets, setAssets] = useState<{
    headshots: Record<string, { cutout: string | null; thumb: string | null } | null>
    injuries: { configured: boolean; available: boolean; byName: Record<string, { status: string; note: string | null }> }
  } | null>(null)
  const assetNamesKey = useMemo(() => {
    if (!intel) return ''
    const names = [
      ...(intel.bestAvailable?.players.map((p) => p.name) ?? []),
      ...intel.recentPicks.map((p) => p.playerName),
    ]
    return [...new Set(names.filter(Boolean))].slice(0, 24).join('|')
  }, [intel])
  useEffect(() => {
    if (!assetNamesKey) {
      setAssets(null)
      return
    }
    let cancelled = false
    void fetch(`/api/players/assets?names=${encodeURIComponent(assetNamesKey)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<NonNullable<typeof assets>>) : null))
      .then((payload) => {
        if (!cancelled && payload) setAssets(payload)
      })
      .catch(() => {
        /* enrichment only — the cockpit renders fine without it */
      })
    return () => {
      cancelled = true
    }
  }, [assetNamesKey])
  const fallbackFor = (name: string): string | null => {
    const hs = assets?.headshots[name]
    return hs?.cutout ?? hs?.thumb ?? null
  }
  const injuryFor = (name: string) => assets?.injuries.byName[name] ?? null

  // Pirate confirmation is only offered when this cockpit is mounted inside the
  // league the selected draft belongs to (sleeper league ids must match).
  const canDeclareHere = Boolean(
    leagueId &&
      league?.sleeperLeagueId &&
      intel?.draft.leagueId &&
      intel.draft.leagueId === league.sleeperLeagueId,
  )
  const [declaring, setDeclaring] = useState(false)
  const declarePirate = useCallback(
    (enabled: boolean) => {
      if (!leagueId || !selectedDraftId) return
      setDeclaring(true)
      void fetch('/api/league/context', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, ruleId: 'pirate', enabled }),
      })
        .then(() => fetchIntel(selectedDraftId, false))
        .finally(() => setDeclaring(false))
    },
    [leagueId, selectedDraftId, fetchIntel],
  )

  return (
    <div className="bdx" data-testid="draft-intel-home">
      {/* ── Header ── */}
      <div className="bdx-kick">
        <h2 className="bdx-disp">Live draft intel</h2>
        <span className="bdx-sub">
          {intel?.draft.status === 'drafting'
            ? `polling every ${POLL_MS / 1000}s${agoText ? ` · updated ${agoText}` : ''}`
            : 'structural read from the live Sleeper feed'}
        </span>
        {selectedDraftId ? (
          <button
            type="button"
            className="bdx-btn sec"
            style={{ marginLeft: 'auto' }}
            onClick={() => fetchIntel(selectedDraftId, false)}
            disabled={intelLoading}
          >
            {intelLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {listLoading ? (
        <>
          <div className="bdx-skel" />
          <div className="bdx-skel" style={{ marginTop: 12 }} />
        </>
      ) : list && !list.linked ? (
        <div className="bdx-empty">
          <div className="t">No linked Sleeper account</div>
          <div className="m">
            Live draft intel reads your drafts through your linked Sleeper username. Link it from the
            import flow and this cockpit lights up — until then there&apos;s nothing real to show, so
            nothing is shown.
          </div>
        </div>
      ) : drafts.length === 0 ? (
        <div className="bdx-empty">
          <div className="t">{leagueId ? 'No drafts found for this league' : 'No drafts found this season'}</div>
          <div className="m">
            {leagueId
              ? 'Sleeper reports no drafts for this league yet. Your drafts in OTHER leagues live on the dashboard, not here — each league page shows only its own draft room.'
              : `Sleeper reports no ${new Date().getFullYear()} drafts for your account`}
            {list && 'error' in list && list.error ? ` (${list.error})` : ''}
            {leagueId ? '' : '. When one is scheduled or goes live, it appears here automatically.'}
          </div>
        </div>
      ) : (
        <>
          {/* ── Draft picker ── */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {drafts.map((d) => {
              const chip = statusChip(d.status)
              const active = d.draftId === selectedDraftId
              return (
                <button
                  key={d.draftId}
                  type="button"
                  className={`bdx-btn ${active ? 'pri' : 'sec'}`}
                  onClick={() => setSelectedDraftId(d.draftId)}
                >
                  {d.name}
                  <span className={`bdx-sev ${chip.cls}`} style={{ marginLeft: 7 }}>
                    {chip.label}
                  </span>
                </button>
              )
            })}
          </div>

          {intelError ? (
            <div className="bdx-card c-crit" style={{ marginBottom: 12 }}>
              <div className="bdx-line">
                <b>Feed problem:</b> {intelError}. Nothing cached is being substituted — hit Refresh
                to retry.
              </div>
            </div>
          ) : null}

          {intelLoading && !intel ? (
            <>
              <div className="bdx-skel" />
              <div className="bdx-skel" style={{ marginTop: 12 }} />
            </>
          ) : intel ? (
            <>
              {/* ── League context chips (slice 5) ── */}
              {intel.context ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span className="bdx-sev info">◆ {intel.context.scoringFormat.replace('_', '-').toUpperCase()}</span>
                  {intel.context.idp ? (
                    <span className="bdx-sev info">
                      ◆ IDP{intel.context.idpEmphasis ? ` · ${intel.context.idpEmphasis}` : ''}
                    </span>
                  ) : null}
                  {intel.context.superflex ? <span className="bdx-sev info">◆ SUPERFLEX</span> : null}
                  {intel.context.dynasty ? <span className="bdx-sev info">◆ DYNASTY</span> : null}
                  {intel.context.bestBall ? <span className="bdx-sev info">◆ BEST BALL</span> : null}
                  {intel.context.pirate ? (
                    <span className={`bdx-sev ${intel.context.pirate.active ? 'crit' : 'warn'}`}>
                      ☠ {intel.context.pirate.active ? 'PIRATE RULES ACTIVE' : 'pirate league? (name match)'}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* ── Pirate strategy (house rule) ── */}
              {intel.context?.pirate ? (
                <div
                  className={`bdx-card ${intel.context.pirate.active ? 'c-crit' : 'c-warn'}`}
                  style={{ marginBottom: 12 }}
                  data-testid="pirate-card"
                >
                  <div className="bdx-head">
                    <span className="bdx-kind">
                      {intel.context.pirate.active ? 'Pirate rules — every verdict adjusted' : 'Pirate league detected'}
                    </span>
                    <span className="bdx-when">
                      {intel.context.pirate.active ? 'house rule · declared' : 'suggestion · from league name'}
                    </span>
                  </div>
                  {intel.context.pirate.active ? (
                    <ul className="bdx-why" style={{ marginTop: 6 }}>
                      {intel.context.pirate.lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      <div className="bdx-line">
                        The league name matches “pirate”, but the platform API can&apos;t see house
                        rules — nothing changes until it&apos;s confirmed. Confirming turns on
                        floor-over-ceiling, concentration-risk, and weekly-win-compounding
                        adjustments across every tab.
                      </div>
                      {canDeclareHere ? (
                        <div className="bdx-acts" style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="bdx-btn pri"
                            disabled={declaring}
                            onClick={() => declarePirate(true)}
                          >
                            {declaring ? 'Saving…' : 'Yes — pirate rules apply'}
                          </button>
                          <button
                            type="button"
                            className="bdx-btn sec"
                            disabled={declaring}
                            onClick={() => declarePirate(false)}
                          >
                            No — regular league
                          </button>
                        </div>
                      ) : (
                        <div className="bdx-line" style={{ color: 'var(--bdx-ink-faint)', fontSize: 11.5 }}>
                          The league owner can confirm this from the league&apos;s own Live Intel tab.
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : null}

              {/* ── Status strip ── */}
              <div className="bdx-kpis" style={{ marginBottom: 14 }}>
                <div className="bdx-kpi">
                  <div className="v">{intel.currentRoundLabel ?? '—'}</div>
                  <div className="l">On the clock</div>
                  <div className="d">
                    {intel.picksMade}/{intel.totalPicks || '—'} picks in
                  </div>
                </div>
                <div className="bdx-kpi">
                  <div className="v">{intel.viewer.nextPickLabel ?? '—'}</div>
                  <div className="l">Your next pick</div>
                  <div className="d">
                    {intel.viewer.picksUntilNext != null
                      ? intel.viewer.picksUntilNext === 0
                        ? 'YOU ARE UP'
                        : `${intel.viewer.picksUntilNext} picks away`
                      : intel.viewer.inDraft
                        ? 'no picks remaining'
                        : 'not in this draft'}
                  </div>
                </div>
                <div className="bdx-kpi">
                  <div className="v">{intel.viewer.slot ?? '—'}</div>
                  <div className="l">Your slot</div>
                  <div className="d">{intel.viewer.picksMade} picks made</div>
                </div>
                <div className="bdx-kpi">
                  <div className="v">{activeRuns.length}</div>
                  <div className="l">Active runs</div>
                  <div className="d">
                    {activeRuns.length > 0
                      ? activeRuns.map((r) => r.position).join(' · ')
                      : 'none in last 12 picks'}
                  </div>
                </div>
              </div>

              {/* ── Focus verdict ── */}
              <div className="bdx-card c-info" style={{ marginBottom: 14 }} data-testid="draft-focus">
                <div className="bdx-head">
                  <span className="bdx-kind">Focus — structural</span>
                  <span className="bdx-sev info">◆ what to attack next</span>
                  <span className="bdx-when">{intel.draft.name}</span>
                </div>
                {intel.focus.items.length > 0 ? (
                  <div className="bdx-rows">
                    {intel.focus.items.map((f, i) => (
                      <div className="bdx-row" key={f.slot}>
                        <span className="k" style={{ minWidth: 20 }}>{i + 1}</span>
                        <span className="x" style={{ textAlign: 'left', flex: 1 }}>
                          <b>{f.slot}</b>
                          <span style={{ color: 'var(--bdx-ink-dim)' }}> — {f.reason}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bdx-line">
                    Every starter slot your picks can cover is covered — depth and upside are the
                    play from here.
                  </div>
                )}
                <div className="bdx-line" style={{ marginTop: 8, color: 'var(--bdx-ink-faint)', fontSize: 11 }}>
                  {intel.focus.note}
                </div>
              </div>

              {/* ── Best available by the league's own ADP (slice 5) ── */}
              {intel.bestAvailable ? (
                <div className="bdx-panelbox" style={{ marginBottom: 14 }} data-testid="best-available">
                  <h3>Best available · {intel.bestAvailable.source}</h3>
                  <div className="bdx-rows">
                    {intel.bestAvailable.players.map((p, i) => (
                      <div className="bdx-row" key={p.playerId} style={{ alignItems: 'center' }}>
                        <span className="k" style={{ minWidth: 20 }}>{i + 1}</span>
                        <Headshot playerId={p.playerId} fallback={fallbackFor(p.name)} />
                        <span className="x" style={{ textAlign: 'left', flex: 1 }}>
                          {p.name}
                          <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
                            {' '}
                            {p.position ?? ''}
                            {p.team ? ` · ${p.team}` : ''}
                          </span>{' '}
                          {p.rookie ? <span className="bdx-sev info">R</span> : null}
                          {p.fillsSlots.length > 0 ? (
                            <span className="bdx-sev ok">▲ fills {p.fillsSlots.join(' · ')}</span>
                          ) : null}
                          {injuryFor(p.name) ? (
                            <span className="bdx-sev warn" title={injuryFor(p.name)?.note ?? undefined}>
                              ⚕ {injuryFor(p.name)?.status}
                            </span>
                          ) : null}
                        </span>
                        <span className="k" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.marketValue != null ? `val ${p.marketValue.toLocaleString()} · ` : ''}
                          ADP {p.adp.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="bdx-support" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {/* ── Needs heat ── */}
                <div className="bdx-panelbox">
                  <h3>Starter slots · from this draft&apos;s real settings</h3>
                  {intel.viewer.inDraft ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {intel.viewer.needs.map((n) => {
                        const open = n.required - n.filled
                        return (
                          <span
                            key={n.slot}
                            className={`bdx-sev ${open > 0 ? 'warn' : 'ok'}`}
                            title={`${n.filled}/${n.required} filled`}
                          >
                            {open > 0 ? '▲' : '✓'} {n.slot} {n.filled}/{n.required}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="bdx-rail-empty">
                      Your Sleeper account isn&apos;t in this draft&apos;s order, so needs can&apos;t
                      be computed for you.
                    </div>
                  )}
                </div>

                {/* ── Run detector ── */}
                <div className="bdx-panelbox">
                  <h3>Position runs · last 12 picks vs total</h3>
                  {intel.runs.length > 0 ? (
                    <div className="bdx-rows">
                      {intel.runs.slice(0, 8).map((r) => (
                        <div className="bdx-row" key={r.position}>
                          <span className="k" style={{ minWidth: 44 }}>{r.position}</span>
                          <span className="x" style={{ textAlign: 'left', flex: 1 }}>
                            {r.active ? (
                              <span className="bdx-sev crit">▲ RUN · {r.lastWindow} in window</span>
                            ) : (
                              <span style={{ color: 'var(--bdx-ink-dim)' }}>{r.lastWindow} in window</span>
                            )}
                          </span>
                          <span className="k">{r.total} total</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bdx-rail-empty">No picks yet — run detection starts with the feed.</div>
                  )}
                </div>

                {/* ── Room psychology ── */}
                <div className="bdx-panelbox">
                  <h3>Room read · counted behavior, not vibes</h3>
                  {intel.managers.length > 0 ? (
                    <table className="bdx-stand">
                      <thead>
                        <tr>
                          <th>Manager</th>
                          <th style={{ textAlign: 'right' }}>Picks</th>
                          <th style={{ textAlign: 'right' }}>Lean</th>
                          <th style={{ textAlign: 'right' }}>Pick trades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {intel.managers.map((m) => {
                          const lean = Object.entries(m.positionMix)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 2)
                            .map(([pos, n]) => `${pos}×${n}`)
                            .join(' ')
                          const src = avatarUrl(m.avatar)
                          return (
                            <tr key={m.userId}>
                              <td>
                                {src ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={src}
                                    alt=""
                                    style={{ width: 15, height: 15, borderRadius: '50%', objectFit: 'cover', verticalAlign: '-3px', marginRight: 4 }}
                                  />
                                ) : null}
                                {m.name}
                              </td>
                              <td className="rec">{m.picksMade}</td>
                              <td className="rec">{lean || '—'}</td>
                              <td className="rec">
                                {m.extraPicksAcquired > 0 || m.picksTradedAway > 0
                                  ? `+${m.extraPicksAcquired}/−${m.picksTradedAway}`
                                  : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="bdx-rail-empty">No picks made yet.</div>
                  )}
                </div>

                {/* ── Recent picks feed ── */}
                <div className="bdx-panelbox">
                  <h3>Last picks · newest first</h3>
                  {intel.recentPicks.length > 0 ? (
                    <div className="bdx-rows">
                      {intel.recentPicks.map((p) => (
                        <div className="bdx-row" key={p.pickNo} style={{ alignItems: 'center' }}>
                          <span className="k" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 44 }}>
                            {p.label}
                          </span>
                          <Headshot playerId={p.playerId} fallback={fallbackFor(p.playerName)} size={20} />
                          <span className="x" style={{ textAlign: 'left', flex: 1 }}>
                            {p.playerName}
                            {p.position ? (
                              <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}> {p.position}</span>
                            ) : null}
                          </span>
                          <span className="k">{p.byName}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bdx-rail-empty">The board is empty — picks stream in here live.</div>
                  )}
                </div>
              </div>

              {intel.missing.length > 0 ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                  {intel.missing.map((m) => (
                    <span key={m} className="bdx-sev warn">
                      ⚠ couldn&apos;t sync: {m}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="bdx-foot">
                Live from Sleeper&apos;s public draft feed · runs counted over the last 12 picks ·
                psychology is counted pick behavior · best-available is RotoWire market ADP in your
                league&apos;s exact format (never reranked by us) · pirate guidance applies only when
                declared · read-only.
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

export default DraftIntelHome
