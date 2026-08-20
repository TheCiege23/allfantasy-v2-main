'use client'

/**
 * TradeLedgerGraded — the graded trade ledger (Legacy tab): every completed
 * trade since the league was created, graded on realized outcomes via
 * /api/league/trade-grades, re-graded every season.
 *
 * Honesty contract: every letter sits next to the numbers that produce it
 * (the grade scale ships in the payload); pending/unresolved picks are chips,
 * not guesses; the current season is marked partial; context notes from the
 * engine render verbatim.
 */

import { useEffect, useState } from 'react'
import { shareCardImage } from '@/components/decide/shareCard'
import type {
  GradedTrade,
  TradeAsset,
  TradeGradesPayload,
  TradePickAsset,
  TradeSideGrade,
} from '@/lib/trade-intel/sleeperTradeGradeService'
import type { ImportedTradeLedgerPayload } from '@/lib/trade-intel/importedTradeLedgerService'
import { sleeperAvatarThumb, sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; viewerSleeperUserId: string | null; grades: TradeGradesPayload | null; error?: string }
  | { supported: true; graded: false; viewerSleeperUserId: string | null; ledger: ImportedTradeLedgerPayload }

function GradePill({ letter }: { letter: string }) {
  const cls = letter === 'A' || letter === 'B' ? 'ok' : letter === 'C' ? 'info' : 'crit'
  return <span className={`bdx-sev ${cls}`}>{letter}</span>
}

function TrendMark({ trend }: { trend: TradeSideGrade['trend'] }) {
  if (trend === 'improving') return <span className="bdx-sev ok">▲ improving</span>
  if (trend === 'worsening') return <span className="bdx-sev crit">▼ worsening</span>
  return <span className="bdx-sev info">— steady</span>
}

function DepartChip({ departed }: { departed: TradeAsset['departed'] }) {
  if (!departed) return null
  return (
    <span
      className="bdx-sev info"
      title="The value clock stopped here — points after this week don't count toward this grade."
    >
      → {departed.via === 'traded' ? 're-traded' : 'dropped'} wk {departed.week} ’{departed.season.slice(2)}
    </span>
  )
}

function PlayerLine({ a, tradeSeason }: { a: TradeAsset; tradeSeason: string }) {
  const src = sleeperPlayerHeadshot(a.playerId)
  const credited = Object.values(a.creditedBySeason).reduce((x, y) => x + y, 0)
  const fullTotal = Object.values(a.pointsBySeason).reduce((x, y) => x + y, 0)
  const missed = a.gamesMissedBySeason[tradeSeason]
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
        {a.name}
        {a.position ? (
          <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}> {a.position}</span>
        ) : null}
        {missed != null && missed > 0 ? (
          <span className="bdx-sev warn" title={`missed ${missed} of 17 games in ${tradeSeason} (games-played proxy)`}>
            ⚕ {missed} gm
          </span>
        ) : null}
        <DepartChip departed={a.departed} />
      </span>
      <span
        className="k"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        title={`credited while held: ${credited.toFixed(1)} · full-season reference: ${fullTotal.toFixed(1)}`}
      >
        {credited !== 0 ? `${credited.toFixed(1)} pts` : '—'}
      </span>
    </div>
  )
}

function PickLine({ p }: { p: TradePickAsset }) {
  const total = p.resolved
    ? Object.values(p.resolved.creditedBySeason).reduce((x, y) => x + y, 0)
    : 0
  return (
    <div className="bdx-row" style={{ alignItems: 'center' }}>
      <span className="x" style={{ textAlign: 'left', flex: 1 }}>
        🎟 {p.label}
        {p.resolved ? (
          <span style={{ color: 'var(--bdx-ink-dim)' }}>
            {' '}
            → {p.resolved.name}
            {p.resolved.position ? (
              <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}> {p.resolved.position}</span>
            ) : null}
          </span>
        ) : (
          <span className="bdx-sev info" title="This pick has not been used yet (or its draft could not be resolved) — no value is guessed.">
            pending
          </span>
        )}
        {p.rerouted ? (
          <span
            className="bdx-sev info"
            title="This pick changed hands again before the draft — its outcome belongs to that later trade, so it isn't counted here."
          >
            moved again
          </span>
        ) : null}
        {p.resolved ? <DepartChip departed={p.resolved.departed} /> : null}
      </span>
      <span className="k" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {p.resolved && total !== 0 ? `${total.toFixed(1)} pts` : '—'}
      </span>
    </div>
  )
}

function SideBlock({ side, trade }: { side: TradeSideGrade; trade: GradedTrade }) {
  const avatar = sleeperAvatarThumb(side.avatar)
  return (
    <div className="bdx-panelbox">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
        ) : null}
        <span style={{ fontWeight: 800 }}>{side.managerName}</span>
        {side.teamName ? (
          <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>{side.teamName}</span>
        ) : null}
        {side.madePlayoffs != null ? (
          <span className={`bdx-sev ${side.madePlayoffs ? 'ok' : 'info'}`}>
            {side.madePlayoffs ? `✓ playoffs ’${trade.season.slice(2)}` : `no playoffs ’${trade.season.slice(2)}`}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="bdx-sub">initial</span>
        <GradePill letter={side.initialGrade} />
        <span className="bdx-sub">now</span>
        <GradePill letter={side.currentGrade} />
        <TrendMark trend={side.trend} />
        <span className="k" style={{ fontVariantNumeric: 'tabular-nums' }}>
          net {side.cumulativeNet > 0 ? '+' : ''}
          {side.cumulativeNet.toFixed(1)}
        </span>
      </div>
      <div className="bdx-sub" style={{ marginBottom: 4 }}>Received</div>
      <div className="bdx-rows" style={{ marginBottom: 8 }}>
        {side.playersIn.map((a) => (
          <PlayerLine key={a.playerId} a={a} tradeSeason={trade.season} />
        ))}
        {side.picksIn.map((p, i) => (
          <PickLine key={`${p.season}-${p.round}-${i}`} p={p} />
        ))}
        {side.playersIn.length === 0 && side.picksIn.length === 0 ? (
          <div className="bdx-rail-empty">nothing received</div>
        ) : null}
      </div>
      <div className="bdx-sub" style={{ marginBottom: 4 }}>Gave up</div>
      <div className="bdx-rows" style={{ marginBottom: 8 }}>
        {side.playersOut.map((a) => (
          <PlayerLine key={a.playerId} a={a} tradeSeason={trade.season} />
        ))}
        {side.picksOut.map((p, i) => (
          <PickLine key={`${p.season}-${p.round}-${i}`} p={p} />
        ))}
        {side.playersOut.length === 0 && side.picksOut.length === 0 ? (
          <div className="bdx-rail-empty">nothing given up</div>
        ) : null}
      </div>
      {side.seasonNets.length > 0 ? (
        <div className="bdx-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {side.seasonNets
            .map(
              (s) =>
                `’${s.season.slice(2)} ${s.net > 0 ? '+' : ''}${s.net.toFixed(0)}${s.partial ? '*' : ''}`,
            )
            .join(' → ')}
          {side.seasonNets.some((s) => s.partial) ? '  (* season in progress)' : ''}
        </div>
      ) : null}
    </div>
  )
}

function ShareTradeButton({
  leagueId,
  tradeId,
  season,
}: {
  leagueId: string
  tradeId: string
  season: string
}) {
  const [state, setState] = useState<'idle' | 'working' | 'shared' | 'downloaded' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="bdx-btn sec"
      style={{ padding: '4px 10px', fontSize: 11.5 }}
      disabled={state === 'working'}
      onClick={() => {
        setState('working')
        void shareCardImage(
          `/api/share/trade-card?leagueId=${encodeURIComponent(leagueId)}&tradeId=${encodeURIComponent(tradeId)}`,
          `trade-grade-${season}.png`,
          'Who won this trade?',
        ).then(setState)
      }}
    >
      {state === 'working'
        ? 'Building card…'
        : state === 'downloaded'
          ? 'Card saved ✓'
          : state === 'shared'
            ? 'Shared ✓'
            : state === 'failed'
              ? 'Retry share'
              : 'Share card'}
    </button>
  )
}

export function TradeLedgerGraded({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/trade-grades?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, viewerSleeperUserId: null, grades: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const grades = data && data.supported && 'grades' in data ? data.grades : null
  const ledger = data && data.supported && 'ledger' in data ? data.ledger : null

  return (
    <div data-testid="trade-ledger-graded">
      <div className="bdx-kick" style={{ marginTop: 22 }}>
        <h2 className="bdx-disp">{ledger ? 'Trade ledger' : 'Graded trade ledger'}</h2>
        <span className="bdx-sub">
          {ledger
            ? `${ledger.trades.length} trade${ledger.trades.length === 1 ? '' : 's'} from the imported ${ledger.platform} history · listed, not graded`
            : grades
              ? `${grades.trades.length} trade${grades.trades.length === 1 ? '' : 's'} since ${grades.seasonsScanned[0] ?? '—'} · re-graded every season`
              : 'every trade since the league was created'}
        </span>
      </div>

      {loading ? (
        <div className="bdx-skel" />
      ) : ledger ? (
        <>
          <div className="bdx-empty" style={{ marginBottom: 12 }}>
            <div className="m">
              {ledger.notes.map((n) => (
                <span key={n}>
                  {n}
                  <br />
                </span>
              ))}
            </div>
          </div>
          {ledger.trades.length === 0 ? (
            <div className="bdx-empty">
              <div className="t">No trades found in this league&apos;s imported history</div>
              <div className="m">Re-running the import refreshes the transaction log.</div>
            </div>
          ) : (
            ledger.trades.map((trade) => (
              <div className="bdx-card c-info" style={{ marginBottom: 12 }} key={trade.id}>
                <div className="bdx-head">
                  <span className="bdx-kind">{trade.season ?? 'season unknown'}</span>
                  <span className="bdx-sev info">imported · ungraded</span>
                  {trade.dateIso ? (
                    <span className="bdx-when">{new Date(trade.dateIso).toLocaleDateString()}</span>
                  ) : null}
                </div>
                <div
                  className="bdx-support"
                  style={{
                    gridTemplateColumns: trade.sides.length > 2 ? '1fr 1fr 1fr' : '1fr 1fr',
                    marginTop: 8,
                  }}
                >
                  {trade.sides.map((side) => (
                    <div key={side.teamId}>
                      <div className="bdx-row k" style={{ marginBottom: 4 }}>
                        {side.managerName} received
                      </div>
                      {side.received.map((p) => (
                        <div className="bdx-row" key={p.playerId}>
                          <span>
                            {p.name ?? `Player #${p.playerId}`}
                            {p.position ? <span className="x"> · {p.position}</span> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      ) : !grades ? (
        <div className="bdx-empty">
          <div className="t">Trade grading temporarily unavailable</div>
          <div className="m">
            The first sync walks every season&apos;s transaction feed and can take a moment — try
            again shortly. Nothing is graded from partial data.
          </div>
        </div>
      ) : (
        <>
          {grades.staleAsOf ? (
            <div className="bdx-card c-warn" style={{ marginBottom: 12 }}>
              <div className="bdx-line">
                Showing the last synced grades (upstream unavailable) — as of{' '}
                <b>{new Date(grades.staleAsOf).toLocaleString()}</b>.
              </div>
            </div>
          ) : null}

          <div className="bdx-empty" style={{ marginBottom: 12 }}>
            <div className="m">
              <b>How grades work:</b> {grades.gradeScale.description} A ≥ +100 · B ≥ +40 · C &gt;
              −40 · D &gt; −100 · F below. Tie when no side is beyond ±{grades.gradeScale.tieBand}.
              {grades.contextNotes.map((n) => (
                <span key={n}>
                  <br />
                  {n}
                </span>
              ))}
            </div>
          </div>

          {grades.trades.length === 0 ? (
            <div className="bdx-empty">
              <div className="t">No completed trades found in this league&apos;s history</div>
              <div className="m">When a trade completes, it&apos;s graded here automatically.</div>
            </div>
          ) : (
            grades.trades.map((trade) => (
              <div className="bdx-card c-info" style={{ marginBottom: 12 }} key={trade.id}>
                <div className="bdx-head">
                  <span className="bdx-kind">
                    {trade.season} · week {trade.week}
                  </span>
                  {trade.tie ? <span className="bdx-sev info">= TIE (so far)</span> : null}
                  {trade.multiTeam ? <span className="bdx-sev info">multi-team</span> : null}
                  {trade.hasPendingPicks ? <span className="bdx-sev warn">🎟 picks pending</span> : null}
                  <ShareTradeButton leagueId={leagueId} tradeId={trade.id} season={trade.season} />
                  <span className="bdx-when">{new Date(trade.createdIso).toLocaleDateString()}</span>
                </div>
                <div
                  className="bdx-support"
                  style={{ gridTemplateColumns: trade.sides.length > 2 ? '1fr 1fr 1fr' : '1fr 1fr', marginTop: 8 }}
                >
                  {trade.sides.map((side) => (
                    <SideBlock key={side.rosterId} side={side} trade={trade} />
                  ))}
                </div>
              </div>
            ))
          )}

          {grades.missing.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {grades.missing.map((m) => (
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

export default TradeLedgerGraded
