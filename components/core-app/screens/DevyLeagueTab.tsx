'use client'

/*
 * ⚠ THE CLASS ON THE ROOT IS HALF THE FIX; THIS IMPORT IS THE OTHER HALF.
 * `.af-core` selects nothing unless af-core.css is in the bundle. Without it every
 * `var(--token)` in af-devy.css resolves to nothing: cards lose their background and
 * border, and `--accent` silently falls through to the GLOBAL #7c3aed purple that
 * app/globals.css sets at :root, instead of the handoff's #22d3ee cyan.
 *
 * Measured on the preview before this line existed — `getComputedStyle` reported
 * `--accent: #7c3aed`, `--surface: ''`, card background transparent and border 0px.
 * Nothing threw and nothing 404'd; the screen just painted wrong, which is how
 * DefenseHubClient's own note says this break survives review.
 *
 * A JS import rather than an `@import` inside af-devy.css: per app/layout.tsx an
 * @import in a route-bundled CSS file is dropped once another af-*.css is
 * concatenated ahead of it.
 */
import '../af-core.css'
import '../af-devy.css'
import type { DevyNewsItem, DevyTrend, DevyViewState } from './DevyCore'

/**
 * Devy — the per-league tab.
 *
 * Built from `design-refs/devy-handoff/AF Devy League Tab.dc.html`. Same shell and the
 * same three view states as `DevyCore`; everything here is scoped to one connected
 * league's roster, draft and trades rather than to the user's whole portfolio.
 *
 * ⚠ THE STATE SWITCHER IS ABSENT FOR THE SAME REASON AS IN DevyCore — the handoff's
 * README calls it a QA control that must not ship.
 *
 * ⚠ THE EMPTY STATE IS COMMISSIONER-GATED, AND THAT IS A CONTENT DECISION, NOT A STYLE
 * ONE. "Enable in league settings" is an instruction only a commissioner can follow;
 * showing it to a regular manager tells them to do something they cannot, which is worse
 * than saying nothing. `isCommissioner` picks the copy.
 */

export interface DevySlot {
  id: string
  /** Null means an empty devy bench slot, which the design renders as a dashed tile. */
  player: { name: string; position: string; school: string; headshotUrl: string | null; teamColor: string | null } | null
}

export interface DevyFreeAgent {
  id: string
  name: string
  position: string
  school: string
  grade: number | null
  headshotUrl: string | null
}

export interface DevyDraftPick {
  id: string
  /** e.g. "R1 · P2" */
  label: string
  team: string
  status: 'drafted' | 'on-the-clock' | 'upcoming'
  selection: string | null
}

export interface DevyTradeValue {
  player: string
  value: number | null
  trend: DevyTrend
  /** "Rostered · You", a manager name, or "Free agent". */
  status: string
}

export interface DevyLeagueTabProps {
  viewState: DevyViewState
  leagueName: string
  isCommissioner?: boolean
  slots: DevySlot[]
  freeAgents: DevyFreeAgent[]
  draftRoundLabel: string
  draftCountdown: string | null
  draftBoard: DevyDraftPick[]
  news: DevyNewsItem[]
  tradeValues: DevyTradeValue[]
  settingsHref?: string
  onAddFreeAgent?: (id: string) => void
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function Avatar({ url, name, color }: { url: string | null; name: string; color: string | null }) {
  return (
    <div className="af-devy-avatar-wrap" style={{ width: 40, height: 40 }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- vendor headshot CDNs are not in next.config images
        <img className="af-devy-avatar" src={url} alt="" loading="lazy" style={{ width: 40, height: 40 }} />
      ) : (
        <div className="af-devy-avatar-fb" style={{ width: 40, height: 40, fontSize: 12 }} aria-hidden="true">
          {initials(name)}
        </div>
      )}
      {color ? (
        <span
          className="af-devy-badge"
          style={{ background: color, width: 16, height: 16 }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}

function Trend({ trend }: { trend: DevyTrend }) {
  const glyph = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'
  const label = trend === 'up' ? 'Trending up' : trend === 'down' ? 'Trending down' : 'Flat'
  return (
    <span className={`af-devy-trend af-devy-trend--${trend}`} title={label}>
      <span aria-hidden="true">{glyph}</span>
      <span className="af-sr-only"> {label}</span>
    </span>
  )
}

export default function DevyLeagueTab({
  viewState,
  leagueName,
  isCommissioner = false,
  slots,
  freeAgents,
  draftRoundLabel,
  draftCountdown,
  draftBoard,
  news,
  tradeValues,
  settingsHref,
  onAddFreeAgent,
}: DevyLeagueTabProps) {
  return (
    <div className="af-core af-devy">
      <header className="af-devy-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div className="af-devy-eyebrow">{leagueName} · Devy</div>
          <h1 className="af-devy-title">Devy</h1>
          <p className="af-devy-sub">
            College prospects for this league — your devy slots, who is available, the devy draft,
            and what they are worth here.
          </p>
        </div>
      </header>

      {viewState === 'loading' ? (
        <div className="af-devy-state" role="status" aria-live="polite">
          <div className="af-devy-spinner" aria-hidden="true" />
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text2)' }}>Loading devy data…</div>
          <div className="af-devy-skel" aria-hidden="true">
            <span style={{ width: '70%' }} />
            <span style={{ width: '90%' }} />
            <span style={{ width: '55%' }} />
          </div>
        </div>
      ) : null}

      {viewState === 'empty' ? (
        <div className="af-devy-state">
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>
            This league hasn&apos;t turned on devy slots
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 440 }}>
            {isCommissioner
              ? 'Add devy or taxi slots in league settings and this tab fills with the college pool.'
              : 'Your commissioner can add devy or taxi slots in league settings.'}
          </div>
          {/*
            ⚠ `href={settingsHref ?? '#'}` SHIPPED A BUTTON THAT GOES NOWHERE.
            With no settingsHref the CTA still rendered, fully live-looking, and
            pointed at '#' — a commissioner reads "Enable in league settings",
            clicks, and the page does not move. That is worse than the disabled
            Add buttons below, which at least LOOK unavailable; this one gives no
            signal at all, and the natural read is that the feature is broken.

            The codebase already settled this case: EspnConnectPanel's install
            CTA is gated on a real URL existing, with the note "Absent -> the
            install CTA is replaced by an honest sentence rather than a button
            that goes nowhere." Same rule here.

            The sentence still tells a commissioner what to do — the destination
            is a page they can reach on their own — so nothing is lost except a
            control that could not work.
          */}
          {isCommissioner ? (
            settingsHref ? (
              <a className="af-devy-btn" href={settingsHref}>
                Enable in league settings
              </a>
            ) : (
              <p className="af-devy-note">
                Devy slots are turned on under this league&rsquo;s settings, in the
                roster section.
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {viewState === 'populated' ? (
        <>
          <section className="af-devy-card" aria-labelledby="af-devy-slots">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-slots">
                Your devy slots
              </div>
              <span className="af-devy-pill">
                {slots.filter((s) => s.player).length} of {slots.length} filled
              </span>
            </div>
            <div className="af-devy-grid3">
              {slots.map((s) =>
                s.player ? (
                  <div className="af-devy-tile" key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar url={s.player.headshotUrl} name={s.player.name} color={s.player.teamColor} />
                    <div style={{ minWidth: 0 }}>
                      <div className="af-devy-slot-name">{s.player.name}</div>
                      <div className="af-devy-meta">
                        {s.player.position} · {s.player.school}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="af-devy-tile af-devy-tile--dashed" key={s.id}>
                    Empty devy slot
                  </div>
                ),
              )}
            </div>
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-fa">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-fa">
                Available devy free agents
              </div>
            </div>
            {freeAgents.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--faint)', margin: 0 }}>
                Every tracked prospect in this league is rostered.
              </p>
            ) : (
              freeAgents.map((fa) => (
                <div className="af-devy-prospect" key={fa.id}>
                  <Avatar url={fa.headshotUrl} name={fa.name} color={null} />
                  <div style={{ minWidth: 0 }}>
                    <div className="af-devy-name">{fa.name}</div>
                    <div className="af-devy-meta">
                      {fa.position} · {fa.school}
                      {fa.grade != null ? ` · ${Math.round(fa.grade)} grade` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="af-devy-btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => onAddFreeAgent?.(fa.id)}
                    disabled={!onAddFreeAgent}
                    /* Disabled rather than inert-and-silent when no handler is wired: a button
                       that looks live and does nothing is the worse of the two.
                       ⚠ THE REASON IS NOT ON A `title` ANY MORE — see the note below the
                       list. A tooltip on a DISABLED button is the least reliable place a
                       reason can live: browsers suppress pointer events on disabled form
                       controls, so the native tooltip often never fires at all, and it
                       never appears on touch. */
                    aria-describedby={onAddFreeAgent ? undefined : 'af-devy-fa-unwired'}
                  >
                    Add
                  </button>
                </div>
              ))
            )}
            {/*
              ⚠ SAID ONCE, AND SAID VISIBLY. Every Add button on this list is
              disabled until a handler is wired, and the reason used to live on
              each button's `title`. That is the least reliable place to put it:
              browsers suppress pointer events on disabled form controls, so the
              native tooltip frequently never fires, and it never appears on
              touch at all. What a person actually saw was a column of greyed
              buttons with no explanation — the same dead-control shape as
              Yahoo's tile on the import screen, where the reason sat in a branch
              that could not render.

              One line for the list rather than one per row: the fact is about
              the surface, not about any particular prospect, and repeating it
              down fifteen rows would bury the names people came to read.

              `aria-describedby` ties the buttons to it, so the explanation
              reaches a screen reader on focus without being restated per row.
            */}
            {!onAddFreeAgent && freeAgents.length > 0 ? (
              <p className="af-devy-note" id="af-devy-fa-unwired">
                Adds are read-only here for now — this view can show you the pool,
                but roster moves still happen on your league&rsquo;s own platform.
              </p>
            ) : null}
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-board">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-board">
                Devy draft board · {draftRoundLabel}
              </div>
              {draftCountdown ? <span className="af-devy-pill">{draftCountdown}</span> : null}
            </div>
            <div className="af-devy-grid4">
              {draftBoard.map((d) => (
                <div
                  className={`af-devy-tile${d.status === 'on-the-clock' ? ' af-devy-pick--live' : ''}`}
                  key={d.id}
                >
                  <div className="af-devy-pick-lab">{d.label}</div>
                  <div className="af-devy-name" style={{ marginTop: 4 }}>
                    {d.team}
                  </div>
                  <div className="af-devy-pick-status">
                    {d.status === 'drafted'
                      ? (d.selection ?? 'Drafted')
                      : d.status === 'on-the-clock'
                        ? 'On the clock'
                        : 'Upcoming'}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-lnews">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-lnews">
                Devy news · this league
              </div>
            </div>
            {news.map((n) => (
              <div className="af-devy-news" key={n.id}>
                <span className={`af-devy-tag af-devy-tag--${n.kind}`}>{n.kind}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="af-devy-name">{n.player}</div>
                  <div className="af-devy-meta">{n.blurb}</div>
                </div>
                <span className="af-devy-time">{n.age}</span>
              </div>
            ))}
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-tv">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-tv">
                Devy trade values
              </div>
            </div>
            <div className="af-devy-tablewrap">
              <table className="af-devy-table">
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Value</th>
                    <th scope="col">Trend</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeValues.map((t) => (
                    <tr key={t.player}>
                      <td>{t.player}</td>
                      <td className="af-devy-num">{t.value == null ? '—' : Math.round(t.value)}</td>
                      <td>
                        <Trend trend={t.trend} />
                      </td>
                      <td>{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="af-devy-note">
              Devy values are this league&apos;s scoring applied to a college projection, not a
              market price. They move with the projection, and a prospect years from the draft
              carries more uncertainty than the number shows.
            </p>
          </section>
        </>
      ) : null}
    </div>
  )
}
