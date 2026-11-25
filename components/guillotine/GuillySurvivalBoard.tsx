'use client'

import { Skull, Shield } from 'lucide-react'
import { fmtPts, type BoardRow, type SurvivalBoard } from '@/lib/guillotine/survivalBoardModel'
import './guilly-survival-board.css'

/**
 * The Matchup tab of a Guilly league (lib/guillotine/survivalBoardModel.ts): you against the whole league,
 * not against one opponent. Every sport; native and imported leagues alike.
 *
 *   1. One number — your gap to the chop line — and one action.
 *   2. The blade: every team placed on a single score strip, the chop line drawn across it, you ringed.
 *   3. The race either side of you: the team you must pass, and the team chasing you.
 *   4. The field, best first, with the chop line between the survivors and the chop zone.
 *   5. The graveyard: who has been chopped, week by week.
 */

export type BoardAction = { label: string; onClick: () => void; primary?: boolean }

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function Strip({ board }: { board: SurvivalBoard }) {
  if (!board.scored) return null
  const cutPct = board.bladePct
  return (
    <div className="gsb-strip" data-testid="gsb-strip" aria-hidden="true">
      <div className="gsb-strip-rail">
        {cutPct != null ? <span className="gsb-strip-zone" style={{ width: `${cutPct}%` }} /> : null}
        {cutPct != null ? <span className="gsb-strip-blade" style={{ left: `${cutPct}%` }}><span>Chop line</span></span> : null}
        {board.rows.map((r) =>
          r.trackPct == null ? null : (
            <span key={r.rosterId} className="gsb-dot" data-tier={r.tier} data-me={r.isMe || undefined} style={{ left: `${r.trackPct}%` }} title={`${r.name} · ${fmtPts(r.points)}`}>
              {r.isMe ? 'You' : initials(r.name)}
            </span>
          ),
        )}
      </div>
      <div className="gsb-strip-scale"><span>Lowest</span><span>Highest</span></div>
    </div>
  )
}

function Rival({ label, row, me }: { label: string; row: BoardRow | null; me: BoardRow | null }) {
  if (!row || !me) return null
  const diff = row.points != null && me.points != null ? row.points - me.points : null
  return (
    <div className="gsb-rival" data-tier={row.tier} data-testid={`gsb-rival-${label === 'To pass' ? 'above' : 'below'}`}>
      <span className="gsb-rival-label">{label}</span>
      <strong>{row.name}</strong>
      <span className="gsb-rival-pts">
        {fmtPts(row.points)}
        {diff != null ? <small>{diff >= 0 ? `+${fmtPts(diff)} ahead of you` : `${fmtPts(-diff)} behind you`}</small> : null}
      </span>
    </div>
  )
}

export function GuillySurvivalBoard({ board, actions = [], sourceNote, loading, error }: {
  board: SurvivalBoard | null
  actions?: BoardAction[]
  /** Imported leagues: "Scores from Sleeper" — the provider runs the chop. */
  sourceNote?: string | null
  loading?: boolean
  error?: string | null
}) {
  if (error) return <p className="gsb-error" role="alert">{error}</p>
  if (loading || !board) return <div className="gsb gsb-loading" data-testid="gsb-loading">Loading the chop line…</div>
  const b = board
  return (
    <div className="gsb" data-testid="guilly-survival-board" data-status={b.status} data-source={b.source}>
      <section className="gsb-hero" data-status={b.status}>
        <div className="gsb-hero-top">
          <span className="gsb-eyebrow">{b.week != null ? `Week ${b.week}` : 'This week'} · You vs. the league</span>
          <span className="gsb-alive">{b.alive} alive{b.graveyard.length ? ` · ${b.graveyard.length} chopped` : ''}</span>
        </div>
        <div className="gsb-hero-main">
          {b.status === 'chopped' ? <Skull className="gsb-hero-icon" aria-hidden /> : b.status === 'immune' ? <Shield className="gsb-hero-icon" aria-hidden /> : null}
          <h2 className="gsb-headline" data-testid="gsb-headline">{b.headline}</h2>
        </div>
        <p className="gsb-detail">{b.detail}</p>
        {b.me && b.scored ? (
          <div className="gsb-score-row">
            <span><small>Your score</small><b>{fmtPts(b.me.points)}</b></span>
            {b.status === 'chop_zone' ? (
              <span><small>Safe at</small><b>{fmtPts(b.safeScore)}</b></span>
            ) : (
              <span><small>Chop line</small><b>{fmtPts(b.cutScore)}</b></span>
            )}
            <span><small>Your rank</small><b>{b.rows.indexOf(b.me) + 1}<i>/{b.alive}</i></b></span>
          </div>
        ) : null}
        <Strip board={b} />
        {actions.length ? (
          <div className="gsb-actions">
            {actions.map((a) => (
              <button key={a.label} type="button" className="gsb-btn" data-primary={a.primary || undefined} onClick={a.onClick}>{a.label}</button>
            ))}
          </div>
        ) : null}
      </section>

      {b.me && b.scored && (b.above || b.below) ? (
        <section className="gsb-race" aria-label="The race around you">
          <Rival label="To pass" row={b.above} me={b.me} />
          <Rival label="Chasing you" row={b.below} me={b.me} />
        </section>
      ) : null}

      <section className="gsb-card" aria-label="Every team against the chop line">
        <h3 className="gsb-card-head">
          <span>The field</span>
          <span>{b.chopCount === 0 ? 'No chop this week' : b.chopCount > 1 ? `${b.chopCount} chopped this week` : 'Lowest score is chopped'}</span>
        </h3>
        {b.rows.length === 0 ? (
          <p className="gsb-empty" data-testid="gsb-empty">The chop line appears once the season has started.</p>
        ) : (
          <ol className="gsb-rows">
            {b.rows.map((r, i) => (
              <li key={r.rosterId}>
                {r.cutAbove ? <div className="gsb-cut" data-testid="gsb-chop-line"><span>Chop line</span></div> : null}
                <div className="gsb-row" data-tier={b.scored ? r.tier : undefined} data-me={r.isMe || undefined} data-testid={`gsb-row-${r.rosterId}`}>
                  <span className="gsb-rank">{b.scored ? i + 1 : ''}</span>
                  <span className="gsb-avatar">{initials(r.name)}</span>
                  <span className="gsb-name">
                    <strong>{r.name}{r.isMe ? <em>You</em> : null}</strong>
                    <small>
                      {r.immune ? 'Immune this week' : !b.scored ? 'Waiting for games' : r.tier === 'chop_zone' ? 'Chop zone' : r.tier === 'danger' ? 'In danger' : 'Safe'}
                      {b.scored && b.cutScore != null && r.points != null && r.tier !== 'chop_zone' ? ` · +${fmtPts(r.points - b.cutScore)}` : ''}
                    </small>
                  </span>
                  <span className="gsb-pts">{fmtPts(r.points)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="gsb-foot">
          {sourceNote ?? (b.chopLabel ? `Chop runs after stat corrections · ${b.chopLabel}` : 'Chop runs after stat corrections')}
        </p>
      </section>

      {b.graveyard.length ? (
        <section className="gsb-card" aria-label="Chopped teams">
          <h3 className="gsb-card-head"><span>Graveyard</span><span>{b.graveyard.length} chopped</span></h3>
          <ol className="gsb-grave" data-testid="gsb-graveyard">
            {b.graveyard.map((g) => (
              <li key={g.rosterId} data-me={g.isMe || undefined}>
                <span className="gsb-grave-week">{g.week != null ? `Wk ${g.week}` : '—'}</span>
                <Skull className="gsb-grave-icon" aria-hidden />
                <span className="gsb-grave-name">{g.name}{g.isMe ? ' (you)' : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}
