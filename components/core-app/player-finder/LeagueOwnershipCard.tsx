'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import { claimLink, lineupLink, platformLabel, tradeLink } from '@/lib/core-app/platformLinks'

/**
 * The league-scoped answer: in THIS league, is he yours, someone's, or free.
 *
 * Rendered above the cross-league table when a league is in context. It is a
 * promotion, not a filter — the table below still shows every league — but it
 * is the only place on the screen that names the manager who has him, which
 * is what a trade needs.
 *
 * ⚠ FOUR STATES, EACH SAID PLAINLY. "Free agent" is a claim about a league
 * whose rosters we read; a league with none imported gets the `unknown` reason
 * rather than a green "unrostered" that would send someone to claim a player
 * who is on a roster we never saw.
 */

function OwnerMark({ src, letter }: { src: string | null; letter: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className="af-pf-lv-avatar af-pf-lv-avatar--letter" aria-hidden>
        {letter}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="af-pf-lv-avatar" src={src} alt="" width={40} height={40} onError={() => setFailed(true)} />
  )
}

function slotTone(slot: string): 'good' | 'warn' | 'bad' | 'none' {
  if (slot === 'STARTER') return 'good'
  if (slot === 'IR SLOT') return 'warn'
  if (slot === 'BENCH' || slot === 'TAXI') return 'bad'
  return 'none'
}

export function LeagueOwnershipCard({
  view,
  playerName,
}: {
  view: PlayerLeagueView
  playerName: string
}) {
  const league = {
    id: view.leagueId,
    platform: view.platform,
    platformLeagueId: view.platformLeagueId,
    season: view.season,
    name: view.leagueName,
  }
  const last = playerName.trim().split(/\s+/).slice(-1)[0] ?? playerName
  const o = view.ownership

  return (
    <section className="af-card af-pf-lv" data-kind={o.kind} aria-labelledby="af-pf-lv-h">
      <header className="af-pf-lv-head">
        <span className="af-label">In this league</span>
        <h3 className="af-pf-h3" id="af-pf-lv-h">
          <span className="af-platform af-pf-platform" data-platform={view.platform}>
            {view.platform}
          </span>
          <Link href={`/core?league=${encodeURIComponent(view.leagueId)}`} className="af-pf-lv-league">
            {view.leagueName}
          </Link>
          {view.format ? <span className="af-pf-lv-format">{view.format}</span> : null}
        </h3>
      </header>

      <div className="af-pf-lv-body">
        {o.kind === 'yours' ? (
          <>
            <div className="af-pf-lv-who">
              <OwnerMark src={null} letter="Y" />
              <span className="af-pf-lv-who-text">
                <span className="af-pf-lv-who-name">On your roster{o.teamName ? ` — ${o.teamName}` : ''}</span>
                <span className="af-pf-lv-who-meta">That&apos;s you. The slot below is where he sits right now.</span>
              </span>
            </div>
            <span className="af-chip af-num af-pf-slot" data-tone={slotTone(o.slot)}>
              {o.exactSlot ?? o.slot}
            </span>
          </>
        ) : o.kind === 'other' ? (
          <>
            <div className="af-pf-lv-who">
              <OwnerMark
                src={o.owner?.avatarUrl ?? null}
                letter={(o.owner?.teamName ?? o.owner?.ownerName ?? '?').charAt(0).toUpperCase()}
              />
              <span className="af-pf-lv-who-text">
                <span className="af-pf-lv-who-name">
                  {o.owner ? o.owner.teamName : 'Another manager'}
                </span>
                <span className="af-pf-lv-who-meta">
                  {o.owner
                    ? [
                        o.owner.ownerName ? `@${o.owner.ownerName}` : null,
                        o.owner.record,
                        o.owner.isCommissioner ? 'commissioner' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'rostered here — we hold no team row for this roster, so we cannot name them'}
                </span>
              </span>
            </div>
            <span className="af-chip af-num af-pf-slot" data-tone="none" title="On their roster, in this slot">
              {o.slot === 'STARTER' ? 'THEY START HIM' : `THEIR ${o.slot}`}
            </span>
          </>
        ) : o.kind === 'free-agent' ? (
          <div className="af-pf-lv-who">
            <OwnerMark src={null} letter="+" />
            <span className="af-pf-lv-who-text">
              <span className="af-pf-lv-who-name">Unrostered in this league</span>
              <span className="af-pf-lv-who-meta">
                Not on any of the {view.rosterCount} rosters we hold for it — he is there to be claimed.
              </span>
            </span>
          </div>
        ) : (
          <p className="af-pf-unavailable">{o.reason}</p>
        )}
      </div>

      <div className="af-pf-lv-foot">
        <span className="af-pf-lv-proj">
          {view.afPoints.available ? (
            <>
              <span className="af-pf-lv-proj-value af-num">{view.afPoints.data.points.toFixed(1)}</span>
              <span className="af-label">
                proj wk {view.afPoints.data.week} · this league&apos;s scoring
              </span>
            </>
          ) : (
            <span className="af-pf-tile-why">{view.afPoints.reason}</span>
          )}
        </span>

        <span className="af-pf-lv-actions">
          {o.kind === 'yours' ? (
            (() => {
              const l = lineupLink(league)
              return l ? (
                <a
                  className="af-btn af-pf-lv-btn"
                  href={l.href}
                  {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {l.label}
                </a>
              ) : null
            })()
          ) : o.kind === 'other' ? (
            (() => {
              const t = tradeLink(league)
              return (
                <>
                  <Link className="af-btn af-pf-lv-btn" href={t.here.href}>
                    Trade for {last} →
                  </Link>
                  {t.there ? (
                    <a
                      className="af-btn af-btn--ghost af-pf-lv-btn"
                      href={t.there.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t.there.label}
                    </a>
                  ) : null}
                </>
              )
            })()
          ) : o.kind === 'free-agent' ? (
            (() => {
              const c = claimLink(league)
              return c ? (
                <a
                  className="af-btn af-pf-lv-btn"
                  href={c.href}
                  {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  Claim {last} — {c.label.replace(/^Open in /, 'on ')}
                </a>
              ) : null
            })()
          ) : null}
        </span>
      </div>

      <p className="af-pf-readonly-note">
        Read-only — the change is made on {platformLabel(view.platform)}. We show you the league and
        the screen.
      </p>
    </section>
  )
}

export default LeagueOwnershipCard
