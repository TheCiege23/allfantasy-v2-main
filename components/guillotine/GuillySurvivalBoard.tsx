'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Skull, Shield } from 'lucide-react'
import { formatSpecialtyCountdown } from '@/components/league/specialty/theme'
import { fmtPts, type BoardRow, type BoardTier, type SurvivalBoard } from '@/lib/guillotine/survivalBoardModel'
import './guilly-survival-board.css'

/**
 * The Chop page of a Guilly league (lib/guillotine/survivalBoardModel.ts): you against the whole league,
 * not against one opponent. Every sport; native and imported leagues alike.
 *
 *   1. One number — your gap to the chop line — one clock and one action.
 *   2. The blade: every team placed on a single score strip, the chop line drawn across it, you ringed.
 *   3. The race either side of you: the team you must pass, and the team chasing you.
 *   4. The list: every team alive, in zones, with the chop zone on top or at the bottom as the league
 *      chose (lib/guillotine/chopListOrder.ts). Before anyone scores the zones are the projection's, and say so.
 *   5. The graveyard: who has been chopped, week by week.
 */

/** A button under the headline: `href` for a page of its own (a link), `onClick` for a tab of this workspace. */
export type BoardAction = { label: string; primary?: boolean } & ({ onClick: () => void; href?: undefined } | { href: string; onClick?: undefined })

/** Step through the weeks already chopped and back to this week. `weeks` is every week on offer, oldest first. */
export type BoardWeekPicker = { weeks: number[]; selected: number; label: string; onSelect: (week: number) => void }

function oddsBand(pct: number): 'safe' | 'danger' | 'chop_zone' {
  return pct >= 80 ? 'safe' : pct >= 40 ? 'danger' : 'chop_zone'
}

const ZONE_NAME: Record<BoardTier, string> = { safe: 'Safe', danger: 'Danger', chop_zone: 'Chop zone' }

/** "3 to play · proj 98.2" — whichever parts this league can say. */
function rowOutlook(r: BoardRow): string {
  const parts: string[] = []
  if (r.playersLeft != null) parts.push(r.playersLeft === 0 ? 'Done for the week' : `${r.playersLeft} to play`)
  if (r.projectedFinish != null && r.playersLeft !== 0) parts.push(`proj ${fmtPts(r.projectedFinish)}`)
  return parts.join(' · ')
}

/** What a row says under its name. The zone is named once, above the zone; the row adds only what is its own. */
function rowNote(b: SurvivalBoard, r: BoardRow): string {
  if (r.immune) return 'Immune this week'
  if (b.scored) {
    if (r.tier === 'chop_zone') return b.final ? 'Chopped' : 'Lowest score'
    return b.cutScore != null && r.points != null ? `+${fmtPts(r.points - b.cutScore)} over the line` : ''
  }
  if (b.projected) return ''
  return r.playersLeft != null ? 'No scores yet' : 'Waiting for games'
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** "Chop locks in 2d 04:10". Renders nothing time-dependent until mounted, so server and client markup agree. */
function ChopClock({ target, caption }: { target: string | Date; caption?: string | null }) {
  const targetMs = new Date(target).getTime()
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const text = now == null || !Number.isFinite(targetMs) ? '—' : formatSpecialtyCountdown(targetMs - now) ?? '—'
  return (
    <span className="gsb-clock" role="timer" aria-label={`Chop locks in: ${text}`} data-testid="gsb-clock">
      <small>Chop locks in</small>
      <b>{text}</b>
      {caption ? <i>{caption}</i> : null}
    </span>
  )
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

function WeekPicker({ picker }: { picker: BoardWeekPicker }) {
  const i = picker.weeks.indexOf(picker.selected)
  const prev = i > 0 ? picker.weeks[i - 1] : null
  const next = i >= 0 && i < picker.weeks.length - 1 ? picker.weeks[i + 1] : null
  return (
    <span className="gsb-weeks" data-testid="gsb-week-picker">
      <button type="button" aria-label="Earlier week" disabled={prev == null} onClick={() => prev != null && picker.onSelect(prev)} data-testid="gsb-week-prev">
        <ChevronLeft aria-hidden />
      </button>
      <span aria-live="polite">{picker.label}</span>
      <button type="button" aria-label="Later week" disabled={next == null} onClick={() => next != null && picker.onSelect(next)} data-testid="gsb-week-next">
        <ChevronRight aria-hidden />
      </button>
    </span>
  )
}

export function GuillySurvivalBoard({ board, actions = [], sourceNote, loading, error, weekLabel, chopAt, weekPicker, extra }: {
  board: SurvivalBoard | null
  actions?: BoardAction[]
  /** Imported leagues: "Scores from Sleeper" — the provider runs the chop. */
  sourceNote?: string | null
  loading?: boolean
  error?: string | null
  /** "Week 7 of 24" for the eyebrow; the board's own "Week 7" when absent. */
  weekLabel?: string | null
  /** When this week's chop locks (ISO). Draws the countdown; nothing for a week already chopped. */
  chopAt?: string | null
  weekPicker?: BoardWeekPicker | null
  /** Drawn under the list and above the graveyard: this week's chop moment, on the page that has one. */
  extra?: ReactNode
}) {
  if (error) return <p className="gsb-error" role="alert">{error}</p>
  if (loading || !board) return <div className="gsb gsb-loading" data-testid="gsb-loading">Loading the chop line…</div>
  const b = board
  const zoned = b.scored || b.projected
  const listNote = b.final
    ? 'Final'
    : b.chopCount === 0
      ? 'No chop this week'
      : b.projected
        ? 'Projected · no scores yet'
        : b.chopCount > 1
          ? `${b.chopCount} chopped this week`
          : 'Lowest score is chopped'
  return (
    <div className="gsb" data-testid="guilly-survival-board" data-status={b.status} data-source={b.source} data-order={b.order}>
      <section className="gsb-hero" data-status={b.status}>
        <div className="gsb-hero-top">
          <span className="gsb-eyebrow" data-testid="gsb-eyebrow">
            {weekLabel ?? (b.week != null ? `Week ${b.week}` : 'This week')}{b.notCountingWeek != null ? ' preview' : ''} · You vs. the league
          </span>
          <span className="gsb-alive">{b.alive} {b.final ? 'played' : 'alive'}{b.graveyard.length ? ` · ${b.graveyard.length} chopped` : ''}</span>
        </div>
        <div className="gsb-hero-body">
          <div className="gsb-hero-text">
            <div className="gsb-hero-main">
              {b.status === 'chopped' ? <Skull className="gsb-hero-icon" aria-hidden /> : b.status === 'immune' ? <Shield className="gsb-hero-icon" aria-hidden /> : null}
              <h2 className="gsb-headline" data-testid="gsb-headline">{b.headline}</h2>
            </div>
            <p className="gsb-detail">{b.detail}</p>
          </div>
          {chopAt && !b.final ? <ChopClock target={chopAt} caption={b.chopLabel} /> : null}
        </div>
        {b.me && (b.me.safePct != null || b.me.playersLeft != null) ? (
          <div className="gsb-score-row">
            {b.me.safePct != null ? (
              <span className="gsb-odds" data-testid="gsb-my-odds" data-band={oddsBand(b.me.safePct)}><small>Chance safe</small><b>{b.me.safePct}%</b></span>
            ) : null}
            {b.me.playersLeft != null ? (
              <span data-testid="gsb-my-left"><small>Players left</small><b>{b.me.playersLeft}<i> · {b.me.gamesLeft ?? 0} {b.me.gamesLeft === 1 ? 'game' : 'games'}</i></b></span>
            ) : null}
          </div>
        ) : null}
        {b.me && b.scored ? (
          <div className="gsb-score-row">
            <span><small>Your score</small><b>{fmtPts(b.me.points)}</b></span>
            {b.status === 'chop_zone' ? (
              <span><small>Safe at</small><b>{fmtPts(b.safeScore)}</b></span>
            ) : (
              <span><small>Chop line</small><b>{fmtPts(b.cutScore)}</b></span>
            )}
            <span><small>Your rank</small><b>{b.me.rank ?? '—'}<i>/{b.alive}</i></b></span>
          </div>
        ) : null}
        <Strip board={b} />
        {actions.length ? (
          <div className="gsb-actions">
            {actions.map((a) =>
              a.href != null ? (
                <Link key={a.label} href={a.href} className="gsb-btn" data-primary={a.primary || undefined}>{a.label}</Link>
              ) : (
                <button key={a.label} type="button" className="gsb-btn" data-primary={a.primary || undefined} onClick={a.onClick}>{a.label}</button>
              ),
            )}
          </div>
        ) : null}
      </section>

      {b.me && b.scored && !b.final && (b.above || b.below) ? (
        <section className="gsb-race" aria-label="The race around you">
          <Rival label="To pass" row={b.above} me={b.me} />
          <Rival label="Chasing you" row={b.below} me={b.me} />
        </section>
      ) : null}

      <section className="gsb-card" aria-label="Every team against the chop line">
        <h3 className="gsb-card-head">
          <span>Who is getting chopped</span>
          {weekPicker && weekPicker.weeks.length > 1 ? <WeekPicker picker={weekPicker} /> : <span data-testid="gsb-list-note">{listNote}</span>}
        </h3>
        {weekPicker && weekPicker.weeks.length > 1 ? <p className="gsb-list-note" data-testid="gsb-list-note">{listNote}</p> : null}
        {b.rows.length === 0 ? (
          <p className="gsb-empty" data-testid="gsb-empty">The chop line appears once the season has started.</p>
        ) : (
          <ol className="gsb-rows" data-testid="gsb-rows">
            {b.rows.map((r) => (
              <li key={r.rosterId}>
                {r.cutAbove ? (
                  <div className="gsb-cut" data-testid="gsb-chop-line"><span>{b.projected ? 'Projected chop zone' : 'Chop zone'}</span></div>
                ) : r.zoneStart ? (
                  <div className="gsb-zone" data-tier={r.zoneStart} data-testid={`gsb-zone-${r.zoneStart}`}>{ZONE_NAME[r.zoneStart]}</div>
                ) : null}
                <div className="gsb-row" data-tier={zoned ? r.tier : undefined} data-me={r.isMe || undefined} data-testid={`gsb-row-${r.rosterId}`}>
                  <span className="gsb-rank">{r.rank ?? ''}</span>
                  <span className="gsb-avatar">{initials(r.name)}</span>
                  <span className="gsb-name">
                    <strong>{r.name}{r.isMe ? <em>You</em> : null}</strong>
                    {rowNote(b, r) ? <small>{rowNote(b, r)}</small> : null}
                    {rowOutlook(r) ? <small className="gsb-row-left" data-testid={`gsb-left-${r.rosterId}`}>{rowOutlook(r)}</small> : null}
                  </span>
                  <span className="gsb-pts">
                    {fmtPts(r.points)}
                    {r.safePct != null ? <small className="gsb-row-odds" data-band={oddsBand(r.safePct)} data-testid={`gsb-odds-${r.rosterId}`}>{r.safePct}% safe</small> : null}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
        {b.hasOdds ? <p className="gsb-foot gsb-foot-note">% safe plays out the rest of the week 4,000 times from each team&apos;s score and the projection for the games it has left. It is a projection, not a promise.</p> : null}
        {b.final ? null : (
          <p className="gsb-foot">
            {sourceNote ?? (b.chopLabel ? `Chop runs after stat corrections · ${b.chopLabel}` : 'Chop runs after stat corrections')}
          </p>
        )}
      </section>

      {extra}

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
